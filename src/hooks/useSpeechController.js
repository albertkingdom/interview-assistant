import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeTranscriber } from "../lib/openaiRealtimeTranscriber";
import { appendFinalChunk, mergeTranscript, stabilizeInterim } from "../utils/transcriptUtils";

const WATCHDOG_INTERVAL_MS = 1500;
const STALL_TIMEOUT_MS = 12000;
const MAX_SESSION_DURATION_MS = 90000;
const LOW_VOLUME_RMS_THRESHOLD = 0.008;
const LOW_VOLUME_HOLD_MS = 1800;
const MIC_MONITOR_INTERVAL_MS = 350;
const PAUSE_LINE_BREAK_MS = 1100;

export const useSpeechController = ({
  currentQuestionRef,
  currentAnswerRef,
  setCurrentQuestion,
  setCurrentAnswer,
  listeningTargetRef,
  latestInterimRef,
  accumulatedRef,
  appendFinalChunkRef,
  setInterimText,
  answerRef
}) => {
  const [sttEngine, setSttEngine] = useState("openai-realtime");
  const [realtimeStatus, setRealtimeStatus] = useState("idle");
  const [listeningTarget, setListeningTarget] = useState(null);
  const [micWarning, setMicWarning] = useState("");
  const [speechLangMode, setSpeechLangMode] = useState("zh-TW");
  const [audioInputConfig, setAudioInputConfig] = useState({
    autoGainControl: true,
    noiseSuppression: false
  });

  const recognitionRef = useRef(null);
  const flushPendingInterimRef = useRef(() => { });
  const stopMicMonitorRef = useRef(() => { });
  const safeStartRecognitionRef = useRef(() => false);
  const safeStopRecognitionRef = useRef(() => { });
  const realtimeTranscriberRef = useRef(null);
  const sttEngineRef = useRef("openai-realtime");
  const shouldRestartRef = useRef(false);
  const restartTimerRef = useRef(null);
  const restartAttemptRef = useRef(0);
  const watchdogTimerRef = useRef(null);
  const lastRecognitionEventAtRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const micMonitorTimerRef = useRef(null);
  const monitorStreamRef = useRef(null);
  const monitorAudioContextRef = useRef(null);
  const monitorAnalyserRef = useRef(null);
  const monitorSourceRef = useRef(null);
  const lowVolumeSinceRef = useRef(0);
  const lastFinalAtRef = useRef(0);
  const audioInputConfigRef = useRef({
    autoGainControl: true,
    noiseSuppression: false
  });
  const speechLangModeRef = useRef("zh-TW");
  const mixedPreferredLangRef = useRef("zh-TW");

  const setTarget = useCallback((val) => {
    listeningTargetRef.current = val;
    setListeningTarget(val);
  }, [listeningTargetRef]);
  appendFinalChunkRef.current = appendFinalChunk;

  const resolveStableFieldText = useCallback((target, candidateText) => {
    const fieldText = target === "question" ? currentQuestionRef.current : currentAnswerRef.current;
    if (!fieldText) return candidateText;
    if (!candidateText) return fieldText;
    if (candidateText.includes(fieldText)) return candidateText;
    if (fieldText.includes(candidateText)) return fieldText;
    return candidateText.length >= fieldText.length ? candidateText : fieldText;
  }, [currentQuestionRef, currentAnswerRef]);

  const setTargetText = useCallback((target, text) => {
    if (target === "question") {
      currentQuestionRef.current = text;
      setCurrentQuestion(text);
    } else if (target === "answer") {
      currentAnswerRef.current = text;
      setCurrentAnswer(text);
    }
  }, [currentQuestionRef, currentAnswerRef, setCurrentQuestion, setCurrentAnswer]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const flushPendingInterim = (target = listeningTargetRef.current) => {
    if (!target) return;
    const pendingInterim = latestInterimRef.current[target] || "";
    const mergedText = mergeTranscript(accumulatedRef.current || "", pendingInterim);
    const resolvedText = resolveStableFieldText(target, mergedText);
    accumulatedRef.current = resolvedText;
    setTargetText(target, resolvedText);
    latestInterimRef.current[target] = "";
    setInterimText("");
  };
  flushPendingInterimRef.current = flushPendingInterim;

  // Keep latest audio settings in refs for async callbacks.
  useEffect(() => {
    audioInputConfigRef.current = audioInputConfig;
  }, [audioInputConfig]);

  useEffect(() => {
    speechLangModeRef.current = speechLangMode;
    if (speechLangMode === "zh-TW" || speechLangMode === "en-US") {
      mixedPreferredLangRef.current = speechLangMode;
    } else {
      mixedPreferredLangRef.current = "zh-TW";
    }
    if (listeningTargetRef.current && recognitionRef.current) {
      clearRestartTimer();
      safeStopRecognitionRef.current(recognitionRef.current);
    }
  }, [speechLangMode, clearRestartTimer, listeningTargetRef]);

  useEffect(() => {
    const track = monitorStreamRef.current?.getAudioTracks?.()[0];
    if (!track?.applyConstraints) return;
    track.applyConstraints({
      autoGainControl: audioInputConfig.autoGainControl,
      noiseSuppression: audioInputConfig.noiseSuppression
    }).catch((err) => {
      console.debug("Audio constraint update ignored:", err);
    });
  }, [audioInputConfig]);

  useEffect(() => () => {
    const transcriber = realtimeTranscriberRef.current;
    if (transcriber) {
      void transcriber.stop();
      realtimeTranscriberRef.current = null;
    }
  }, []);

  const getRecognitionLang = useCallback(() => {
    if (speechLangModeRef.current === "mixed") return mixedPreferredLangRef.current;
    return speechLangModeRef.current;
  }, []);

  const updateMixedPreferredLang = useCallback((text) => {
    if (speechLangModeRef.current !== "mixed") return;
    const sample = (text || "").slice(-180);
    if (!sample) return;
    const latinChars = (sample.match(/[A-Za-z]/g) || []).length;
    const cjkChars = (sample.match(/[\u4E00-\u9FFF]/g) || []).length;
    const englishWords = (sample.match(/\b[A-Za-z][A-Za-z0-9+#.-]*\b/g) || []).length;
    const englishScore = latinChars + englishWords * 6;
    const chineseScore = cjkChars * 1.4;
    if (englishScore > chineseScore + 10) {
      mixedPreferredLangRef.current = "en-US";
    } else if (chineseScore > englishScore + 10) {
      mixedPreferredLangRef.current = "zh-TW";
    }
  }, []);

  const pickTranscriptFromResult = useCallback((result) => {
    if (!result) return "";
    const mode = speechLangModeRef.current;
    let bestText = result[0]?.transcript || "";
    let bestScore = -Infinity;
    for (let idx = 0; idx < result.length; idx += 1) {
      const alt = result[idx];
      const text = alt?.transcript || "";
      const confidence = typeof alt?.confidence === "number" ? alt.confidence : 0;
      const latinChars = (text.match(/[A-Za-z]/g) || []).length;
      const cjkChars = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
      const technicalWords = (text.match(/\b[A-Za-z][A-Za-z0-9+#.-]*\b/g) || []).length;
      const mixedBonus = mode === "mixed" ? (technicalWords * 0.35 + (latinChars > 0 && cjkChars > 0 ? 0.2 : 0)) : 0;
      const score = confidence + mixedBonus + latinChars * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }
    return bestText;
  }, []);

  const stopMicMonitor = useCallback(() => {
    if (micMonitorTimerRef.current) {
      clearInterval(micMonitorTimerRef.current);
      micMonitorTimerRef.current = null;
    }
    lowVolumeSinceRef.current = 0;
    setMicWarning("");
    if (monitorSourceRef.current) {
      try {
        monitorSourceRef.current.disconnect();
      } catch (err) {
        console.debug("Mic source disconnect ignored:", err);
      }
      monitorSourceRef.current = null;
    }
    monitorAnalyserRef.current = null;
    if (monitorAudioContextRef.current) {
      monitorAudioContextRef.current.close().catch(() => { });
      monitorAudioContextRef.current = null;
    }
    if (monitorStreamRef.current) {
      monitorStreamRef.current.getTracks().forEach((track) => track.stop());
      monitorStreamRef.current = null;
    }
  }, []);
  stopMicMonitorRef.current = stopMicMonitor;

  useEffect(() => {
    sttEngineRef.current = sttEngine;
    setMicWarning("");
    stopMicMonitor();
    lastFinalAtRef.current = 0;
    setTarget(null);
    setInterimText("");
    if (sttEngine === "openai-realtime") {
      shouldRestartRef.current = false;
      clearRestartTimer();
      safeStopRecognitionRef.current(recognitionRef.current);
      setRealtimeStatus("idle");
    } else {
      const transcriber = realtimeTranscriberRef.current;
      if (transcriber) {
        void transcriber.stop();
      }
      setRealtimeStatus("idle");
    }
  }, [sttEngine, clearRestartTimer, stopMicMonitor, setTarget, setInterimText]);

  const startMicMonitor = async () => {
    if (micMonitorTimerRef.current || monitorStreamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const config = audioInputConfigRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: config.noiseSuppression,
          echoCancellation: true,
          autoGainControl: config.autoGainControl
        }
      });
      monitorStreamRef.current = stream;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = new AudioContextClass();
      monitorAudioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      monitorSourceRef.current = source;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      monitorAnalyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      micMonitorTimerRef.current = setInterval(() => {
        if (!shouldRestartRef.current || !listeningTargetRef.current || !monitorAnalyserRef.current) {
          lowVolumeSinceRef.current = 0;
          setMicWarning("");
          return;
        }
        monitorAnalyserRef.current.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        if (rms < LOW_VOLUME_RMS_THRESHOLD) {
          if (!lowVolumeSinceRef.current) lowVolumeSinceRef.current = Date.now();
          if (Date.now() - lowVolumeSinceRef.current > LOW_VOLUME_HOLD_MS) {
            setMicWarning("音量偏小，請靠近麥克風或提高輸入音量");
          }
        } else {
          lowVolumeSinceRef.current = 0;
          setMicWarning("");
        }
      }, MIC_MONITOR_INTERVAL_MS);
    } catch (err) {
      console.debug("Mic monitor unavailable:", err);
    }
  };

  const toggleAudioInputConfig = (key) => {
    setAudioInputConfig((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleRealtimeInterim = (rawText) => {
    const target = listeningTargetRef.current;
    if (!target) return;
    const text = rawText || "";
    const previousInterim = latestInterimRef.current[target] || "";
    const stabilizedInterim = stabilizeInterim(previousInterim, text);
    latestInterimRef.current[target] = stabilizedInterim;
    setInterimText(stabilizedInterim);
    const merged = mergeTranscript(accumulatedRef.current, stabilizedInterim);
    const resolvedText = resolveStableFieldText(target, merged);
    setTargetText(target, resolvedText);
  };

  const handleRealtimeFinal = (rawText) => {
    const target = listeningTargetRef.current;
    if (!target) return;
    const text = rawText || "";
    if (!text.trim()) return;
    const now = Date.now();
    const shouldLineBreak = Boolean(
      accumulatedRef.current &&
      lastFinalAtRef.current &&
      now - lastFinalAtRef.current > PAUSE_LINE_BREAK_MS
    );
    accumulatedRef.current = appendFinalChunkRef.current(accumulatedRef.current, text, shouldLineBreak);
    lastFinalAtRef.current = now;
    latestInterimRef.current[target] = "";
    setInterimText("");
    const resolvedText = resolveStableFieldText(target, accumulatedRef.current);
    setTargetText(target, resolvedText);
    updateMixedPreferredLang(resolvedText);
  };

  const ensureRealtimeTranscriber = () => {
    if (realtimeTranscriberRef.current) return realtimeTranscriberRef.current;
    const transcriber = new OpenAIRealtimeTranscriber({
      onStatus: (payload) => {
        const nextState = payload?.state || "unknown";
        setRealtimeStatus(nextState);
        if (nextState === "connected") setMicWarning("");
      },
      onInterim: (text) => {
        handleRealtimeInterim(text);
      },
      onFinal: (text) => {
        handleRealtimeFinal(text);
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err || "Unknown error");
        setRealtimeStatus("error");
        setMicWarning(`Realtime 轉寫異常：${msg}`);
      },
    });
    realtimeTranscriberRef.current = transcriber;
    return transcriber;
  };

  const startRealtimeListening = async (target) => {
    flushPendingInterim();
    shouldRestartRef.current = false;
    clearRestartTimer();
    safeStopRecognitionRef.current(recognitionRef.current);
    stopMicMonitor();

    accumulatedRef.current = target === "question" ? currentQuestionRef.current : currentAnswerRef.current;
    latestInterimRef.current[target] = "";
    lastFinalAtRef.current = Date.now();
    setInterimText("");
    setTarget(target);
    startMicMonitor();

    const transcriber = ensureRealtimeTranscriber();
    try {
      const language =
        speechLangMode === "en-US" ? "en" : speechLangMode === "zh-TW" ? "zh" : "auto";
      await transcriber.start({
        model: "gpt-4o-mini-transcribe",
        language,
        includeLogprobs: false,
        noiseReductionType: "near_field",
        silenceDurationMs: 1200,
        audioConfig: {
          autoGainControl: audioInputConfig.autoGainControl,
          noiseSuppression: audioInputConfig.noiseSuppression,
          echoCancellation: true,
        },
      });
    } catch (err) {
      stopMicMonitor();
      setTarget(null);
      setInterimText("");
      latestInterimRef.current[target] = "";
      const msg = err instanceof Error ? err.message : String(err || "Unknown error");
      setMicWarning(`Realtime 連線失敗：${msg}`);
    }
  };

  const stopRealtimeListening = async (target = listeningTargetRef.current) => {
    flushPendingInterim(target);
    stopMicMonitor();
    lastFinalAtRef.current = 0;
    const transcriber = realtimeTranscriberRef.current;
    if (transcriber) {
      await transcriber.stop();
    }
    setTarget(null);
    setInterimText("");
  };

  const stopActiveListening = async () => {
    if (!listeningTargetRef.current) return;
    if (sttEngineRef.current === "openai-realtime") {
      await stopRealtimeListening();
      return;
    }
    flushPendingInterim();
    shouldRestartRef.current = false;
    clearRestartTimer();
    stopMicMonitor();
    lastFinalAtRef.current = 0;
    safeStopRecognitionRef.current(recognitionRef.current);
    setTarget(null);
    setInterimText("");
  };

  const safeStartRecognition = (recognition) => {
    if (!recognition) return;
    try {
      recognition.lang = getRecognitionLang();
      recognition.maxAlternatives = speechLangModeRef.current === "mixed" ? 3 : 1;
      recognition.start();
      restartAttemptRef.current = 0;
      return true;
    } catch (err) {
      console.debug("SpeechRecognition start ignored:", err);
      return false;
    }
  };
  safeStartRecognitionRef.current = safeStartRecognition;

  const safeStopRecognition = (recognition) => {
    if (!recognition) return;
    try {
      recognition.stop();
    } catch (err) {
      console.debug("SpeechRecognition stop ignored:", err);
    }
  };
  safeStopRecognitionRef.current = safeStopRecognition;

  // Browser SpeechRecognition lifecycle with stable callback dependencies.
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = getRecognitionLang();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = speechLangModeRef.current === "mixed" ? 3 : 1;

    const scheduleRestart = (baseDelayMs = 350) => {
      if (!shouldRestartRef.current) return;
      clearRestartTimer();
      const attempt = restartAttemptRef.current;
      const delay = Math.min(baseDelayMs + attempt * 350, 3000);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!shouldRestartRef.current) return;
        const started = safeStartRecognitionRef.current(recognition);
        if (!started) {
          restartAttemptRef.current += 1;
          scheduleRestart(700);
        }
      }, delay);
    };

    const clearWatchdog = () => {
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };

    const touchRecognitionEvent = () => {
      lastRecognitionEventAtRef.current = Date.now();
    };

    recognition.onstart = () => {
      if (sttEngineRef.current !== "browser") return;
      touchRecognitionEvent();
      sessionStartedAtRef.current = Date.now();
      restartAttemptRef.current = 0;
      lastFinalAtRef.current = Date.now();
    };

    recognition.onresult = (e) => {
      if (sttEngineRef.current !== "browser") return;
      touchRecognitionEvent();
      let newFinal = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = pickTranscriptFromResult(e.results[i]);
        if (e.results[i].isFinal) newFinal += transcript;
        else interim += transcript;
      }
      const target = listeningTargetRef.current;
      const previousInterim = target ? latestInterimRef.current[target] : "";
      const stabilizedInterim = newFinal ? "" : stabilizeInterim(previousInterim, interim);
      if (newFinal) {
        const now = Date.now();
        const shouldLineBreak = Boolean(
          accumulatedRef.current &&
          lastFinalAtRef.current &&
          now - lastFinalAtRef.current > PAUSE_LINE_BREAK_MS
        );
        accumulatedRef.current = appendFinalChunkRef.current(accumulatedRef.current, newFinal, shouldLineBreak);
        lastFinalAtRef.current = now;
        setInterimText("");
      } else {
        setInterimText(stabilizedInterim);
      }
      if (target) {
        if (newFinal) latestInterimRef.current[target] = "";
        else latestInterimRef.current[target] = stabilizedInterim;
      }
      if (target === "question" || target === "answer") {
        const merged = mergeTranscript(accumulatedRef.current, stabilizedInterim);
        const resolvedText = resolveStableFieldText(target, merged);
        setTargetText(target, resolvedText);
        updateMixedPreferredLang(resolvedText);
      }
      restartAttemptRef.current = 0;
    };

    recognition.onerror = (e) => {
      if (sttEngineRef.current !== "browser") return;
      touchRecognitionEvent();
      if (e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        flushPendingInterimRef.current();
        shouldRestartRef.current = false;
        stopMicMonitorRef.current();
        lastFinalAtRef.current = 0;
        setTarget(null);
        setInterimText("");
        clearRestartTimer();
        return;
      }
      if (shouldRestartRef.current) {
        flushPendingInterimRef.current();
        scheduleRestart(e.error === "no-speech" ? 300 : 700);
      } else {
        stopMicMonitorRef.current();
        lastFinalAtRef.current = 0;
        setTarget(null);
      }
    };

    recognition.onend = () => {
      if (sttEngineRef.current !== "browser") return;
      touchRecognitionEvent();
      setInterimText("");
      if (shouldRestartRef.current) {
        flushPendingInterimRef.current();
        scheduleRestart(450);
      } else {
        stopMicMonitorRef.current();
        lastFinalAtRef.current = 0;
        setTarget(null);
        clearRestartTimer();
      }
    };

    recognitionRef.current = recognition;
    clearWatchdog();
    watchdogTimerRef.current = setInterval(() => {
      if (!shouldRestartRef.current || !listeningTargetRef.current) return;
      const now = Date.now();
      const last = lastRecognitionEventAtRef.current || 0;
      const startedAt = sessionStartedAtRef.current || now;
      const stalled = last && now - last > STALL_TIMEOUT_MS;
      const sessionTooLong = now - startedAt > MAX_SESSION_DURATION_MS;
      if (stalled || sessionTooLong) {
        flushPendingInterimRef.current();
        touchRecognitionEvent();
        sessionStartedAtRef.current = now;
        clearRestartTimer();
        safeStopRecognitionRef.current(recognition);
        scheduleRestart(300);
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      shouldRestartRef.current = false;
      clearRestartTimer();
      clearWatchdog();
      stopMicMonitorRef.current();
      sessionStartedAtRef.current = 0;
      lastFinalAtRef.current = 0;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      safeStopRecognitionRef.current(recognition);
      recognitionRef.current = null;
    };
  }, [
    accumulatedRef,
    appendFinalChunkRef,
    clearRestartTimer,
    getRecognitionLang,
    latestInterimRef,
    listeningTargetRef,
    pickTranscriptFromResult,
    resolveStableFieldText,
    setInterimText,
    setTarget,
    setTargetText,
    updateMixedPreferredLang
  ]);

  const toggleListening = async (target) => {
    if (sttEngineRef.current === "openai-realtime") {
      if (listeningTargetRef.current === target) {
        await stopRealtimeListening(target);
      } else {
        await startRealtimeListening(target);
      }
      return;
    }

    if (!recognitionRef.current) return;
    if (listeningTargetRef.current === target) {
      flushPendingInterim(target);
      shouldRestartRef.current = false;
      clearRestartTimer();
      stopMicMonitor();
      lastFinalAtRef.current = 0;
      safeStopRecognitionRef.current(recognitionRef.current);
      setTarget(null);
      setInterimText("");
    } else {
      flushPendingInterim();
      shouldRestartRef.current = false;
      clearRestartTimer();
      stopMicMonitor();
      safeStopRecognitionRef.current(recognitionRef.current);
      accumulatedRef.current = target === "question" ? currentQuestionRef.current : currentAnswerRef.current;
      setInterimText("");
      setTimeout(() => {
        shouldRestartRef.current = true;
        restartAttemptRef.current = 0;
        lastFinalAtRef.current = Date.now();
        setTarget(target);
        startMicMonitor();
        safeStartRecognitionRef.current(recognitionRef.current);
      }, 200);
    }
  };

  const handoffToCandidateAnswer = () => {
    answerRef.current?.focus();
    if (sttEngineRef.current !== "openai-realtime" && !recognitionRef.current) return;
    if (listeningTargetRef.current !== "answer") {
      void toggleListening("answer");
    }
  };

  return {
    sttEngine,
    setSttEngine,
    realtimeStatus,
    listeningTarget,
    micWarning,
    speechLangMode,
    setSpeechLangMode,
    audioInputConfig,
    toggleAudioInputConfig,
    toggleListening,
    stopActiveListening,
    flushPendingInterim,
    handoffToCandidateAnswer
  };
};
