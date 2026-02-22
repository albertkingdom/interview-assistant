import { useState, useRef, useEffect } from "react";
import { OpenAIRealtimeTranscriber } from "./lib/openaiRealtimeTranscriber";

const SYSTEM_PROMPT = `你是一位資深面試輔助 AI，協助面試官在面試過程中做出更好的判斷與提問。

你會收到：
1. 目前面試職位與重點主題
2. 到目前為止的對話紀錄（面試官問題 + 面試者回答摘要）
3. 最新一則面試者的回答

請用繁體中文輸出以下 JSON 格式（不加任何 markdown code block）：
{
  "quality": {
    "score": 1-5的整數,
    "label": "優秀/良好/普通/薄弱/迴避",
    "comment": "一句話評語，20字以內"
  },
  "nextQuestions": [
    "建議追問問題1（根據剛才的回答深挖）",
    "建議問題2（轉換角度或方向）",
    "建議問題3（引導面試者舉例或量化）"
  ],
  "uncoveredTopics": ["還沒問到的主題1", "還沒問到的主題2"]
}`;

const TOPICS_DEFAULT = ["技術能力", "過去經驗", "問題解決", "團隊合作", "自我驅動", "職涯規劃"];
const RECORDS_STORAGE_KEY = "interview-assistant.records.v1";
const WATCHDOG_INTERVAL_MS = 1500;
const STALL_TIMEOUT_MS = 12000;
const MAX_SESSION_DURATION_MS = 90000;
const LOW_VOLUME_RMS_THRESHOLD = 0.015;
const LOW_VOLUME_HOLD_MS = 1800;
const MIC_MONITOR_INTERVAL_MS = 350;
const PAUSE_LINE_BREAK_MS = 1100;
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    quality: {
      type: "OBJECT",
      properties: {
        score: { type: "INTEGER" },
        label: { type: "STRING" },
        comment: { type: "STRING" }
      },
      required: ["score", "label", "comment"]
    },
    nextQuestions: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    uncoveredTopics: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  },
  required: ["quality", "nextQuestions", "uncoveredTopics"]
};

export default function InterviewAssistant() {
  const [apiKey, setApiKey] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customTopics, setCustomTopics] = useState(TOPICS_DEFAULT);
  const [conversation, setConversation] = useState([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [coveredTopics, setCoveredTopics] = useState([]);
  const [phase, setPhase] = useState("setup"); // setup | interview
  const [newTopicInput, setNewTopicInput] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [sttEngine, setSttEngine] = useState("browser");
  const [realtimeStatus, setRealtimeStatus] = useState("idle");
  // listeningTarget: null | "question" | "answer"
  const [listeningTarget, setListeningTarget] = useState(null);
  const [interimText, setInterimText] = useState(""); // live interim display
  const [micWarning, setMicWarning] = useState("");
  const [speechLangMode, setSpeechLangMode] = useState("zh-TW");
  const [audioInputConfig, setAudioInputConfig] = useState({
    autoGainControl: true,
    noiseSuppression: true
  });
  const recognitionRef = useRef(null);
  const accumulatedRef = useRef("");
  const currentQuestionRef = useRef("");
  const currentAnswerRef = useRef("");
  const listeningTargetRef = useRef(null); // mirror for use inside callbacks
  const latestInterimRef = useRef({ question: "", answer: "" });
  const flushPendingInterimRef = useRef(() => {});
  const stopMicMonitorRef = useRef(() => {});
  const appendFinalChunkRef = useRef((baseText = "") => baseText);
  const safeStartRecognitionRef = useRef(() => false);
  const safeStopRecognitionRef = useRef(() => {});
  const realtimeTranscriberRef = useRef(null);
  const sttEngineRef = useRef("browser");
  const shouldRestartRef = useRef(false);  // auto-restart flag
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
    noiseSuppression: true
  });
  const speechLangModeRef = useRef("zh-TW");
  const mixedPreferredLangRef = useRef("zh-TW");
  const answerRef = useRef(null);
  const historyRef = useRef(null);

  const setTarget = (val) => {
    listeningTargetRef.current = val;
    setListeningTarget(val);
  };

  const mergeTranscript = (baseText = "", appendedText = "") => {
    if (!appendedText) return baseText;
    if (!baseText) return appendedText;
    if (baseText.endsWith(appendedText)) return baseText;
    if (appendedText.startsWith(baseText)) return appendedText;

    const maxOverlap = Math.min(baseText.length, appendedText.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      if (baseText.slice(-overlap) === appendedText.slice(0, overlap)) {
        return baseText + appendedText.slice(overlap);
      }
    }
    return baseText + appendedText;
  };

  const appendFinalChunk = (baseText = "", finalChunk = "", addLineBreak = false) => {
    if (!finalChunk || !finalChunk.trim()) return baseText;
    if (!baseText) return finalChunk.trimStart();
    if (!addLineBreak) return mergeTranscript(baseText, finalChunk);
    const baseWithBreak = baseText.endsWith("\n") ? baseText : `${baseText}\n`;
    return mergeTranscript(baseWithBreak, finalChunk.trimStart());
  };
  appendFinalChunkRef.current = appendFinalChunk;

  const stabilizeInterim = (previousInterim = "", nextInterim = "") => {
    if (!previousInterim || !nextInterim) return nextInterim;
    if (previousInterim.length > nextInterim.length && previousInterim.startsWith(nextInterim)) {
      return previousInterim;
    }
    return nextInterim;
  };

  const resolveStableFieldText = (target, candidateText) => {
    const fieldText = target === "question" ? currentQuestionRef.current : currentAnswerRef.current;
    if (!fieldText) return candidateText;
    if (!candidateText) return fieldText;
    if (candidateText.includes(fieldText)) return candidateText;
    if (fieldText.includes(candidateText)) return fieldText;
    return candidateText.length >= fieldText.length ? candidateText : fieldText;
  };

  const setTargetText = (target, text) => {
    if (target === "question") {
      currentQuestionRef.current = text;
      setCurrentQuestion(text);
    } else if (target === "answer") {
      currentAnswerRef.current = text;
      setCurrentAnswer(text);
    }
  };

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

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    currentAnswerRef.current = currentAnswer;
  }, [currentAnswer]);

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
  }, [speechLangMode]);

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
  }, [sttEngine]);

  useEffect(() => () => {
    const transcriber = realtimeTranscriberRef.current;
    if (transcriber) {
      void transcriber.stop();
      realtimeTranscriberRef.current = null;
    }
  }, []);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const getRecognitionLang = () => {
    if (speechLangModeRef.current === "mixed") return mixedPreferredLangRef.current;
    return speechLangModeRef.current;
  };

  const updateMixedPreferredLang = (text) => {
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
  };

  const pickTranscriptFromResult = (result) => {
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
  };

  const stopMicMonitor = () => {
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
      monitorAudioContextRef.current.close().catch(() => {});
      monitorAudioContextRef.current = null;
    }
    if (monitorStreamRef.current) {
      monitorStreamRef.current.getTracks().forEach((track) => track.stop());
      monitorStreamRef.current = null;
    }
  };
  stopMicMonitorRef.current = stopMicMonitor;

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
      const language = speechLangMode === "en-US" ? "en" : "zh";
      await transcriber.start({
        model: "gpt-4o-mini-transcribe",
        language,
        includeLogprobs: false,
        noiseReductionType: "near_field",
        silenceDurationMs: 900,
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

  // Build a single shared SpeechRecognition instance
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
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
      // Browser can end long sessions; restart with backoff to avoid dead stops.
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
      // Auto-restart if user hasn't manually stopped
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
      // Chrome SpeechRecognition can silently stall; rotate session on stall or long-running session.
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
  }, []);

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
      // Manual stop
      flushPendingInterim(target);
      shouldRestartRef.current = false;
      clearRestartTimer();
      stopMicMonitor();
      lastFinalAtRef.current = 0;
      safeStopRecognitionRef.current(recognitionRef.current);
      setTarget(null);
      setInterimText("");
    } else {
      // Stop existing if any
      flushPendingInterim();
      shouldRestartRef.current = false;
      clearRestartTimer();
      stopMicMonitor();
      safeStopRecognitionRef.current(recognitionRef.current);
      // Seed accumulated from current field
      accumulatedRef.current = target === "question" ? currentQuestion : currentAnswer;
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

  const escapeControlCharsInString = (text) => {
    let result = "";
    let inString = false;
    let escaped = false;

    for (const char of text) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        result += char;
        escaped = true;
        continue;
      }

      if (char === "\"") {
        result += char;
        inString = !inString;
        continue;
      }

      if (inString && (char === "\n" || char === "\r")) {
        result += "\\n";
        continue;
      }

      if (inString && char === "\t") {
        result += "\\t";
        continue;
      }

      result += char;
    }

    return result;
  };

  const extractJsonObjectText = (text) => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return text;
    return text.slice(start, end + 1);
  };

  const parseAiJson = (rawText) => {
    if (!rawText) return {};
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const jsonCandidates = [cleaned, extractJsonObjectText(cleaned)];

    for (const candidate of jsonCandidates) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        const repaired = escapeControlCharsInString(candidate).replace(/,\s*([}\]])/g, "$1");
        try {
          return JSON.parse(repaired);
        } catch {
          // continue to try next candidate
        }
      }
    }

    throw new Error("模型回傳格式不完整，請再試一次");
  };

  const appendConversationIfNeeded = (questionInput, answerInput) => {
    const question = questionInput.trim();
    const answer = answerInput.trim();
    if (!question || !answer) return;

    setConversation((prev) => {
      const last = prev[prev.length - 1];
      if (last?.question === question && last?.answer === answer) return prev;
      return [...prev, { question, answer }];
    });
    setTimeout(() => historyRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 100);
  };

  const buildInterviewRecord = () => {
    const items = [...conversation];
    const pendingQuestion = currentQuestion.trim();
    const pendingAnswer = currentAnswer.trim();
    if (pendingQuestion && pendingAnswer) {
      const last = items[items.length - 1];
      if (!(last?.question === pendingQuestion && last?.answer === pendingAnswer)) {
        items.push({ question: pendingQuestion, answer: pendingAnswer });
      }
    }

    return {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      jobTitle: jobTitle.trim() || "未指定",
      topics: [...customTopics],
      coveredTopics: [...coveredTopics],
      conversation: items,
      aiSummary: aiResult && !aiResult.error ? aiResult : null
    };
  };

  const saveInterviewRecord = (record) => {
    try {
      const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
      const records = raw ? JSON.parse(raw) : [];
      const next = [record, ...records];
      localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error(err);
      throw new Error("儲存面試紀錄失敗");
    }
  };

  const formatDateTime = (isoString) => {
    const d = new Date(isoString);
    return d.toLocaleString("zh-TW", { hour12: false });
  };

  const buildMarkdownFromRecord = (record) => {
    const lines = [
      `# 面試紀錄 - ${record.jobTitle}`,
      "",
      `- 產生時間：${formatDateTime(record.createdAt)}`,
      `- 面試主題：${record.topics.join("、") || "無"}`,
      `- 已覆蓋主題：${record.coveredTopics.join("、") || "無"}`,
      ""
    ];

    lines.push("## 對話紀錄", "");
    record.conversation.forEach((turn, idx) => {
      lines.push(`### 第 ${idx + 1} 輪`);
      lines.push(`**面試官：** ${turn.question}`);
      lines.push(`**面試者：** ${turn.answer}`);
      lines.push("");
    });

    if (record.aiSummary) {
      lines.push("## 最後一次 AI 分析", "");
      lines.push(`- 品質分數：${record.aiSummary.quality?.score ?? "N/A"}`);
      lines.push(`- 評級：${record.aiSummary.quality?.label ?? "N/A"}`);
      lines.push(`- 評語：${record.aiSummary.quality?.comment ?? "N/A"}`);
      lines.push("");
      lines.push("### 建議下一題");
      (record.aiSummary.nextQuestions || []).forEach((q, idx) => lines.push(`${idx + 1}. ${q}`));
      lines.push("");
      lines.push("### 尚未涵蓋主題");
      (record.aiSummary.uncoveredTopics || []).forEach((t) => lines.push(`- ${t}`));
      lines.push("");
    }

    return lines.join("\n");
  };

  const downloadMarkdown = (record, markdown) => {
    const safeJobTitle = record.jobTitle.replace(/[\\/:*?"<>|]/g, "-");
    const timestamp = record.createdAt.replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "");
    const filename = `interview-${safeJobTitle || "record"}-${timestamp}.md`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const finishInterviewAndExport = async () => {
    if (listeningTargetRef.current) {
      if (sttEngineRef.current === "openai-realtime") {
        await stopRealtimeListening();
      } else {
        flushPendingInterim();
        shouldRestartRef.current = false;
        clearRestartTimer();
        stopMicMonitor();
        lastFinalAtRef.current = 0;
        safeStopRecognitionRef.current(recognitionRef.current);
        setTarget(null);
        setInterimText("");
      }
    }

    const record = buildInterviewRecord();
    if (record.conversation.length === 0) {
      setExportStatus("尚無對話可匯出");
      return;
    }

    try {
      saveInterviewRecord(record);
      const markdown = buildMarkdownFromRecord(record);
      downloadMarkdown(record, markdown);
      setExportStatus("已儲存面試紀錄，並下載 Markdown");
    } catch (err) {
      console.error(err);
      setExportStatus("匯出失敗，請稍後再試");
    }
  };

  const callGemini = async () => {
    const questionSnapshot = currentQuestion.trim();
    const answerSnapshot = currentAnswer.trim();
    if (!answerSnapshot) return;
    if (!apiKey.trim()) {
      setAiResult({ error: "請先輸入 Gemini API Key" });
      return;
    }

    appendConversationIfNeeded(questionSnapshot, answerSnapshot);
    if (listeningTargetRef.current) {
      if (sttEngineRef.current === "openai-realtime") {
        await stopRealtimeListening();
      } else {
        flushPendingInterim();
        shouldRestartRef.current = false;
        clearRestartTimer();
        stopMicMonitor();
        lastFinalAtRef.current = 0;
        safeStopRecognitionRef.current(recognitionRef.current);
        setTarget(null);
      }
    }
    setCurrentQuestion("");
    setCurrentAnswer("");
    currentQuestionRef.current = "";
    currentAnswerRef.current = "";
    accumulatedRef.current = "";
    setInterimText("");

    setIsLoading(true);
    setAiResult(null);

    const historyText = conversation.map((c, i) =>
      `第${i + 1}輪\n面試官：${c.question}\n面試者：${c.answer}`
    ).join("\n\n");

    const userMsg = `職位：${jobTitle || "未指定"}
重點主題：${customTopics.join("、")}
已覆蓋主題：${coveredTopics.join("、") || "無"}

${historyText ? `對話紀錄：\n${historyText}\n\n` : ""}最新面試者回答：${answerSnapshot}`;

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userMsg }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: GEMINI_RESPONSE_SCHEMA,
            maxOutputTokens: 1000,
            temperature: 0.2
          }
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = data?.error?.message || `HTTP ${resp.status}`;
        throw new Error(errMsg);
      }

      const text = data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text || "{}";
      const parsed = parseAiJson(text);
      setAiResult(parsed);

      // Auto-detect covered topics
      if (parsed.uncoveredTopics) {
        const uncovered = new Set(parsed.uncoveredTopics);
        const newCovered = customTopics.filter(t => !uncovered.has(t));
        setCoveredTopics(newCovered);
      }
    } catch (e) {
      console.error(e);
      const msg = e?.message || "未知錯誤";
      setAiResult({ error: `分析失敗：${msg}` });
    } finally {
      setIsLoading(false);
    }
  };

  const scoreColor = (score) => {
    if (score >= 4) return "#4ade80";
    if (score >= 3) return "#facc15";
    if (score >= 2) return "#fb923c";
    return "#f87171";
  };

  const scoreLabel = ["", "薄弱", "普通", "普通", "良好", "優秀"];
  const canExport =
    conversation.length > 0 || Boolean(currentQuestion.trim() && currentAnswer.trim());

  if (phase === "setup") {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a0f",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Noto Serif TC', Georgia, serif",
        padding: "2rem"
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap');
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: #111; }
          ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        `}</style>
        <div style={{ width: "100%", maxWidth: 560 }}>
          <div style={{ textAlign: "center", marginBottom: "3rem" }}>
            <div style={{ fontSize: "3rem", marginBottom: ".5rem" }}>⬡</div>
            <h1 style={{ color: "#e8e0d0", fontSize: "1.8rem", fontWeight: 700, margin: 0, letterSpacing: ".05em" }}>面試輔助系統</h1>
            <p style={{ color: "#666", marginTop: ".5rem", fontSize: ".9rem" }}>AI 即時分析 · 現場面試專用</p>
          </div>

          <div style={{ background: "#111118", border: "1px solid #222", borderRadius: 12, padding: "2rem" }}>
            <label style={{ color: "#aaa", fontSize: ".8rem", letterSpacing: ".1em", textTransform: "uppercase" }}>Gemini API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIza..."
              style={{
                width: "100%", marginTop: 8, marginBottom: ".5rem",
                background: "#0d0d15", border: "1px solid #333", borderRadius: 8,
                padding: "10px 14px", color: "#e8e0d0", fontSize: "1rem",
                fontFamily: "inherit", outline: "none"
              }}
            />
            <div style={{ color: "#444", fontSize: ".75rem", marginBottom: "1.5rem" }}>
              僅儲存於瀏覽器記憶體，不會持久化保存。前往{" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: "#6c63ff" }}>aistudio.google.com/app/apikey</a>{" "}取得。
            </div>

            <label style={{ color: "#aaa", fontSize: ".8rem", letterSpacing: ".1em", textTransform: "uppercase" }}>面試職位</label>
            <input
              value={jobTitle}
              onChange={e => setJobTitle(e.target.value)}
              placeholder="例：前端工程師、產品經理..."
              style={{
                width: "100%", marginTop: 8, marginBottom: "1.5rem",
                background: "#0d0d15", border: "1px solid #333", borderRadius: 8,
                padding: "10px 14px", color: "#e8e0d0", fontSize: "1rem",
                fontFamily: "inherit", outline: "none"
              }}
            />

            <label style={{ color: "#aaa", fontSize: ".8rem", letterSpacing: ".1em", textTransform: "uppercase" }}>面試主題</label>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {customTopics.map((t, i) => (
                <div key={i} style={{
                  background: "#1a1a25", border: "1px solid #334",
                  borderRadius: 20, padding: "4px 12px",
                  display: "flex", alignItems: "center", gap: 6, color: "#c8c0e0", fontSize: ".85rem"
                }}>
                  {t}
                  <button onClick={() => setCustomTopics(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={newTopicInput}
                onChange={e => setNewTopicInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newTopicInput.trim()) { setCustomTopics(prev => [...prev, newTopicInput.trim()]); setNewTopicInput(""); } }}
                placeholder="新增主題，按 Enter"
                style={{
                  flex: 1, background: "#0d0d15", border: "1px solid #333", borderRadius: 8,
                  padding: "8px 12px", color: "#e8e0d0", fontSize: ".9rem",
                  fontFamily: "inherit", outline: "none"
                }}
              />
            </div>

            <button
              onClick={() => { if (jobTitle.trim() && apiKey.trim()) setPhase("interview"); }}
              style={{
                width: "100%", marginTop: "2rem",
                background: (jobTitle.trim() && apiKey.trim()) ? "linear-gradient(135deg, #6c63ff, #a78bfa)" : "#222",
                border: "none", borderRadius: 10, padding: "14px",
                color: (jobTitle.trim() && apiKey.trim()) ? "#fff" : "#444", fontSize: "1rem", fontWeight: 600,
                cursor: (jobTitle.trim() && apiKey.trim()) ? "pointer" : "not-allowed",
                letterSpacing: ".05em", transition: "all .3s"
              }}
            >
              開始面試 →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0f", color: "#e8e0d0",
      fontFamily: "'Noto Serif TC', Georgia, serif",
      display: "grid", gridTemplateColumns: "1fr 340px", gridTemplateRows: "auto 1fr",
      height: "100vh", overflow: "hidden"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d0d14; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
        input, textarea { outline: none; }
        button:active { transform: scale(.97); }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        .fadeIn { animation: fadeIn .4s ease; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
      `}</style>

      {/* Header */}
      <div style={{ gridColumn: "1/-1", background: "#0d0d14", borderBottom: "1px solid #1a1a28", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>⬡</span>
          <span style={{ color: "#888", fontSize: ".85rem" }}>面試輔助</span>
          <span style={{ color: "#444" }}>·</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>{jobTitle}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {customTopics.map(t => (
            <span key={t} style={{
              fontSize: ".72rem", padding: "2px 8px", borderRadius: 10,
              background: coveredTopics.includes(t) ? "#1a3a1a" : "#1a1a2e",
              color: coveredTopics.includes(t) ? "#4ade80" : "#666",
              border: `1px solid ${coveredTopics.includes(t) ? "#2a4a2a" : "#222"}`
            }}>
              {coveredTopics.includes(t) ? "✓ " : ""}{t}
            </span>
          ))}
        </div>
      </div>

      {/* Main content - conversation + input */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* History */}
        <div ref={historyRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {conversation.length === 0 && (
            <div style={{ color: "#333", textAlign: "center", marginTop: "3rem", fontSize: ".9rem" }}>
              開始輸入第一個問題與面試者回答 ↓
            </div>
          )}
          {conversation.map((c, i) => (
            <div key={i} className="fadeIn" style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <span style={{ background: "#1a1a35", border: "1px solid #334", borderRadius: 6, padding: "2px 8px", fontSize: ".7rem", color: "#a78bfa" }}>面試官</span>
                <span style={{ color: "#ccc", fontSize: ".9rem" }}>{c.question}</span>
              </div>
              <div style={{ display: "flex", gap: 10, paddingLeft: 16, borderLeft: "2px solid #1e1e30" }}>
                <span style={{ background: "#1a2e1a", border: "1px solid #2a3a2a", borderRadius: 6, padding: "2px 8px", fontSize: ".7rem", color: "#4ade80", flexShrink: 0 }}>面試者</span>
                <span style={{ color: "#999", fontSize: ".9rem", lineHeight: 1.6 }}>{c.answer}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Input area */}
        <div style={{ padding: "16px 24px", background: "#0d0d14", borderTop: "1px solid #1a1a28" }}>
          <div style={{ marginBottom: 12, padding: "8px 10px", background: "#10101a", border: "1px solid #1b1b2a", borderRadius: 8 }}>
            <div style={{ color: "#7a7a90", fontSize: ".7rem", letterSpacing: ".08em", marginBottom: 8 }}>
              錄音前處理參數
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setSttEngine("browser")}
                style={{
                  background: sttEngine === "browser" ? "#2a1a40" : "#1a1a2a",
                  border: `1px solid ${sttEngine === "browser" ? "#a78bfa" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: sttEngine === "browser" ? "#cdb6ff" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                STT：瀏覽器
              </button>
              <button
                type="button"
                onClick={() => setSttEngine("openai-realtime")}
                style={{
                  background: sttEngine === "openai-realtime" ? "#173022" : "#1a1a2a",
                  border: `1px solid ${sttEngine === "openai-realtime" ? "#2d7a52" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: sttEngine === "openai-realtime" ? "#6ee7a8" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                STT：OpenAI Realtime
              </button>
              {sttEngine === "openai-realtime" && (
                <span style={{ color: "#4e4e68", fontSize: ".72rem", alignSelf: "center" }}>
                  狀態：{realtimeStatus}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setSpeechLangMode("zh-TW")}
                style={{
                  background: speechLangMode === "zh-TW" ? "#1f2f4f" : "#1a1a2a",
                  border: `1px solid ${speechLangMode === "zh-TW" ? "#2f5fa0" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: speechLangMode === "zh-TW" ? "#9ec1f7" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                辨識語言：中文
              </button>
              <button
                type="button"
                onClick={() => setSpeechLangMode("en-US")}
                style={{
                  background: speechLangMode === "en-US" ? "#1f2f4f" : "#1a1a2a",
                  border: `1px solid ${speechLangMode === "en-US" ? "#2f5fa0" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: speechLangMode === "en-US" ? "#9ec1f7" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                辨識語言：英文
              </button>
              <button
                type="button"
                onClick={() => setSpeechLangMode("mixed")}
                style={{
                  background: speechLangMode === "mixed" ? "#1f2f4f" : "#1a1a2a",
                  border: `1px solid ${speechLangMode === "mixed" ? "#2f5fa0" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: speechLangMode === "mixed" ? "#9ec1f7" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                辨識語言：中英混合
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => toggleAudioInputConfig("autoGainControl")}
                style={{
                  background: audioInputConfig.autoGainControl ? "#173022" : "#1a1a2a",
                  border: `1px solid ${audioInputConfig.autoGainControl ? "#2d7a52" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: audioInputConfig.autoGainControl ? "#6ee7a8" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                自動增益 AGC：{audioInputConfig.autoGainControl ? "開" : "關"}
              </button>
              <button
                type="button"
                onClick={() => toggleAudioInputConfig("noiseSuppression")}
                style={{
                  background: audioInputConfig.noiseSuppression ? "#173022" : "#1a1a2a",
                  border: `1px solid ${audioInputConfig.noiseSuppression ? "#2d7a52" : "#333"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: audioInputConfig.noiseSuppression ? "#6ee7a8" : "#666",
                  fontSize: ".75rem",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                降噪 NS：{audioInputConfig.noiseSuppression ? "開" : "關"}
              </button>
            </div>
            <div style={{ marginTop: 6, color: "#4e4e68", fontSize: ".7rem", lineHeight: 1.4 }}>
              不同瀏覽器可能忽略部分設定，建議錄音中邊講邊觀察辨識結果。停頓超過 1.1 秒會自動換行。
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <label style={{ color: "#a78bfa", fontSize: ".75rem", letterSpacing: ".08em" }}>🎙 你的問題（面試官）</label>
              <button onClick={() => toggleListening("question")} style={{
                background: listeningTarget === "question" ? "#2a1a40" : "#1a1a2a",
                border: `1px solid ${listeningTarget === "question" ? "#a78bfa" : "#333"}`,
                borderRadius: 6, padding: "3px 10px",
                color: listeningTarget === "question" ? "#a78bfa" : "#555",
                fontSize: ".75rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                transition: "all .2s"
              }}>
                <span className={listeningTarget === "question" ? "pulse" : ""}>●</span>
                {listeningTarget === "question" ? "停止錄音" : "語音輸入"}
              </button>
            </div>
            <textarea
              value={currentQuestion}
              onChange={(e) => {
                currentQuestionRef.current = e.target.value;
                setCurrentQuestion(e.target.value);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handoffToCandidateAnswer();
                }
              }}
              placeholder="輸入或語音說出你的問題..."
              rows={2}
              style={{
                width: "100%", background: "#111120",
                border: `1px solid ${listeningTarget === "question" ? "#3a2a60" : "#222"}`,
                borderRadius: 8, padding: "10px 14px", color: "#e8e0d0",
                fontSize: ".95rem", fontFamily: "inherit", transition: "border-color .2s",
                resize: "vertical", lineHeight: 1.6
              }}
            />
            <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#4e4e68", fontSize: ".72rem" }}>快捷鍵：Cmd/Ctrl + Enter</span>
              <button
                type="button"
                onClick={handoffToCandidateAnswer}
                disabled={!currentQuestion.trim()}
                style={{
                  background: currentQuestion.trim() ? "#142034" : "#111",
                  border: `1px solid ${currentQuestion.trim() ? "#213652" : "#1a1a1a"}`,
                  borderRadius: 6,
                  padding: "5px 10px",
                  color: currentQuestion.trim() ? "#9ec1f7" : "#333",
                  fontSize: ".75rem",
                  cursor: currentQuestion.trim() ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  transition: "all .2s"
                }}
              >
                問完 → 轉到面試者錄音
              </button>
            </div>
            {listeningTarget === "question" && interimText && (
              <div style={{ marginTop: 4, padding: "4px 10px", background: "#1a1a30", borderRadius: 6, color: "#7060c0", fontSize: ".8rem", fontStyle: "italic" }}>
                ⏳ {interimText}
              </div>
            )}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <label style={{ color: "#4ade80", fontSize: ".75rem", letterSpacing: ".08em" }}>🎙 面試者回答摘要</label>
              <button onClick={() => toggleListening("answer")} style={{
                background: listeningTarget === "answer" ? "#1a3a1a" : "#1a1a2a",
                border: `1px solid ${listeningTarget === "answer" ? "#4ade80" : "#333"}`,
                borderRadius: 6, padding: "3px 10px",
                color: listeningTarget === "answer" ? "#4ade80" : "#555",
                fontSize: ".75rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                transition: "all .2s"
              }}>
                <span className={listeningTarget === "answer" ? "pulse" : ""}>●</span>
                {listeningTarget === "answer" ? "停止錄音" : "語音輸入"}
              </button>
            </div>
            <textarea
              ref={answerRef}
              value={currentAnswer}
              onChange={(e) => {
                currentAnswerRef.current = e.target.value;
                setCurrentAnswer(e.target.value);
              }}
              placeholder="輸入或語音記錄面試者說了什麼重點..."
              rows={3}
              style={{
                width: "100%", background: "#111120",
                border: `1px solid ${listeningTarget === "answer" ? "#2a4a2a" : "#222"}`,
                borderRadius: 8, padding: "10px 14px", color: "#e8e0d0",
                fontSize: ".9rem", fontFamily: "inherit", resize: "none", lineHeight: 1.6,
                transition: "border-color .2s"
              }}
            />
            {listeningTarget === "answer" && interimText && (
              <div style={{ marginTop: 4, padding: "4px 10px", background: "#1a2e1a", borderRadius: 6, color: "#2a8a4a", fontSize: ".8rem", fontStyle: "italic" }}>
                ⏳ {interimText}
              </div>
            )}
            {listeningTarget && micWarning && (
              <div style={{ marginTop: 6, padding: "6px 10px", background: "#2a1a12", border: "1px solid #4a2a16", borderRadius: 6, color: "#f59e0b", fontSize: ".78rem", lineHeight: 1.4 }}>
                ⚠ {micWarning}
              </div>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={callGemini} disabled={isLoading || !currentAnswer.trim()} style={{
              width: "100%",
              background: isLoading || !currentAnswer.trim() ? "#111" : "linear-gradient(135deg, #4c44af, #7c63ef)",
              border: "none", borderRadius: 8, padding: "10px",
              color: isLoading || !currentAnswer.trim() ? "#333" : "#fff",
              cursor: isLoading || !currentAnswer.trim() ? "not-allowed" : "pointer",
              fontWeight: 600, fontSize: ".9rem", fontFamily: "inherit"
            }}>
              {isLoading ? "分析中..." : "⚡ AI 分析"}
            </button>
          </div>
        </div>
      </div>

      {/* Right sidebar - AI results */}
      <div style={{ background: "#0d0d14", borderLeft: "1px solid #1a1a28", overflowY: "auto", padding: 20 }}>
        <div style={{ color: "#555", fontSize: ".75rem", letterSpacing: ".1em", marginBottom: 16 }}>AI 輔助面板</div>
        <button
          onClick={finishInterviewAndExport}
          disabled={!canExport}
          style={{
            width: "100%",
            marginBottom: 10,
            background: canExport ? "#1d3c7a" : "#111",
            border: `1px solid ${canExport ? "#2c4f96" : "#1a1a1a"}`,
            borderRadius: 8,
            padding: "10px 12px",
            color: canExport ? "#d7e6ff" : "#333",
            cursor: canExport ? "pointer" : "not-allowed",
            fontSize: ".85rem",
            fontWeight: 600,
            fontFamily: "inherit"
          }}
        >
          完成面試並匯出 Markdown
        </button>
        {exportStatus && (
          <div style={{ color: "#6ea8ff", fontSize: ".75rem", marginBottom: 14, lineHeight: 1.5 }}>
            {exportStatus}
          </div>
        )}

        {!aiResult && !isLoading && (
          <div style={{ color: "#333", fontSize: ".85rem", lineHeight: 1.8, textAlign: "center", marginTop: "3rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: 12, opacity: .3 }}>◈</div>
            輸入面試者回答<br />按「AI 分析」獲得建議
          </div>
        )}

        {isLoading && (
          <div style={{ textAlign: "center", marginTop: "3rem" }}>
            <div style={{ color: "#a78bfa", fontSize: "2rem", animation: "spin 1s linear infinite" }}>◌</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
            <div style={{ color: "#555", fontSize: ".85rem", marginTop: 12 }}>分析中...</div>
          </div>
        )}

        {aiResult && !aiResult.error && (
          <div className="fadeIn">
            {/* Quality score */}
            <div style={{ background: "#111120", border: "1px solid #1e1e35", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ color: "#666", fontSize: ".72rem", letterSpacing: ".1em", marginBottom: 8 }}>回答品質評估</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%",
                  border: `3px solid ${scoreColor(aiResult.quality?.score)}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.3rem", fontWeight: 700, color: scoreColor(aiResult.quality?.score),
                  fontFamily: "'JetBrains Mono', monospace", flexShrink: 0
                }}>
                  {aiResult.quality?.score}
                </div>
                <div>
                  <div style={{ color: scoreColor(aiResult.quality?.score), fontWeight: 700, fontSize: ".9rem" }}>
                    {aiResult.quality?.label || scoreLabel[aiResult.quality?.score]}
                  </div>
                  <div style={{ color: "#888", fontSize: ".8rem", marginTop: 2 }}>{aiResult.quality?.comment}</div>
                </div>
              </div>
            </div>

            {/* Next questions */}
            <div style={{ background: "#111120", border: "1px solid #1e1e35", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ color: "#666", fontSize: ".72rem", letterSpacing: ".1em", marginBottom: 10 }}>建議下一個問題</div>
              {aiResult.nextQuestions?.map((q, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <button onClick={() => {
                    currentQuestionRef.current = q;
                    setCurrentQuestion(q);
                  }} style={{
                    background: "none", border: "none", textAlign: "left",
                    color: "#c8c0e0", fontSize: ".85rem", lineHeight: 1.5, cursor: "pointer",
                    padding: "8px 10px", borderRadius: 6, width: "100%",
                    transition: "background .2s"
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = "#1a1a30"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    <span style={{ color: "#a78bfa", fontFamily: "'JetBrains Mono'", fontSize: ".75rem", marginRight: 8 }}>
                      {["①", "②", "③"][i]}
                    </span>
                    {q}
                  </button>
                </div>
              ))}
            </div>

            {/* Uncovered topics */}
            {aiResult.uncoveredTopics?.length > 0 && (
              <div style={{ background: "#1a1100", border: "1px solid #332200", borderRadius: 10, padding: 16 }}>
                <div style={{ color: "#a06010", fontSize: ".72rem", letterSpacing: ".1em", marginBottom: 8 }}>⚠ 尚未涵蓋的主題</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {aiResult.uncoveredTopics.map((t, i) => (
                    <span key={i} style={{
                      background: "#201500", border: "1px solid #3a2000",
                      borderRadius: 12, padding: "3px 10px", color: "#e0a020", fontSize: ".8rem"
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {aiResult?.error && (
          <div style={{ color: "#f87171", fontSize: ".85rem", textAlign: "center", marginTop: "2rem" }}>{aiResult.error}</div>
        )}

        {/* Tips */}
        <div style={{ marginTop: 24, padding: "12px 14px", background: "#0f0f1a", borderRadius: 8, border: "1px solid #151525" }}>
          <div style={{ color: "#444", fontSize: ".7rem", lineHeight: 1.8 }}>
            💡 點選建議問題可直接帶入輸入框<br />
            🎙 面試官問題與面試者回答均支援語音輸入<br />
            ✓ 記錄後對話會存入歷史供 AI 參考
          </div>
        </div>
      </div>
    </div>
  );
}
