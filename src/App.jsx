import { useState, useRef, useEffect } from "react";
import { buildMarkdownFromRecord } from "./utils/recordUtils";
import { saveInterviewRecordToStorage } from "./services/recordStorageService";
import { useAiAnalysis } from "./hooks/useAiAnalysis";
import { useInterviewFlow } from "./hooks/useInterviewFlow";
import { useSpeechController } from "./hooks/useSpeechController";
import { AnalysisSidebar } from "./components/AnalysisSidebar";

const TOPICS_DEFAULT = ["技術能力", "過去經驗", "問題解決", "團隊合作", "自我驅動", "職涯規劃"];
const RECORDS_STORAGE_KEY = "interview-assistant.records.v1";

export default function InterviewAssistant() {
  const [jobTitle, setJobTitle] = useState("");
  const [customTopics, setCustomTopics] = useState(TOPICS_DEFAULT);
  const [coveredTopics, setCoveredTopics] = useState([]);
  const [phase, setPhase] = useState("setup"); // setup | interview
  const [newTopicInput, setNewTopicInput] = useState("");
  const [showDetailControls, setShowDetailControls] = useState(false);
  const [interimText, setInterimText] = useState(""); // live interim display
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280)
  );
  const accumulatedRef = useRef("");
  const currentQuestionRef = useRef("");
  const currentAnswerRef = useRef("");
  const listeningTargetRef = useRef(null); // mirror for use inside callbacks
  const latestInterimRef = useRef({ question: "", answer: "" });
  const appendFinalChunkRef = useRef((baseText = "") => baseText);
  const answerRef = useRef(null);
  const historyRef = useRef(null);
  const {
    conversation,
    currentAnswer,
    setCurrentAnswer,
    currentQuestion,
    setCurrentQuestion,
    exportStatus,
    setExportStatus,
    quickActionStep,
    setQuickActionStep,
    appendConversationIfNeeded,
    buildConversationSnapshot,
    clearCurrentTurnInputs,
    buildInterviewRecord
  } = useInterviewFlow({
    jobTitle,
    customTopics,
    coveredTopics,
    historyRef,
    currentQuestionRef,
    currentAnswerRef,
    accumulatedRef,
    latestInterimRef,
    setInterimText
  });

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    currentAnswerRef.current = currentAnswer;
  }, [currentAnswer]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const {
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
  } = useSpeechController({
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
  });

  const { isLoading, aiResult, callGemini } = useAiAnalysis({
    jobTitle,
    customTopics,
    coveredTopics,
    onAppendConversation: appendConversationIfNeeded,
    onBeforeManualAnalysis: async () => {
      await stopActiveListening();
      clearCurrentTurnInputs();
      setQuickActionStep(0);
    },
    onBackgroundSkipped: () => setExportStatus("背景分析仍在進行，已略過本次分析"),
    onUpdateCoveredTopics: setCoveredTopics
  });

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
    await stopActiveListening();

    const record = buildInterviewRecord({ aiSummarySnapshot: aiResult });
    if (record.conversation.length === 0) {
      setExportStatus("尚無對話可匯出");
      return;
    }

    try {
      saveInterviewRecordToStorage(RECORDS_STORAGE_KEY, record);
      const markdown = buildMarkdownFromRecord(record);
      downloadMarkdown(record, markdown);
      setExportStatus("已儲存面試紀錄，並下載 Markdown");
    } catch (err) {
      console.error(err);
      setExportStatus("匯出失敗，請稍後再試");
    }
  };

  const runManualAnalysis = async () => {
    flushPendingInterim();
    const questionSnapshot = currentQuestionRef.current.trim();
    const answerSnapshot = currentAnswerRef.current.trim();
    const conversationSnapshot = buildConversationSnapshot(questionSnapshot, answerSnapshot);
    await callGemini({
      questionSnapshot,
      answerSnapshot,
      conversationSnapshot,
      mode: "manual"
    });
  };

  const handlePickSuggestedQuestion = (question) => {
    currentQuestionRef.current = question;
    setCurrentQuestion(question);
  };

  const runQuickAction = async () => {
    if (quickActionStep === 0) {
      if (listeningTargetRef.current !== "question") {
        await toggleListening("question");
      }
      setExportStatus("快速流程：請錄面試官問題");
      setQuickActionStep(1);
      return;
    }

    if (quickActionStep === 1) {
      if (listeningTargetRef.current !== "answer") {
        await toggleListening("answer");
      }
      setExportStatus("快速流程：請錄面試者回答");
      setQuickActionStep(2);
      return;
    }

    flushPendingInterim();
    const questionSnapshot = currentQuestionRef.current.trim();
    const answerSnapshot = currentAnswerRef.current.trim();
    if (!answerSnapshot) {
      setExportStatus("快速流程：尚未有面試者回答，請先錄音");
      return;
    }

    const conversationSnapshot = buildConversationSnapshot(questionSnapshot, answerSnapshot);
    const record = buildInterviewRecord({
      questionSnapshot,
      answerSnapshot,
      conversationSnapshot,
      aiSummarySnapshot: aiResult
    });
    if (record.conversation.length === 0) {
      setExportStatus("快速流程：尚無對話可儲存");
      return;
    }

    try {
      saveInterviewRecordToStorage(RECORDS_STORAGE_KEY, record);
      setExportStatus("已儲存面試紀錄，背景 AI 分析中，可直接錄下一題");
    } catch (err) {
      console.error(err);
      setExportStatus("儲存紀錄失敗，仍嘗試進行 AI 分析");
    }

    clearCurrentTurnInputs();
    if (listeningTargetRef.current !== "question") {
      await toggleListening("question");
    }
    setQuickActionStep(1);

    void callGemini({
      questionSnapshot,
      answerSnapshot,
      conversationSnapshot,
      mode: "background"
    });
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
  const isNarrowLayout = viewportWidth < 1100;
  const isMobileLayout = viewportWidth < 768;
  const setupScreenPadding = isMobileLayout ? "1rem" : "2rem";
  const setupCardPadding = isMobileLayout ? "1.25rem" : "2rem";
  const headerPadding = isMobileLayout ? "10px 12px" : "12px 24px";
  const conversationPadding = isMobileLayout ? "14px 12px" : "20px 24px";
  const inputAreaPadding = isMobileLayout ? "12px" : "16px 24px";
  const rightPanelPadding = isMobileLayout ? 12 : 20;

  if (phase === "setup") {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a0f",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
        padding: setupScreenPadding
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap');
          * { box-sizing: border-box; }
          * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: #111; }
          ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        `}</style>
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: "3rem" }}>
              <div style={{ fontSize: isMobileLayout ? "2.3rem" : "3rem", marginBottom: ".5rem" }}>⬡</div>
              <h1 style={{ color: "#e8e0d0", fontSize: "1.8rem", fontWeight: 700, margin: 0, letterSpacing: ".05em" }}>面試輔助系統</h1>
              <p style={{ color: "#666", marginTop: ".5rem", fontSize: ".9rem" }}>AI 即時分析 · 現場面試專用</p>
            </div>

          <div style={{ background: "#111118", border: "1px solid #222", borderRadius: 12, padding: setupCardPadding }}>
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
              onClick={() => { if (jobTitle.trim()) setPhase("interview"); }}
              style={{
                width: "100%", marginTop: "2rem",
                background: jobTitle.trim() ? "linear-gradient(135deg, #6c63ff, #a78bfa)" : "#222",
                border: "none", borderRadius: 10, padding: "14px",
                color: jobTitle.trim() ? "#fff" : "#444", fontSize: "1rem", fontWeight: 600,
                cursor: jobTitle.trim() ? "pointer" : "not-allowed",
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
      fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
      display: "grid",
      gridTemplateColumns: isNarrowLayout ? "1fr" : "minmax(0, 1fr) 340px",
      gridTemplateRows: isNarrowLayout ? "auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr)",
      height: isNarrowLayout ? "auto" : "100vh",
      overflow: isNarrowLayout ? "visible" : "hidden"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
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
      <div style={{
        gridColumn: "1/-1",
        background: "#0d0d14",
        borderBottom: "1px solid #1a1a28",
        padding: headerPadding,
        display: "flex",
        flexDirection: isMobileLayout ? "column" : "row",
        alignItems: isMobileLayout ? "flex-start" : "center",
        justifyContent: isMobileLayout ? "flex-start" : "space-between",
        gap: isMobileLayout ? 10 : 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>⬡</span>
          <span style={{ color: "#888", fontSize: ".85rem" }}>面試輔助</span>
          <span style={{ color: "#444" }}>·</span>
          <span style={{ color: "#a78bfa", fontWeight: 700, wordBreak: "break-word" }}>{jobTitle}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: isMobileLayout ? "100%" : "auto" }}>
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
      <div style={{ display: "flex", flexDirection: "column", overflow: isNarrowLayout ? "visible" : "hidden", minHeight: 0 }}>
        {/* History */}
        <div ref={historyRef} style={{ flex: 1, overflowY: isNarrowLayout ? "visible" : "auto", padding: conversationPadding }}>
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
        <div style={{ padding: inputAreaPadding, background: "#0d0d14", borderTop: "1px solid #1a1a28" }}>
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setShowDetailControls((prev) => !prev)}
              style={{
                width: "100%",
                background: showDetailControls ? "#1c2234" : "#12121d",
                border: `1px solid ${showDetailControls ? "#2e3c62" : "#1f1f30"}`,
                borderRadius: 8,
                padding: "9px 12px",
                color: showDetailControls ? "#c7d6f6" : "#8a8aa5",
                fontSize: ".8rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left"
              }}
            >
              {showDetailControls ? "▾ 細節調整（已展開）" : "▸ 細節調整"}
            </button>
            {showDetailControls && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: "#10101a", border: "1px solid #1b1b2a", borderRadius: 8 }}>
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
                    辨識語言：{sttEngine === "openai-realtime" ? "自動" : "中英混合"}
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
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={runQuickAction}
              style={{
                width: "100%",
                background: quickActionStep === 0
                  ? "linear-gradient(135deg, #2a3f77, #4567b2)"
                  : quickActionStep === 1
                    ? "linear-gradient(135deg, #2a5b36, #3f8a55)"
                    : "linear-gradient(135deg, #6b3c15, #c9732a)",
                border: "none",
                borderRadius: 10,
                padding: "11px 12px",
                color: "#fff",
                fontWeight: 700,
                fontSize: ".88rem",
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: ".02em"
              }}
            >
              {quickActionStep === 0 && "① 開始錄面試官問題"}
              {quickActionStep === 1 && "② 轉到面試者回答錄音"}
              {quickActionStep === 2 && "③ 儲存紀錄 + 背景AI分析 + 繼續下一題"}
            </button>
            <div style={{ marginTop: 6, color: "#5a5a74", fontSize: ".72rem", lineHeight: 1.4 }}>
              快速模式：連按三次即可完成一輪，AI 分析在背景進行，不中斷下一題錄音。
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: isMobileLayout ? "wrap" : "nowrap", gap: 6 }}>
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
            <div style={{
              marginTop: 6,
              display: "flex",
              justifyContent: "space-between",
              alignItems: isMobileLayout ? "flex-start" : "center",
              gap: 8,
              flexDirection: isMobileLayout ? "column" : "row"
            }}>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: isMobileLayout ? "wrap" : "nowrap", gap: 6 }}>
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
            <button onClick={runManualAnalysis} disabled={isLoading || !currentAnswer.trim()} style={{
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

      <AnalysisSidebar
        isNarrowLayout={isNarrowLayout}
        rightPanelPadding={rightPanelPadding}
        finishInterviewAndExport={finishInterviewAndExport}
        canExport={canExport}
        exportStatus={exportStatus}
        aiResult={aiResult}
        isLoading={isLoading}
        scoreColor={scoreColor}
        scoreLabel={scoreLabel}
        onPickQuestion={handlePickSuggestedQuestion}
      />
    </div>
  );
}
