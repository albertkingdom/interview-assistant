import { useState, useRef, useEffect } from "react";
import { buildMarkdownFromRecord } from "./utils/recordUtils";
import { saveInterviewRecordToStorage } from "./services/recordStorageService";
import { useAiAnalysis } from "./hooks/useAiAnalysis";
import { useInterviewFlow } from "./hooks/useInterviewFlow";
import { useSpeechController } from "./hooks/useSpeechController";
import { AnalysisSidebar } from "./components/AnalysisSidebar";
import { SetupScreen } from "./components/SetupScreen";
import { InterviewHeader } from "./components/InterviewHeader";
import { ConversationHistory } from "./components/ConversationHistory";
import { InterviewInputPanel } from "./components/InterviewInputPanel";

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
      <SetupScreen
        isMobileLayout={isMobileLayout}
        setupScreenPadding={setupScreenPadding}
        setupCardPadding={setupCardPadding}
        jobTitle={jobTitle}
        setJobTitle={setJobTitle}
        customTopics={customTopics}
        setCustomTopics={setCustomTopics}
        newTopicInput={newTopicInput}
        setNewTopicInput={setNewTopicInput}
        onStartInterview={() => {
          if (jobTitle.trim()) setPhase("interview");
        }}
      />
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

      <InterviewHeader
        isMobileLayout={isMobileLayout}
        headerPadding={headerPadding}
        jobTitle={jobTitle}
        customTopics={customTopics}
        coveredTopics={coveredTopics}
      />

      {/* Main content - conversation + input */}
      <div style={{ display: "flex", flexDirection: "column", overflow: isNarrowLayout ? "visible" : "hidden", minHeight: 0 }}>
        <ConversationHistory
          historyRef={historyRef}
          isNarrowLayout={isNarrowLayout}
          conversationPadding={conversationPadding}
          conversation={conversation}
        />

        <InterviewInputPanel
          inputAreaPadding={inputAreaPadding}
          showDetailControls={showDetailControls}
          setShowDetailControls={setShowDetailControls}
          sttEngine={sttEngine}
          setSttEngine={setSttEngine}
          realtimeStatus={realtimeStatus}
          speechLangMode={speechLangMode}
          setSpeechLangMode={setSpeechLangMode}
          audioInputConfig={audioInputConfig}
          toggleAudioInputConfig={toggleAudioInputConfig}
          runQuickAction={runQuickAction}
          quickActionStep={quickActionStep}
          isMobileLayout={isMobileLayout}
          toggleListening={toggleListening}
          listeningTarget={listeningTarget}
          currentQuestion={currentQuestion}
          currentQuestionRef={currentQuestionRef}
          setCurrentQuestion={setCurrentQuestion}
          handoffToCandidateAnswer={handoffToCandidateAnswer}
          interimText={interimText}
          answerRef={answerRef}
          currentAnswer={currentAnswer}
          currentAnswerRef={currentAnswerRef}
          setCurrentAnswer={setCurrentAnswer}
          micWarning={micWarning}
          runManualAnalysis={runManualAnalysis}
          isLoading={isLoading}
        />
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
