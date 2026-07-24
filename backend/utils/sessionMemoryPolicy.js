/**
 * Decide whether a prompt should use/update session memory when no bot is selected.
 * Bot selection always implies session memory is important.
 */

const CASUAL_EXACT = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "sup",
  "hiya",
  "thanks",
  "thank you",
  "thx",
  "ty",
  "ok",
  "okay",
  "k",
  "kk",
  "yes",
  "yep",
  "yeah",
  "no",
  "nope",
  "cool",
  "nice",
  "great",
  "good",
  "bye",
  "goodbye",
  "see you",
  "gm",
  "gn",
  "lol",
  "haha",
  "test",
  "testing",
]);

const CASUAL_PREFIX =
  /^(hi|hello|hey|thanks|thank you|ok(ay)?|bye|goodbye|cool|nice|great)([!.\s]*)$/i;

const EMOJI_OR_PUNCT_ONLY = /^[\p{Emoji}\p{P}\p{Z}]+$/u;

const normalizePrompt = (prompt) =>
  String(prompt || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * @param {string} prompt
 * @returns {boolean} true when the prompt looks substantive / important
 */
const isImportantPrompt = (prompt) => {
  const text = String(prompt || "").trim();
  if (!text) return false;

  const normalized = normalizePrompt(text);

  if (CASUAL_EXACT.has(normalized)) return false;
  if (CASUAL_PREFIX.test(normalized)) return false;
  if (EMOJI_OR_PUNCT_ONLY.test(text)) return false;

  // Very short fillers without a question mark
  if (normalized.length < 12 && !normalized.includes("?")) return false;

  // Short but asking something still counts as important
  if (normalized.includes("?") && normalized.length >= 8) return true;

  // Default: treat longer / work-like prompts as important
  return normalized.length >= 12;
};

/**
 * @param {{ assistant?: object | null, prompt: string }} args
 */
const shouldUseSessionMemory = ({ assistant, prompt }) => {
  if (assistant) return true;
  return isImportantPrompt(prompt);
};

module.exports = {
  isImportantPrompt,
  shouldUseSessionMemory,
};
