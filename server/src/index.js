const DEFAULT_MODEL = "gpt-4o-mini-transcribe";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_SYSTEM_PROMPT = `你是一位資深面試輔助 AI，協助面試官在面試過程中做出更好的判斷與提問。

你會收到：
1. 目前面試職位與重點主題
2. 到目前為止的對話紀錄（面試官問題 + 面試者回答摘要）
3. 最新一則面試者的回答

請用繁體中文輸出以下 JSON 格式（不加任何 markdown code block）：
{
  "quality": {
    "score": 1-5的整數,
    "label": "優秀/良好/普通/薄弱/迴避",
    "comment": "一句話評語，20字以內"
  },
  "nextQuestions": [
    "建議追問問題1（根據剛才的回答深挖）",
    "建議問題2（轉換角度或方向）",
    "建議問題3（引導面試者舉例或量化）"
  ],
  "uncoveredTopics": ["還沒問到的主題1", "還沒問到的主題2"]
}`;
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    quality: {
      type: "OBJECT",
      properties: {
        score: { type: "INTEGER" },
        label: { type: "STRING" },
        comment: { type: "STRING" },
      },
      required: ["score", "label", "comment"],
    },
    nextQuestions: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    uncoveredTopics: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: ["quality", "nextQuestions", "uncoveredTopics"],
};

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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => Boolean(item));
};

const normalizeConversation = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      question: typeof item?.question === "string" ? item.question.trim() : "",
      answer: typeof item?.answer === "string" ? item.answer.trim() : "",
    }))
    .filter((item) => item.question && item.answer);
};

const buildGeminiUserMessage = (input = {}) => {
  const jobTitle =
    typeof input.jobTitle === "string" && input.jobTitle.trim() ? input.jobTitle.trim() : "未指定";
  const customTopics = normalizeStringArray(input.customTopics);
  const coveredTopics = normalizeStringArray(input.coveredTopics);
  const conversation = normalizeConversation(input.conversation);
  const latestAnswer =
    typeof input.latestAnswer === "string" ? input.latestAnswer.trim() : "";

  const historyText = conversation
    .map((c, i) => `第${i + 1}輪\n面試官：${c.question}\n面試者：${c.answer}`)
    .join("\n\n");

  return `職位：${jobTitle}
重點主題：${customTopics.join("、")}
已覆蓋主題：${coveredTopics.join("、") || "無"}

${historyText ? `對話紀錄：\n${historyText}\n\n` : ""}最新面試者回答：${latestAnswer}`;
};

const createGeminiAnalysis = async (env, userMessage) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: GEMINI_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          maxOutputTokens: 1000,
          temperature: 0.2,
        },
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Gemini request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = data;
    throw err;
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text ||
    "{}";
  return { text };
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

    if (pathname !== "/api/realtime/session" && pathname !== "/api/gemini/analyze") {
      return json({ error: "Not Found" }, 404, corsHeaders);
    }

    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405, corsHeaders);
    }

    const body = await parseJsonSafely(request);
    if (body === null) {
      return json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    if (pathname === "/api/realtime/session") {
      if (!env.OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY is not configured" }, 500, corsHeaders);
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
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "GEMINI_API_KEY is not configured" }, 500, corsHeaders);
    }

    const latestAnswer = typeof body?.latestAnswer === "string" ? body.latestAnswer.trim() : "";
    if (!latestAnswer) {
      return json({ error: "latestAnswer is required" }, 400, corsHeaders);
    }

    const userMessage = buildGeminiUserMessage(body);
    try {
      const result = await createGeminiAnalysis(env, userMessage);
      return json(
        {
          ok: true,
          text: result.text,
        },
        200,
        corsHeaders
      );
    } catch (err) {
      return json(
        {
          error: err.message || "Gemini analysis failed",
          details: err.payload || null,
        },
        err.status || 500,
        corsHeaders
      );
    }
  },
};
