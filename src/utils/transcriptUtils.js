export const mergeTranscript = (baseText = "", appendedText = "") => {
  if (!appendedText) return baseText;
  if (!baseText) return appendedText;
  if (baseText.endsWith(appendedText)) return baseText;
  if (appendedText.startsWith(baseText)) return appendedText;

  const maxOverlap = Math.min(baseText.length, appendedText.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (baseText.slice(-overlap) === appendedText.slice(0, overlap)) {
      return baseText + appendedText.slice(overlap);
    }
  }
  return baseText + appendedText;
};

export const appendFinalChunk = (baseText = "", finalChunk = "", addLineBreak = false) => {
  if (!finalChunk || !finalChunk.trim()) return baseText;
  if (!baseText) return finalChunk.trimStart();
  if (!addLineBreak) return mergeTranscript(baseText, finalChunk);
  const baseWithBreak = baseText.endsWith("\n") ? baseText : `${baseText}\n`;
  return mergeTranscript(baseWithBreak, finalChunk.trimStart());
};

export const stabilizeInterim = (previousInterim = "", nextInterim = "") => {
  if (!previousInterim || !nextInterim) return nextInterim;
  if (previousInterim.length > nextInterim.length && previousInterim.startsWith(nextInterim)) {
    return previousInterim;
  }
  return nextInterim;
};
