export function ConversationHistory({
  historyRef,
  isNarrowLayout,
  conversationPadding,
  conversation
}) {
  return (
    <div ref={historyRef} style={{ flex: 1, overflowY: isNarrowLayout ? "visible" : "auto", padding: conversationPadding }}>
      {conversation.length === 0 && (
        <div style={{ color: "#333", textAlign: "center", marginTop: "3rem", fontSize: ".9rem" }}>
          開始輸入第一個問題與面試者回答 ↓
        </div>
      )}
      {conversation.map((item, index) => (
        <div key={index} className="fadeIn" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
            <span style={{ background: "#1a1a35", border: "1px solid #334", borderRadius: 6, padding: "2px 8px", fontSize: ".7rem", color: "#a78bfa" }}>面試官</span>
            <span style={{ color: "#ccc", fontSize: ".9rem" }}>{item.question}</span>
          </div>
          <div style={{ display: "flex", gap: 10, paddingLeft: 16, borderLeft: "2px solid #1e1e30" }}>
            <span style={{ background: "#1a2e1a", border: "1px solid #2a3a2a", borderRadius: 6, padding: "2px 8px", fontSize: ".7rem", color: "#4ade80", flexShrink: 0 }}>面試者</span>
            <span style={{ color: "#999", fontSize: ".9rem", lineHeight: 1.6 }}>{item.answer}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
