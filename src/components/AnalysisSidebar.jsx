export function AnalysisSidebar({
  isNarrowLayout,
  rightPanelPadding,
  finishInterviewAndExport,
  canExport,
  exportStatus,
  aiResult,
  isLoading,
  scoreColor,
  scoreLabel,
  onPickQuestion
}) {
  return (
    <div style={{
      background: "#0d0d14",
      borderLeft: isNarrowLayout ? "none" : "1px solid #1a1a28",
      borderTop: isNarrowLayout ? "1px solid #1a1a28" : "none",
      overflowY: isNarrowLayout ? "visible" : "auto",
      padding: rightPanelPadding,
      minHeight: 0
    }}>
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

          <div style={{ background: "#111120", border: "1px solid #1e1e35", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ color: "#666", fontSize: ".72rem", letterSpacing: ".1em", marginBottom: 10 }}>建議下一個問題</div>
            {aiResult.nextQuestions?.map((q, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <button
                  onClick={() => onPickQuestion(q)}
                  style={{
                    background: "none", border: "none", textAlign: "left",
                    color: "#c8c0e0", fontSize: ".85rem", lineHeight: 1.5, cursor: "pointer",
                    padding: "8px 10px", borderRadius: 6, width: "100%",
                    transition: "background .2s"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a30"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <span style={{ color: "#a78bfa", fontFamily: "'JetBrains Mono'", fontSize: ".75rem", marginRight: 8 }}>
                    {["①", "②", "③"][i]}
                  </span>
                  {q}
                </button>
              </div>
            ))}
          </div>

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

      <div style={{ marginTop: 24, padding: "12px 14px", background: "#0f0f1a", borderRadius: 8, border: "1px solid #151525" }}>
        <div style={{ color: "#444", fontSize: ".7rem", lineHeight: 1.8 }}>
          💡 點選建議問題可直接帶入輸入框<br />
          🎙 面試官問題與面試者回答均支援語音輸入<br />
          ✓ 記錄後對話會存入歷史供 AI 參考
        </div>
      </div>
    </div>
  );
}
