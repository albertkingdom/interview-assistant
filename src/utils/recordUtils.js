export const formatDateTime = (isoString) => {
  const d = new Date(isoString);
  return d.toLocaleString("zh-TW", { hour12: false });
};

export const buildMarkdownFromRecord = (record) => {
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
