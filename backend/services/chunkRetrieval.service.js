const { pool } = require("../config/database");

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

const scoreChunk = (queryTokens, content) => {
  if (queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  let hits = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) hits += 1;
  }
  return hits / queryTokens.length;
};

const retrieveRelevantChunks = async (
  workspaceId,
  query,
  { limit = 4, maxChars = 6000 } = {}
) => {
  const [rows] = await pool.execute(
    `
    SELECT
      c.id,
      c.heading,
      c.content,
      c.token_count,
      d.original_name
    FROM document_chunks c
    INNER JOIN workspace_documents d ON d.id = c.document_id
    WHERE d.workspace_id = ?
      AND d.status = 'ready'
    ORDER BY c.created_at ASC
    LIMIT 200
    `,
    [workspaceId]
  );

  if (rows.length === 0) return [];

  const queryTokens = tokenize(query);
  const ranked = rows
    .map((row) => ({
      ...row,
      score: scoreChunk(queryTokens, `${row.heading || ""} ${row.content}`),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  let usedChars = 0;

  for (const row of ranked) {
    if (row.score <= 0 && selected.length >= 2) continue;
    const piece = row.content.length > 1800
      ? `${row.content.slice(0, 1800)}…`
      : row.content;
    if (usedChars + piece.length > maxChars && selected.length > 0) break;
    selected.push({
      documentName: row.original_name,
      heading: row.heading,
      content: piece,
      score: row.score,
    });
    usedChars += piece.length;
    if (selected.length >= limit) break;
  }

  if (selected.length === 0) {
    return ranked.slice(0, Math.min(2, ranked.length)).map((row) => ({
      documentName: row.original_name,
      heading: row.heading,
      content:
        row.content.length > 1800
          ? `${row.content.slice(0, 1800)}…`
          : row.content,
      score: row.score,
    }));
  }

  return selected;
};

module.exports = { retrieveRelevantChunks };
