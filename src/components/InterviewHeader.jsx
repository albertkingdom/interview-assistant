export function InterviewHeader({
  isMobileLayout,
  headerPadding,
  jobTitle,
  customTopics,
  coveredTopics
}) {
  return (
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
        {customTopics.map((topic) => (
          <span key={topic} style={{
            fontSize: ".72rem", padding: "2px 8px", borderRadius: 10,
            background: coveredTopics.includes(topic) ? "#1a3a1a" : "#1a1a2e",
            color: coveredTopics.includes(topic) ? "#4ade80" : "#666",
            border: `1px solid ${coveredTopics.includes(topic) ? "#2a4a2a" : "#222"}`
          }}>
            {coveredTopics.includes(topic) ? "✓ " : ""}
            {topic}
          </span>
        ))}
      </div>
    </div>
  );
}
