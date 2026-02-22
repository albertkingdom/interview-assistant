const resolveApiBaseUrl = (rawBaseUrl) => {
  const base = (rawBaseUrl || "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
};

export const requestGeminiAnalysis = async ({
  jobTitle,
  customTopics,
  coveredTopics,
  conversation,
  latestAnswer,
  apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ""
}) => {
  const apiBase = resolveApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${apiBase}/api/gemini/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jobTitle,
      customTopics,
      coveredTopics,
      conversation,
      latestAnswer
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = payload?.error?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(errMsg);
  }
  return payload;
};
