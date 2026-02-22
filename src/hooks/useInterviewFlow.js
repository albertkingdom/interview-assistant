import { useState } from "react";

export const useInterviewFlow = ({
  jobTitle,
  customTopics,
  coveredTopics,
  historyRef,
  currentQuestionRef,
  currentAnswerRef,
  accumulatedRef,
  latestInterimRef,
  setInterimText
}) => {
  const [conversation, setConversation] = useState([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [quickActionStep, setQuickActionStep] = useState(0); // 0: question, 1: answer, 2: save+background analyze+continue

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

  const buildConversationSnapshot = (
    questionInput = currentQuestionRef.current,
    answerInput = currentAnswerRef.current
  ) => {
    const items = [...conversation];
    const pendingQuestion = questionInput.trim();
    const pendingAnswer = answerInput.trim();
    if (!pendingQuestion || !pendingAnswer) return items;

    const last = items[items.length - 1];
    if (last?.question === pendingQuestion && last?.answer === pendingAnswer) return items;
    return [...items, { question: pendingQuestion, answer: pendingAnswer }];
  };

  const clearCurrentTurnInputs = () => {
    setCurrentQuestion("");
    setCurrentAnswer("");
    currentQuestionRef.current = "";
    currentAnswerRef.current = "";
    accumulatedRef.current = "";
    latestInterimRef.current.question = "";
    latestInterimRef.current.answer = "";
    setInterimText("");
  };

  const buildInterviewRecord = ({
    questionSnapshot = currentQuestionRef.current,
    answerSnapshot = currentAnswerRef.current,
    conversationSnapshot,
    aiSummarySnapshot = null
  } = {}) => {
    const items = conversationSnapshot || buildConversationSnapshot(questionSnapshot, answerSnapshot);

    return {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      jobTitle: jobTitle.trim() || "未指定",
      topics: [...customTopics],
      coveredTopics: [...coveredTopics],
      conversation: items,
      aiSummary: aiSummarySnapshot && !aiSummarySnapshot.error ? aiSummarySnapshot : null
    };
  };

  return {
    conversation,
    setConversation,
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
  };
};
