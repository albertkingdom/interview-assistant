const escapeControlCharsInString = (text) => {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString && (char === "\n" || char === "\r")) {
      result += "\\n";
      continue;
    }

    if (inString && char === "\t") {
      result += "\\t";
      continue;
    }

    result += char;
  }

  return result;
};

const extractJsonObjectText = (text) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
};

export const parseAiJson = (rawText) => {
  if (!rawText) return {};
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const jsonCandidates = [cleaned, extractJsonObjectText(cleaned)];

  for (const candidate of jsonCandidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      const repaired = escapeControlCharsInString(candidate).replace(/,\s*([}\]])/g, "$1");
      try {
        return JSON.parse(repaired);
      } catch {
        // try next candidate
      }
    }
  }

  throw new Error("模型回傳格式不完整，請再試一次");
};
