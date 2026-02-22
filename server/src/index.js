const DEFAULT_MODEL = "gpt-4o-mini-transcribe";

const json = (payload, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

const getCorsHeaders = (request, env) => {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigin = env.ALLOWED_ORIGIN?.trim();
  const origin =
    allowedOrigin && requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
};

const parseJsonSafely = async (request) => {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const buildSessionPayload = (input = {}) => {
  const model = String(input.model || DEFAULT_MODEL).trim();
  const languageRaw = typeof input.language === "string" ? input.language.trim() : "";
  const language = languageRaw === "auto" ? "" : languageRaw || "zh";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const includeLogprobs = Boolean(input.includeLogprobs);
  const noiseReductionType =
    input.noiseReductionType === "far_field" ? "far_field" : "near_field";

  const silenceDurationMs = Number(input.silenceDurationMs);
  const turnDetection = {
    type: "server_vad",
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms:
      Number.isFinite(silenceDurationMs) && silenceDurationMs >= 200 && silenceDurationMs <= 3000
        ? Math.floor(silenceDurationMs)
        : 900,
  };

  return {
    input_audio_format: "pcm16",
    input_audio_transcription: {
      model,
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {}),
    },
    input_audio_noise_reduction: {
      type: noiseReductionType,
    },
    turn_detection: turnDetection,
    ...(includeLogprobs ? { include: ["item.input_audio_transcription.logprobs"] } : {}),
  };
};

const createRealtimeSession = async (env, sessionPayload) => {
  const response = await fetch("https://api.openai.com/v1/realtime/transcription_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(sessionPayload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
};

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request, env);
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "interview-assistant-api" }, 200, corsHeaders);
    }

    if (pathname !== "/api/realtime/session") {
      return json({ error: "Not Found" }, 404, corsHeaders);
    }

    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405, corsHeaders);
    }

    if (!env.OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY is not configured" }, 500, corsHeaders);
    }

    const body = await parseJsonSafely(request);
    if (body === null) {
      return json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const sessionPayload = buildSessionPayload(body);
    try {
      const session = await createRealtimeSession(env, sessionPayload);
      return json(
        {
          ok: true,
          session,
          config: {
            model: sessionPayload.input_audio_transcription.model,
            language: sessionPayload.input_audio_transcription.language,
            includeLogprobs: Boolean(sessionPayload.include),
            noiseReductionType: sessionPayload.input_audio_noise_reduction.type,
            silenceDurationMs: sessionPayload.turn_detection.silence_duration_ms,
          },
        },
        200,
        corsHeaders
      );
    } catch (err) {
      return json(
        {
          error: err.message || "Failed to create realtime session",
          details: err.payload || null,
        },
        err.status || 500,
        corsHeaders
      );
    }
  },
};
