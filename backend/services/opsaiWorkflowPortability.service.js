/**
 * Part 14D.4 — OpsAi native workflow portability + unified import detection.
 * Does not replace n8nWorkflowImport.service.js — routes through it for n8n.
 */

const crypto = require("crypto");
const config = require("../config");

const OPSAI_FORMAT = "opsai-workflow";
const OPSAI_FORMAT_VERSION = 1;

const IMPORT_BOUNDS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxNodes: 400,
  maxEdges: 800,
  maxStringLength: 100_000,
  maxDepth: 40,
});

const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const SECRETISH_KEY =
  /^(password|passwd|secret|apiKey|api_key|accessToken|refreshToken|oauthToken|clientSecret|privateKey|resumeToken|webhookSecret)$/i;

const stripForbiddenKeys = (value, depth = 0) => {
  if (depth > IMPORT_BOUNDS.maxDepth) {
    throw Object.assign(new Error("Import JSON exceeds max depth"), {
      code: "IMPORT_DEPTH_EXCEEDED",
      statusCode: 400,
    });
  }
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > IMPORT_BOUNDS.maxStringLength) {
      throw Object.assign(new Error("Import string exceeds max length"), {
        code: "IMPORT_STRING_BOUND",
        statusCode: 400,
      });
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripForbiddenKeys(v, depth + 1));
  }
  const out = Object.create(null);
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (SECRETISH_KEY.test(k)) continue;
    out[k] = stripForbiddenKeys(v, depth + 1);
  }
  return out;
};

const assertImportBounds = (payload, rawLength = 0) => {
  if (rawLength > IMPORT_BOUNDS.maxBytes) {
    throw Object.assign(new Error("Import payload too large"), {
      code: "IMPORT_SIZE_BOUND",
      statusCode: 413,
    });
  }
  const def =
    payload?.workflow?.definition ||
    payload?.definition ||
    (Array.isArray(payload?.nodes) ? payload : null);
  const nodes = def?.nodes || payload?.nodes;
  const edges = def?.edges || payload?.edges;
  if (Array.isArray(nodes) && nodes.length > IMPORT_BOUNDS.maxNodes) {
    throw Object.assign(new Error("Import exceeds node bound"), {
      code: "IMPORT_NODE_BOUND",
      statusCode: 400,
    });
  }
  if (Array.isArray(edges) && edges.length > IMPORT_BOUNDS.maxEdges) {
    throw Object.assign(new Error("Import exceeds edge bound"), {
      code: "IMPORT_EDGE_BOUND",
      statusCode: 400,
    });
  }
  // n8n uses connections object
  if (payload?.connections && typeof payload.connections === "object") {
    let edgeCount = 0;
    for (const outs of Object.values(payload.connections)) {
      for (const ports of Object.values(outs || {})) {
        (ports || []).forEach((t) => {
          edgeCount += (t || []).length;
        });
      }
    }
    if (edgeCount > IMPORT_BOUNDS.maxEdges) {
      throw Object.assign(new Error("Import exceeds edge bound"), {
        code: "IMPORT_EDGE_BOUND",
        statusCode: 400,
      });
    }
  }
};

/**
 * Unified format detection.
 * Native requires explicit marker. n8n requires typed n8n node packages.
 * Do NOT treat arbitrary {nodes,connections} as n8n.
 */
const detectWorkflowImportFormat = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { format: "UNKNOWN", confidence: 0, reason: "not_object" };
  }

  if (
    payload.format === OPSAI_FORMAT ||
    payload.format === "opsai" ||
    payload.type === OPSAI_FORMAT
  ) {
    const version = Number(payload.formatVersion || payload.version || 0);
    return {
      format: "OPSAI_NATIVE",
      confidence: 1,
      formatVersion: version || OPSAI_FORMAT_VERSION,
      reason: "explicit_opsai_marker",
    };
  }

  // Nested envelope
  if (payload.workflow && payload.workflow.definition && payload.format) {
    if (String(payload.format).toLowerCase().includes("opsai")) {
      return {
        format: "OPSAI_NATIVE",
        confidence: 1,
        formatVersion: Number(payload.formatVersion) || OPSAI_FORMAT_VERSION,
        reason: "explicit_opsai_marker",
      };
    }
  }

  const nodes = Array.isArray(payload.nodes) ? payload.nodes : null;
  const connections = payload.connections;
  if (nodes && connections && typeof connections === "object") {
    const n8nTyped = nodes.some(
      (n) =>
        n &&
        typeof n.type === "string" &&
        (n.type.startsWith("n8n-nodes-base.") ||
          n.type.startsWith("@n8n/") ||
          /^n8n-nodes-[\w-]+\./.test(n.type))
    );
    if (n8nTyped) {
      return { format: "N8N", confidence: 1, reason: "n8n_node_types" };
    }
    // Insufficient — do not guess
    return {
      format: "UNKNOWN",
      confidence: 0,
      reason: "nodes_connections_without_n8n_types",
    };
  }

  // Bare OpsAi definition (nodes+edges) without envelope — not accepted as native
  // unless marked; reject unknown to avoid silent mis-import.
  if (Array.isArray(payload.nodes) && Array.isArray(payload.edges)) {
    return {
      format: "UNKNOWN",
      confidence: 0.2,
      reason: "bare_definition_without_opsai_marker",
    };
  }

  return { format: "UNKNOWN", confidence: 0, reason: "unrecognized" };
};

const sanitizeNodeDataForExport = (data) => {
  if (!data || typeof data !== "object") return {};
  const cleaned = stripForbiddenKeys({ ...data });
  // Credential IDs are workspace-local — do not port as live secrets.
  if ("credentialId" in cleaned) {
    cleaned.credentialRequirement = {
      configuredAtSource: Boolean(data.credentialId),
      portable: false,
      httpAuthMode: data.httpAuthMode || undefined,
      predefinedConnectionType: data.predefinedConnectionType || undefined,
      genericAuthType: data.genericAuthType || undefined,
    };
    delete cleaned.credentialId;
  }
  // Ephemeral editor / runtime
  delete cleaned.pinnedOutput;
  delete cleaned.pinnedItems;
  delete cleaned.cacheDirty;
  delete cleaned.__runtime;
  delete cleaned.resumeToken;
  delete cleaned.cursor;
  delete cleaned.pollCursor;
  delete cleaned.triggerCursor;
  return cleaned;
};

/**
 * Build versioned native export package (no secrets / history / runtime).
 */
const buildNativeExport = (workflow) => {
  const definition = workflow.definition || { version: 1, nodes: [], edges: [] };
  const nodes = (definition.nodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position ? { ...n.position } : undefined,
    data: sanitizeNodeDataForExport(n.data || {}),
  }));
  const edges = (definition.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    data: e.data && typeof e.data === "object" ? stripForbiddenKeys({ ...e.data }) : undefined,
  }));

  return {
    format: OPSAI_FORMAT,
    formatVersion: OPSAI_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workflow: {
      name: workflow.name || "Untitled workflow",
      description: workflow.description || null,
      // status intentionally omitted — import always creates draft
      settings: stripForbiddenKeys(definition.settings || {}),
      definition: {
        version: definition.version || 1,
        nodes,
        edges,
        settings: stripForbiddenKeys(definition.settings || {}),
      },
      // Safe metadata only
      errorWorkflowId: null,
    },
  };
};

const hmacSecret = () =>
  process.env.WORKFLOW_IMPORT_HMAC_SECRET ||
  config.jwt?.secret ||
  "opsai-import-dev-secret";

const createPreviewCommitToken = ({
  fingerprint,
  workspaceId,
  userId,
  format,
  ttlMs = 15 * 60 * 1000,
}) => {
  const exp = Date.now() + ttlMs;
  const payload = `${format}|${fingerprint}|${workspaceId}|${userId}|${exp}`;
  const sig = crypto
    .createHmac("sha256", hmacSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(JSON.stringify({ payload, sig })).toString("base64url");
};

const verifyPreviewCommitToken = ({
  token,
  fingerprint,
  workspaceId,
  userId,
  format,
}) => {
  if (!token || typeof token !== "string") {
    return { ok: false, code: "PREVIEW_TOKEN_REQUIRED" };
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "PREVIEW_TOKEN_INVALID" };
  }
  const { payload, sig } = parsed || {};
  if (!payload || !sig) return { ok: false, code: "PREVIEW_TOKEN_INVALID" };
  const expected = crypto
    .createHmac("sha256", hmacSecret())
    .update(payload)
    .digest("hex");
  if (
    expected.length !== sig.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return { ok: false, code: "PREVIEW_TOKEN_MISMATCH" };
  }
  const parts = String(payload).split("|");
  if (parts.length !== 5) return { ok: false, code: "PREVIEW_TOKEN_INVALID" };
  const [fmt, fp, ws, uid, expStr] = parts;
  if (fmt !== format) return { ok: false, code: "PREVIEW_TOKEN_FORMAT" };
  if (fp !== fingerprint) return { ok: false, code: "PREVIEW_FINGERPRINT_MISMATCH" };
  if (ws !== String(workspaceId) || uid !== String(userId)) {
    return { ok: false, code: "PREVIEW_TOKEN_SCOPE" };
  }
  if (Date.now() > Number(expStr)) {
    return { ok: false, code: "PREVIEW_TOKEN_EXPIRED" };
  }
  return { ok: true };
};

const fingerprintDefinition = (definition) => {
  const payload = {
    nodes: (definition?.nodes || []).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position || null,
      data: n.data || {},
    })),
    edges: (definition?.edges || []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || null,
      targetHandle: e.targetHandle || null,
    })),
    settings: definition?.settings || {},
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
};

/**
 * Preview native OpsAi package → draft definition (new IDs not required for nodes).
 */
const previewNativeImport = (payload) => {
  const detection = detectWorkflowImportFormat(payload);
  if (detection.format !== "OPSAI_NATIVE") {
    return {
      ok: false,
      format: detection.format,
      error: "Not an OpsAi native workflow export",
      code: "NOT_OPSAI_NATIVE",
    };
  }
  const version = Number(payload.formatVersion || detection.formatVersion || 0);
  if (version && version > OPSAI_FORMAT_VERSION) {
    return {
      ok: false,
      format: "OPSAI_NATIVE",
      error: `Unsupported OpsAi format version ${version}`,
      code: "UNSUPPORTED_FORMAT_VERSION",
    };
  }

  const safe = stripForbiddenKeys(payload);
  const wf = safe.workflow || {};
  const defIn = wf.definition || safe.definition;
  if (!defIn || !Array.isArray(defIn.nodes) || !Array.isArray(defIn.edges)) {
    return {
      ok: false,
      format: "OPSAI_NATIVE",
      error: "Native export missing definition.nodes/edges",
      code: "INVALID_NATIVE_PACKAGE",
    };
  }

  const nodes = defIn.nodes.map((n) => ({
    id: String(n.id),
    type: n.type,
    position: n.position,
    data: sanitizeNodeDataForExport(n.data || {}),
  }));
  const edges = defIn.edges.map((e) => ({
    id: e.id || `e_${e.source}_${e.target}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    data: e.data,
  }));

  const definition = {
    version: defIn.version || 1,
    nodes,
    edges,
    settings: stripForbiddenKeys(defIn.settings || wf.settings || {}),
  };

  const fingerprint = fingerprintDefinition(definition);
  const needsSetup = nodes.filter(
    (n) => n.data?.credentialRequirement?.configuredAtSource
  );

  return {
    ok: true,
    format: "OPSAI_NATIVE",
    formatVersion: version || OPSAI_FORMAT_VERSION,
    structureImportable: true,
    runtimeReady: needsSetup.length === 0,
    definition,
    draftName: wf.name ? `${wf.name} (imported)` : "Imported OpsAi workflow",
    draftDescription: wf.description || "Imported OpsAi workflow",
    fingerprint,
    report: {
      format: "OPSAI_NATIVE",
      sourceWorkflowName: wf.name || null,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      structureImportable: true,
      runtimeReady: needsSetup.length === 0,
      summary: {
        converted: nodes.map((n) => ({
          name: n.data?.label || n.id,
          mappedType: n.type,
          status: "SUPPORTED",
        })),
        needsSetup: needsSetup.map((n) => ({
          nodeName: n.data?.label || n.id,
          reason: "CREDENTIAL_REQUIRES_RECONNECT",
        })),
        unsupported: [],
        needsReview: [],
        annotations: [],
        runtimeReadiness: needsSetup.length === 0 ? "ready" : "needs_setup",
      },
      secretExclusion: true,
      historyExcluded: true,
    },
  };
};

/**
 * Unified preview — detects format and delegates.
 */
const previewUnifiedImport = (payload, { rawLength = 0 } = {}) => {
  assertImportBounds(payload, rawLength);
  const safe = stripForbiddenKeys(payload);
  const detection = detectWorkflowImportFormat(safe);

  if (detection.format === "OPSAI_NATIVE") {
    return { detection, ...previewNativeImport(safe) };
  }
  if (detection.format === "N8N") {
    const n8n = require("./n8nWorkflowImport.service");
    const result = n8n.previewN8nImport(safe);
    return {
      detection,
      ...result,
      format: result.format === "n8n" ? "N8N" : result.format,
    };
  }
  return {
    ok: false,
    detection,
    format: "UNKNOWN",
    error: "Unrecognized workflow export format",
    code: "UNKNOWN_FORMAT",
    structureImportable: false,
    runtimeReady: false,
  };
};

const buildUnifiedDraft = (payload, { name } = {}) => {
  const preview = previewUnifiedImport(payload);
  if (!preview.ok) return preview;

  if (preview.format === "N8N" || preview.detection?.format === "N8N") {
    const n8n = require("./n8nWorkflowImport.service");
    const built = n8n.buildDraftImport(payload, { name });
    return {
      ...preview,
      ...built,
      format: "N8N",
      fingerprint: built.fingerprint || preview.fingerprint,
      draft: built.draft,
    };
  }

  return {
    ...preview,
    draft: {
      name: name || preview.draftName || "Imported workflow",
      description:
        preview.draftDescription ||
        `Imported ${preview.format || preview.detection?.format} workflow`,
      status: "draft",
      definition: preview.definition,
    },
  };
};

module.exports = {
  OPSAI_FORMAT,
  OPSAI_FORMAT_VERSION,
  IMPORT_BOUNDS,
  detectWorkflowImportFormat,
  buildNativeExport,
  previewNativeImport,
  previewUnifiedImport,
  buildUnifiedDraft,
  assertImportBounds,
  stripForbiddenKeys,
  sanitizeNodeDataForExport,
  fingerprintDefinition,
  createPreviewCommitToken,
  verifyPreviewCommitToken,
};
