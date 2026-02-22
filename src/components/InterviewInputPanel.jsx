export function InterviewInputPanel({
  inputAreaPadding,
  showDetailControls,
  setShowDetailControls,
  sttEngine,
  setSttEngine,
  realtimeStatus,
  speechLangMode,
  setSpeechLangMode,
  audioInputConfig,
  toggleAudioInputConfig,
  runQuickAction,
  quickActionStep,
  isMobileLayout,
  toggleListening,
  listeningTarget,
  currentQuestion,
  currentQuestionRef,
  setCurrentQuestion,
  handoffToCandidateAnswer,
  interimText,
  answerRef,
  currentAnswer,
  currentAnswerRef,
  setCurrentAnswer,
  micWarning,
  runManualAnalysis,
  isLoading
}) {
  return (
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
  );
}
