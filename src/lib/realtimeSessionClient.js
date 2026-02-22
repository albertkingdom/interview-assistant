const DEFAULT_TIMEOUT_MS = 12000;

const resolveApiBaseUrl = () => {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (!fromEnv) return "";
  return fromEnv.endsWith("/") ? fromEnv.slice(0, -1) : fromEnv;
};

export const createRealtimeTranscriptionSession = async (options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${resolveApiBaseUrl()}/api/realtime/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model || "gpt-4o-mini-transcribe",
        language: options.language || "zh",
        prompt: options.prompt || "",
        includeLogprobs: Boolean(options.includeLogprobs),
        noiseReductionType: options.noiseReductionType || "near_field",
        silenceDurationMs: options.silenceDurationMs || 900,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || `Session create failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
};
