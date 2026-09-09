/**
 * Part 14D.5 — Gmail polling trigger (not push). Durable cursor per workflow/node.
 */

const { googleApiRequest } = require("./googleOAuth.service");
const {
  getTriggerCursor,
  setTriggerCursor,
} = require("./workflowTriggerCursors.service");

const MIN_POLL_MS = 60_000;
const MAX_POLL_MS = 3_600_000;
const DEFAULT_POLL_MS = 300_000;
const SEEN_CAP = 200;
const POLL_BATCH = 25;

const clampPollMs = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_POLL_MS;
  return Math.min(Math.max(n, MIN_POLL_MS), MAX_POLL_MS);
};

const buildQuery = (data) => {
  const parts = [];
  if (data.unreadOnly) parts.push("is:unread");
  if (data.label || data.gmailLabel) parts.push(`label:${String(data.gmailLabel || data.label).trim()}`);
  if (data.from) parts.push(`from:${String(data.from).trim()}`);
  if (data.to) parts.push(`to:${String(data.to).trim()}`);
  if (data.subject) parts.push(`subject:${JSON.stringify(String(data.subject).trim())}`);
  if (data.query) parts.push(String(data.query).trim());
  return parts.filter(Boolean).join(" ");
};

const headerMap = (payload) => {
  const out = {};
  for (const h of payload?.headers || []) {
    if (h.name) out[String(h.name).toLowerCase()] = h.value;
  }
  return out;
};

const fetchMetadata = async (credentialId, workspaceId, id) => {
  const res = await googleApiRequest({
    credentialId,
    workspaceId,
    requiredType: "google_gmail",
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
    method: "GET",
    timeoutMs: 20000,
  });
  const msg = res.body || {};
  const h = headerMap(msg.payload);
  return {
    json: {
      id: msg.id,
      threadId: msg.threadId,
      labelIds: msg.labelIds || [],
      from: h.from || "",
      to: h.to || "",
      cc: h.cc || "",
      subject: h.subject || "",
      date: h.date || "",
      snippet: msg.snippet || "",
      internalDate: Number(msg.internalDate) || 0,
      attachmentMetadata: (msg.payload?.parts || [])
        .filter((p) => p.filename)
        .map((p) => ({ fileName: p.filename, mimeType: p.mimeType })),
    },
  };
};

/**
 * One poll tick. First tick seeds the cursor and emits nothing.
 */
const pollGmailTriggerOnce = async ({
  workflowId,
  nodeId,
  workspaceId,
  data = {},
}) => {
  const credentialId = String(data.credentialId || "").trim();
  if (!credentialId) {
    const err = new Error("Gmail Trigger requires a Google credential");
    err.code = "GOOGLE_CREDENTIAL_REQUIRED";
    throw err;
  }
  const q = buildQuery(data);
  const cursor = (await getTriggerCursor(workflowId, nodeId)) || {
    seeded: false,
    lastInternalDate: 0,
    seenIds: [],
  };

  const params = new URLSearchParams({ maxResults: String(POLL_BATCH) });
  if (q) params.set("q", q);

  const list = await googleApiRequest({
    credentialId,
    workspaceId,
    requiredType: "google_gmail",
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    method: "GET",
    timeoutMs: 20000,
  });
  const listed = Array.isArray(list.body?.messages) ? list.body.messages : [];

  if (!cursor.seeded) {
    const seenIds = listed.map((m) => m.id).filter(Boolean).slice(0, SEEN_CAP);
    let lastInternalDate = 0;
    if (listed[0]?.id) {
      const meta = await fetchMetadata(credentialId, workspaceId, listed[0].id);
      lastInternalDate = meta.json.internalDate || Date.now();
    } else {
      lastInternalDate = Date.now();
    }
    await setTriggerCursor(workflowId, nodeId, {
      seeded: true,
      lastInternalDate,
      seenIds,
    });
    return { items: [], seeded: true, emitted: 0 };
  }

  const seen = new Set(cursor.seenIds || []);
  const emitted = [];
  for (const row of listed) {
    if (!row?.id || seen.has(row.id)) continue;
    const meta = await fetchMetadata(credentialId, workspaceId, row.id);
    const internalDate = meta.json.internalDate || 0;
    if (internalDate < Number(cursor.lastInternalDate || 0)) continue;
    emitted.push(meta);
    seen.add(row.id);
  }

  const seenIds = [...seen].slice(0, SEEN_CAP);
  const lastInternalDate = Math.max(
    Number(cursor.lastInternalDate || 0),
    ...emitted.map((it) => Number(it.json.internalDate) || 0)
  );
  await setTriggerCursor(workflowId, nodeId, {
    seeded: true,
    lastInternalDate,
    seenIds,
  });
  return { items: emitted, seeded: false, emitted: emitted.length };
};

const executeGmailTriggerManual = async (node, context) => {
  return {
    output: {
      triggered: true,
      kind: "gmailTrigger",
      polling: true,
      input: context.input ?? {},
    },
    items: [
      {
        json: {
          id: null,
          threadId: null,
          labelIds: [],
          snippet: "Gmail Trigger test (polling — not push/real-time)",
        },
      },
    ],
  };
};

module.exports = {
  MIN_POLL_MS,
  MAX_POLL_MS,
  DEFAULT_POLL_MS,
  clampPollMs,
  buildQuery,
  pollGmailTriggerOnce,
  executeGmailTriggerManual,
};
