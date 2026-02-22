import { useRef, useState } from "react";
import { requestGeminiAnalysis } from "../services/geminiAnalysisService";
import { parseAiJson } from "../utils/aiJsonUtils";

export const useAiAnalysis = ({
  jobTitle,
  customTopics,
  coveredTopics,
  onAppendConversation,
  onBeforeManualAnalysis,
  onBackgroundSkipped,
  onUpdateCoveredTopics
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const analysisInFlightRef = useRef(false);

  const callGemini = async ({
    questionSnapshot = "",
    answerSnapshot = "",
    conversationSnapshot = [],
    mode = "manual" // manual | background
  } = {}) => {
    const questionText = questionSnapshot.trim();
    const answerText = answerSnapshot.trim();
    if (analysisInFlightRef.current) {
      if (mode === "background") {
        onBackgroundSkipped?.();
      }
      return false;
    }
    if (!answerText) return false;

    onAppendConversation?.(questionText, answerText);
    if (mode === "manual") {
      await onBeforeManualAnalysis?.();
    }

    analysisInFlightRef.current = true;
    setIsLoading(true);
    setAiResult(null);

    try {
      const data = await requestGeminiAnalysis({
        jobTitle,
        customTopics,
        coveredTopics,
        conversation: conversationSnapshot,
        latestAnswer: answerText
      });

      const text = data?.text || "{}";
      const parsed = parseAiJson(text);
      setAiResult(parsed);

      if (parsed.uncoveredTopics) {
        const uncovered = new Set(parsed.uncoveredTopics);
        const newCovered = customTopics.filter((topic) => !uncovered.has(topic));
        onUpdateCoveredTopics?.(newCovered);
      }
    } catch (e) {
      console.error(e);
      const msg = e?.message || "未知錯誤";
      setAiResult({ error: `分析失敗：${msg}` });
    } finally {
      analysisInFlightRef.current = false;
      setIsLoading(false);
    }
    return true;
  };

  return {
    isLoading,
    aiResult,
    callGemini
  };
};
