const crypto = require("crypto");

const DEFAULT_MAX_CHARS = 3500;
const DEFAULT_OVERLAP_CHARS = 200;

const estimateTokenCount = (text) =>
  Math.max(1, Math.ceil(String(text || "").length / 4));

const hashContent = (content) =>
  crypto.createHash("sha256").update(content).digest("hex");

const splitOversized = (text, maxChars) => {
  if (text.length <= maxChars) return [text];

  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n\n", end);
      if (breakAt > start + Math.floor(maxChars * 0.4)) {
        end = breakAt;
      }
    }
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - DEFAULT_OVERLAP_CHARS, start + 1);
  }
  return parts.filter(Boolean);
};

const extractHeading = (chunk) => {
  const match = chunk.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim().slice(0, 500) : null;
};

const chunkMarkdown = (
  markdown,
  { maxChars = DEFAULT_MAX_CHARS } = {}
) => {
  const source = String(markdown || "").trim();
  if (!source) return [];

  const sections = source.split(/(?=^#{1,3}\s+)/m).map((part) => part.trim()).filter(Boolean);
  const chunks = [];

  for (const section of sections) {
    for (const piece of splitOversized(section, maxChars)) {
      chunks.push({
        heading: extractHeading(piece),
        content: piece,
        contentHash: hashContent(piece),
        tokenCount: estimateTokenCount(piece),
      });
    }
  }

  return chunks;
};

module.exports = {
  chunkMarkdown,
  estimateTokenCount,
  hashContent,
};
