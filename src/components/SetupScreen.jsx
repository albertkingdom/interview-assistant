export function SetupScreen({
  isMobileLayout,
  setupScreenPadding,
  setupCardPadding,
  jobTitle,
  setJobTitle,
  customTopics,
  setCustomTopics,
  newTopicInput,
  setNewTopicInput,
  onStartInterview
}) {
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
            onChange={(e) => setJobTitle(e.target.value)}
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
            {customTopics.map((topic, index) => (
              <div key={index} style={{
                background: "#1a1a25", border: "1px solid #334",
                borderRadius: 20, padding: "4px 12px",
                display: "flex", alignItems: "center", gap: 6, color: "#c8c0e0", fontSize: ".85rem"
              }}>
                {topic}
                <button
                  onClick={() => setCustomTopics((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                  style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={newTopicInput}
              onChange={(e) => setNewTopicInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTopicInput.trim()) {
                  setCustomTopics((prev) => [...prev, newTopicInput.trim()]);
                  setNewTopicInput("");
                }
              }}
              placeholder="新增主題，按 Enter"
              style={{
                flex: 1, background: "#0d0d15", border: "1px solid #333", borderRadius: 8,
                padding: "8px 12px", color: "#e8e0d0", fontSize: ".9rem",
                fontFamily: "inherit", outline: "none"
              }}
            />
          </div>

          <button
            onClick={onStartInterview}
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
