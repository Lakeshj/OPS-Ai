/**
 * Part 14D.5 — Native Google execution nodes (GSC, GA4, Gmail, Sheets).
 * Uses googleOAuth.service — never stores tokens on the node.
 */

const {
  googleApiRequest,
  sanitizeGoogleError,
} = require("./googleOAuth.service");
const { resolveDateRange } = require("./workflowGoogleDateRange");
const { parseSpreadsheetRef } = require("./resourceLocator");

const GSC_ROW_MAX = 5000;
const GSC_RETURN_ALL_MAX = 10000;
const GA4_ROW_MAX = 10000;
const GMAIL_LIST_MAX = 100;
const GMAIL_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const SHEETS_ROW_MAX = 10000;

const interpolateFn = (template, ctx) => {
  const { interpolate } = require("./workflowNodes.service");
  return interpolate(template, ctx);
};

const itemPayload = (item) => {
  if (item && typeof item === "object" && !Array.isArray(item) && "json" in item) {
    return item.json;
  }
  return item;
};

const inputItemsOf = (context) => {
  if (Array.isArray(context.inputItems) && context.inputItems.length) {
    return context.inputItems;
  }
  if (context.input != null) return [{ json: context.input }];
  return [{ json: {} }];
};

const expr = (value, context, item) => {
  if (value == null) return "";
  if (typeof value !== "string") return value;
  if (!value.includes("{{")) return value;
  return interpolateFn(value, {
    input: itemPayload(item) ?? context.input,
    steps: context.steps,
    item,
    items: context.items,
  });
};

const requireCredential = (data, connectProduct) => {
  const id = String(data.credentialId || "").trim();
  if (!id) {
    const err = new Error(
      connectProduct
        ? `Connect ${connectProduct} to continue.`
        : "Select a Google credential"
    );
    err.code = "GOOGLE_CREDENTIAL_REQUIRED";
    throw err;
  }
  return id;
};

const encodeSiteUrl = (siteUrl) => encodeURIComponent(String(siteUrl || "").trim());

const gscQuery = async (node, context, item) => {
  const data = node.data || {};
  const credentialId = requireCredential(data, "Google Search Console");
  const siteUrl = String(expr(data.siteUrl, context, item) || "").trim();
  if (!siteUrl) {
    throw new Error("Search Console site URL is required");
  }
  const dimension = String(
    data.dimension || (data.operation === "getPages" ? "page" : "query")
  );
  const dim = dimension === "page" ? "page" : "query";
  const range = resolveDateRange(data.dateRange || "last7days", {
    startDate: expr(data.startDate, context, item),
    endDate: expr(data.endDate, context, item),
  });
  const rowLimit = Math.min(
    Math.max(Number(data.rowLimit) || 1000, 1),
    data.returnAll ? GSC_RETURN_ALL_MAX : GSC_ROW_MAX
  );
  const searchType = data.searchType ? String(data.searchType) : undefined;
  const dataState = data.dataState ? String(data.dataState) : undefined;
  const aggregationType = data.aggregationType ? String(data.aggregationType) : undefined;

  const rows = [];
  let startRow = Math.max(Number(data.startRow) || 0, 0);
  const pageSize = Math.min(rowLimit, 25000);

  while (rows.length < rowLimit) {
    const remaining = rowLimit - rows.length;
    const body = {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: [dim],
      rowLimit: Math.min(remaining, pageSize),
      startRow,
    };
    if (searchType) body.searchType = searchType;
    if (dataState) body.dataState = dataState;
    if (aggregationType) body.aggregationType = aggregationType;

    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gsc",
      url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/searchAnalytics/query`,
      method: "POST",
      body,
      timeoutMs: Number(data.timeoutMs) || 25000,
    });
    const batch = Array.isArray(res.body?.rows) ? res.body.rows : [];
    for (const row of batch) {
      const keys = Array.isArray(row.keys) ? row.keys : [];
      const json = {
        key: keys[0] || "",
        clicks: Number(row.clicks) || 0,
        impressions: Number(row.impressions) || 0,
        ctr: Number(row.ctr) || 0,
        position: Number(row.position) || 0,
      };
      if (dim === "query") json.query = keys[0] || "";
      if (dim === "page") json.page = keys[0] || "";
      rows.push({ json });
    }
    if (batch.length === 0 || !data.returnAll) break;
    startRow += batch.length;
    if (batch.length < body.rowLimit) break;
  }

  return {
    items: rows,
    output: {
      siteUrl,
      dimension: dim,
      startDate: range.startDate,
      endDate: range.endDate,
      rowCount: rows.length,
    },
    resolved: {
      credentialId,
      siteUrl,
      dimension: dim,
      rowLimit,
      startDate: range.startDate,
      endDate: range.endDate,
    },
  };
};

const GA4_METRICS = new Set([
  "sessions",
  "totalUsers",
  "newUsers",
  "activeUsers",
  "screenPageViews",
  "eventCount",
  "userEngagementDuration",
  "engagementRate",
]);

const GA4_DIMENSIONS = new Set([
  "date",
  "country",
  "city",
  "deviceCategory",
  "browser",
  "sessionSource",
  "sessionMedium",
  "sessionSourceMedium",
  "pageLocation",
  "pagePath",
  "landingPage",
  "sessionCampaignName",
  "language",
]);

const parseList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const ga4FilterExpression = (filter) => {
  if (!filter || typeof filter !== "object") return null;
  const field = String(filter.field || "").trim();
  const op = String(filter.operator || "equals");
  if (!field) return null;
  if (filter.kind === "metric") {
    const value = Number(filter.value);
    const to = Number(filter.valueTo);
    const numeric = { filter: { fieldName: field } };
    if (op === "between") {
      numeric.filter.numericFilter = {
        operation: "BETWEEN",
        value: { doubleValue: value },
        value2: { doubleValue: to },
      };
    } else {
      const map = {
        equals: "EQUAL",
        gt: "GREATER_THAN",
        lt: "LESS_THAN",
      };
      numeric.filter.numericFilter = {
        operation: map[op] || "EQUAL",
        value: { doubleValue: value },
      };
    }
    return numeric;
  }
  const stringFilter = {
    filter: {
      fieldName: field,
      stringFilter: {
        matchType:
          op === "contains"
            ? "CONTAINS"
            : op === "beginsWith"
              ? "BEGINS_WITH"
              : op === "inList"
                ? "EXACT"
                : "EXACT",
        value: String(filter.value ?? ""),
        caseSensitive: false,
      },
    },
  };
  if (op === "inList") {
    return {
      filter: {
        fieldName: field,
        inListFilter: {
          values: parseList(filter.value),
          caseSensitive: false,
        },
      },
    };
  }
  return stringFilter;
};

const ga4Report = async (node, context, item) => {
  const data = node.data || {};
  const credentialId = requireCredential(data, "Google Analytics");
  let propertyId = String(expr(data.propertyId, context, item) || "").trim();
  if (!propertyId) throw new Error("Google Analytics property ID is required");
  if (!propertyId.startsWith("properties/")) {
    if (!/^\d+$/.test(propertyId)) {
      throw new Error("Property ID must be numeric or properties/{id}");
    }
    propertyId = `properties/${propertyId}`;
  }
  const range = resolveDateRange(data.dateRange || "last7days", {
    startDate: expr(data.startDate, context, item),
    endDate: expr(data.endDate, context, item),
  });
  const metrics = parseList(data.metrics).length
    ? parseList(data.metrics)
    : ["sessions", "totalUsers"];
  for (const m of metrics) {
    if (!GA4_METRICS.has(m) && !/^[a-zA-Z][a-zA-Z0-9]+$/.test(m)) {
      throw new Error(`Unsupported GA4 metric: ${m}`);
    }
  }
  const dimensions = parseList(data.dimensions);
  for (const d of dimensions) {
    if (!GA4_DIMENSIONS.has(d) && !/^[a-zA-Z][a-zA-Z0-9]+$/.test(d)) {
      throw new Error(`Unsupported GA4 dimension: ${d}`);
    }
  }
  const limit = data.returnAll
    ? GA4_ROW_MAX
    : Math.min(Math.max(Number(data.limit) || 100, 1), GA4_ROW_MAX);

  const body = {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    metrics: metrics.map((name) => ({ name })),
    limit,
  };
  if (dimensions.length) body.dimensions = dimensions.map((name) => ({ name }));

  const dimFilter = ga4FilterExpression(data.dimensionFilter);
  if (dimFilter) body.dimensionFilter = dimFilter;
  const metFilter = ga4FilterExpression({ ...(data.metricFilter || {}), kind: "metric" });
  if (data.metricFilter?.field) body.metricFilter = metFilter;

  if (data.orderByField) {
    const field = String(data.orderByField);
    const desc = data.orderDirection !== "ascending";
    if (metrics.includes(field)) {
      body.orderBys = [{ metric: { metricName: field }, desc }];
    } else {
      body.orderBys = [{ dimension: { dimensionName: field }, desc }];
    }
  }

  const res = await googleApiRequest({
    credentialId,
    workspaceId: context.workspaceId,
    requiredType: "google_ga4",
    url: `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
    method: "POST",
    body,
    timeoutMs: Number(data.timeoutMs) || 25000,
  });

  const headerDims = (res.body?.dimensionHeaders || []).map((h) => h.name);
  const headerMets = (res.body?.metricHeaders || []).map((h) => h.name);
  const items = (res.body?.rows || []).map((row) => {
    const json = {};
    (row.dimensionValues || []).forEach((v, i) => {
      json[headerDims[i] || `dimension${i}`] = v.value;
    });
    (row.metricValues || []).forEach((v, i) => {
      const name = headerMets[i] || `metric${i}`;
      const num = Number(v.value);
      json[name] = Number.isFinite(num) ? num : v.value;
    });
    return { json };
  });

  return {
    items,
    output: {
      propertyId,
      startDate: range.startDate,
      endDate: range.endDate,
      rowCount: items.length,
    },
    resolved: {
      credentialId,
      propertyId,
      metrics,
      dimensions,
      startDate: range.startDate,
      endDate: range.endDate,
      limit,
    },
  };
};

const getBinaryPart = (item, property) => {
  const key = String(property || "data").replace(/^binary\./, "");
  const bin = item && typeof item === "object" ? item.binary : null;
  if (!bin || typeof bin !== "object") return null;
  return bin[key] || bin.data || null;
};

const assertNoFilesystemPath = (value) => {
  if (typeof value === "string" && (/^[A-Za-z]:\\/.test(value) || value.startsWith("/") || value.includes(".."))) {
    throw new Error("Gmail attachments must use WorkflowItem binary, not filesystem paths");
  }
};

const buildRfc822 = ({
  to,
  cc,
  bcc,
  replyTo,
  fromName,
  subject,
  text,
  html,
  attachments,
}) => {
  const crypto = require("crypto");
  const boundary = `opsai_${crypto.randomBytes(10).toString("hex")}`;
  const headers = [];
  headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  if (fromName) headers.push(`From: ${fromName}`);
  headers.push(`Subject: ${subject || ""}`);
  headers.push("MIME-Version: 1.0");

  const parts = [];
  if (html) {
    parts.push(
      `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n`
    );
  }
  if (text || !html) {
    parts.push(
      `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text || ""}\r\n`
    );
  }
  for (const att of attachments || []) {
    const fileName = att.fileName || "attachment";
    const mime = att.mimeType || "application/octet-stream";
    const data = att.data || "";
    parts.push(
      `--${boundary}\r\nContent-Type: ${mime}; name="${fileName}"\r\nContent-Disposition: attachment; filename="${fileName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data}\r\n`
    );
  }
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("")}--${boundary}--`;
};

const toBase64Url = (str) =>
  Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const collectAttachments = (item, data) => {
  const prop = data.binaryProperty || data.attachmentProperty || "data";
  assertNoFilesystemPath(prop);
  assertNoFilesystemPath(data.attachmentPath || "");
  if (!data.attachBinary && !data.binaryProperty && !item?.binary) return [];
  if (!item?.binary && (data.attachBinary || data.binaryProperty)) {
    throw new Error("Gmail attachment is missing — no WorkflowItem binary found");
  }
  const part = getBinaryPart(item, prop);
  if (!part) {
    if (data.attachBinary || data.binaryProperty) {
      throw new Error("Gmail attachment is missing — binary property not found");
    }
    return [];
  }
  const dataB64 = part.data || part.content || "";
  if (!dataB64) {
    throw new Error("Gmail attachment is missing binary content");
  }
  const bytes = Buffer.from(String(dataB64), "base64");
  if (bytes.length > GMAIL_ATTACH_MAX_BYTES) {
    throw new Error("Gmail attachment exceeds the 10 MB limit");
  }
  return [
    {
      fileName: part.fileName || "attachment",
      mimeType: part.mimeType || "application/octet-stream",
      data: String(dataB64),
    },
  ];
};

const gmailMessageSummary = (msg) => ({
  id: msg.id || null,
  threadId: msg.threadId || null,
  labelIds: Array.isArray(msg.labelIds) ? msg.labelIds : [],
});

const headerMap = (payload) => {
  const out = {};
  for (const h of payload?.headers || []) {
    if (h.name) out[String(h.name).toLowerCase()] = h.value;
  }
  return out;
};

const decodeBody = (payload) => {
  const walk = (p) => {
    if (!p) return { text: "", html: "" };
    if (p.body?.data) {
      const text = Buffer.from(String(p.body.data).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      const mime = String(p.mimeType || "");
      if (mime.includes("html")) return { text: "", html: text };
      return { text, html: "" };
    }
    let text = "";
    let html = "";
    for (const part of p.parts || []) {
      const inner = walk(part);
      text += inner.text;
      html += inner.html;
    }
    return { text, html };
  };
  return walk(payload);
};

const gmailSendLike = async (node, context, item, { replyToMessageId, threadId } = {}) => {
  const data = node.data || {};
  const credentialId = requireCredential(data);
  const to = String(expr(data.to, context, item) || "").trim();
  if (!to) throw new Error("Gmail Send requires a recipient (To)");
  const subject = String(expr(data.subject, context, item) || "");
  const emailType = String(data.emailType || "text");
  const message = String(expr(data.message || data.text || data.html, context, item) || "");
  const attachments = collectAttachments(item, data);
  const raw = toBase64Url(
    buildRfc822({
      to,
      cc: expr(data.cc, context, item) || undefined,
      bcc: expr(data.bcc, context, item) || undefined,
      replyTo: expr(data.replyTo, context, item) || undefined,
      fromName: expr(data.senderName, context, item) || undefined,
      subject,
      text: emailType === "html" ? "" : message,
      html: emailType === "html" ? message : "",
      attachments,
    })
  );
  const body = { raw };
  if (threadId) body.threadId = threadId;
  const res = await googleApiRequest({
    credentialId,
    workspaceId: context.workspaceId,
    requiredType: "google_gmail",
    url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    method: "POST",
    body,
    timeoutMs: Number(data.timeoutMs) || 25000,
  });
  void replyToMessageId;
  return {
    items: [{ json: gmailMessageSummary(res.body || {}) }],
    output: gmailMessageSummary(res.body || {}),
    resolved: { credentialId, to, emailType, attached: attachments.length > 0 },
  };
};

const gmailGet = async (node, context, item) => {
  const data = node.data || {};
  const credentialId = requireCredential(data);
  const id = String(expr(data.messageId || data.id, context, item) || "").trim();
  if (!id) throw new Error("Message id is required");
  const format = data.includeBody ? "full" : "metadata";
  const res = await googleApiRequest({
    credentialId,
    workspaceId: context.workspaceId,
    requiredType: "google_gmail",
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=${format}`,
    method: "GET",
    timeoutMs: Number(data.timeoutMs) || 25000,
  });
  const msg = res.body || {};
  const headers = headerMap(msg.payload);
  const bodies = data.includeBody ? decodeBody(msg.payload) : { text: "", html: "" };
  const json = {
    ...gmailMessageSummary(msg),
    from: headers.from || "",
    to: headers.to || "",
    cc: headers.cc || "",
    subject: headers.subject || "",
    date: headers.date || "",
    snippet: msg.snippet || "",
    ...(data.includeBody ? { body: bodies.html || bodies.text } : {}),
    attachmentMetadata: (msg.payload?.parts || [])
      .filter((p) => p.filename)
      .map((p) => ({ fileName: p.filename, mimeType: p.mimeType, size: p.body?.size || 0 })),
  };
  return {
    items: [{ json }],
    output: json,
    resolved: { credentialId, messageId: id },
  };
};

const gmailList = async (node, context, item, resource = "messages") => {
  const data = node.data || {};
  const credentialId = requireCredential(data);
  const limit = data.returnAll
    ? GMAIL_LIST_MAX
    : Math.min(Math.max(Number(data.limit) || 10, 1), GMAIL_LIST_MAX);
  const q = String(expr(data.q || data.query, context, item) || "").trim();
  const items = [];
  let pageToken = "";
  const path =
    resource === "threads"
      ? "threads"
      : resource === "drafts"
        ? "drafts"
        : resource === "labels"
          ? "labels"
          : "messages";
  if (path === "labels") {
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      method: "GET",
    });
    const labels = (res.body?.labels || []).slice(0, limit).map((l) => ({
      json: { id: l.id, name: l.name, type: l.type },
    }));
    return { items: labels, output: { count: labels.length }, resolved: { credentialId } };
  }
  while (items.length < limit) {
    const params = new URLSearchParams({ maxResults: String(Math.min(limit - items.length, 50)) });
    if (q && path !== "drafts") params.set("q", q);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/${path}?${params}`,
      method: "GET",
    });
    const batch =
      path === "threads"
        ? res.body?.threads || []
        : path === "drafts"
          ? res.body?.drafts || []
          : res.body?.messages || [];
    for (const row of batch) {
      items.push({
        json:
          path === "drafts"
            ? { id: row.id, message: gmailMessageSummary(row.message || {}) }
            : gmailMessageSummary(row),
      });
      if (items.length >= limit) break;
    }
    pageToken = res.body?.nextPageToken || "";
    if (!pageToken || !data.returnAll) break;
  }
  return {
    items,
    output: { count: items.length },
    resolved: { credentialId, limit, q },
  };
};

const gmailModify = async (node, context, item, add, remove) => {
  const data = node.data || {};
  const credentialId = requireCredential(data);
  const id = String(expr(data.messageId || data.id, context, item) || "").trim();
  if (!id) throw new Error("Message id is required");
  const res = await googleApiRequest({
    credentialId,
    workspaceId: context.workspaceId,
    requiredType: "google_gmail",
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`,
    method: "POST",
    body: { addLabelIds: add, removeLabelIds: remove },
  });
  return {
    items: [{ json: gmailMessageSummary(res.body || { id }) }],
    output: gmailMessageSummary(res.body || { id }),
    resolved: { credentialId, messageId: id },
  };
};

const gmailDelete = async (node, context, item) => {
  const data = node.data || {};
  const credentialId = requireCredential(data);
  const id = String(expr(data.messageId || data.id, context, item) || "").trim();
  if (!id) throw new Error("Message id is required");
  await googleApiRequest({
    credentialId,
    workspaceId: context.workspaceId,
    requiredType: "google_gmail",
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
  return {
    items: [{ json: { id, deleted: true } }],
    output: { id, deleted: true },
    resolved: { credentialId, messageId: id },
  };
};

const parseLabelList = (value, context, item) =>
  parseList(expr(value, context, item)).filter(Boolean);

const runGmail = async (node, context, item) => {
  const data = node.data || {};
  const resource = String(data.resource || "message");
  const operation = String(data.operation || "send");
  if (resource === "message" && operation === "send") return gmailSendLike(node, context, item);
  if (resource === "message" && operation === "reply") {
    const id = String(expr(data.messageId, context, item) || "").trim();
    if (!id) throw new Error("Reply requires messageId");
    const got = await gmailGet(
      { ...node, data: { ...data, includeBody: false } },
      context,
      item
    );
    return gmailSendLike(node, context, item, {
      replyToMessageId: id,
      threadId: got.output.threadId,
    });
  }
  if (resource === "message" && operation === "get") return gmailGet(node, context, item);
  if (resource === "message" && operation === "getAll") return gmailList(node, context, item, "messages");
  if (resource === "message" && operation === "delete") return gmailDelete(node, context, item);
  if (resource === "message" && operation === "markRead") {
    return gmailModify(node, context, item, [], ["UNREAD"]);
  }
  if (resource === "message" && operation === "markUnread") {
    return gmailModify(node, context, item, ["UNREAD"], []);
  }
  if (resource === "message" && operation === "addLabels") {
    return gmailModify(node, context, item, parseLabelList(data.labelIds, context, item), []);
  }
  if (resource === "message" && operation === "removeLabels") {
    return gmailModify(node, context, item, [], parseLabelList(data.labelIds, context, item));
  }
  if (resource === "draft" && operation === "create") {
    const credentialId = requireCredential(data);
    const to = String(expr(data.to, context, item) || "").trim();
    const raw = toBase64Url(
      buildRfc822({
        to,
        subject: expr(data.subject, context, item) || "",
        text: expr(data.message, context, item) || "",
      })
    );
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      method: "POST",
      body: { message: { raw } },
    });
    return {
      items: [{ json: { id: res.body?.id, message: gmailMessageSummary(res.body?.message || {}) } }],
      output: { id: res.body?.id },
      resolved: { credentialId },
    };
  }
  if (resource === "draft" && operation === "get") {
    const credentialId = requireCredential(data);
    const id = String(expr(data.draftId || data.id, context, item) || "").trim();
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`,
      method: "GET",
    });
    return {
      items: [{ json: { id: res.body?.id, message: gmailMessageSummary(res.body?.message || {}) } }],
      output: { id: res.body?.id },
      resolved: { credentialId },
    };
  }
  if (resource === "draft" && operation === "getAll") return gmailList(node, context, item, "drafts");
  if (resource === "draft" && operation === "delete") {
    const credentialId = requireCredential(data);
    const id = String(expr(data.draftId || data.id, context, item) || "").trim();
    await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
    return { items: [{ json: { id, deleted: true } }], output: { id, deleted: true }, resolved: { credentialId } };
  }
  if (resource === "label" && operation === "create") {
    const credentialId = requireCredential(data);
    const name = String(expr(data.labelName || data.name, context, item) || "").trim();
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      method: "POST",
      body: { name },
    });
    return {
      items: [{ json: { id: res.body?.id, name: res.body?.name } }],
      output: { id: res.body?.id, name: res.body?.name },
      resolved: { credentialId },
    };
  }
  if (resource === "label" && operation === "get") {
    const credentialId = requireCredential(data);
    const id = String(expr(data.labelId || data.id, context, item) || "").trim();
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`,
      method: "GET",
    });
    return {
      items: [{ json: { id: res.body?.id, name: res.body?.name, type: res.body?.type } }],
      output: res.body,
      resolved: { credentialId },
    };
  }
  if (resource === "label" && operation === "getAll") return gmailList(node, context, item, "labels");
  if (resource === "label" && operation === "delete") {
    const credentialId = requireCredential(data);
    const id = String(expr(data.labelId || data.id, context, item) || "").trim();
    await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
    return { items: [{ json: { id, deleted: true } }], output: { id, deleted: true }, resolved: { credentialId } };
  }
  if (resource === "thread" && operation === "get") {
    const credentialId = requireCredential(data);
    const id = String(expr(data.threadId || data.id, context, item) || "").trim();
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=metadata`,
      method: "GET",
    });
    return {
      items: [{ json: { id: res.body?.id, historyId: res.body?.historyId, messages: (res.body?.messages || []).map(gmailMessageSummary) } }],
      output: { id: res.body?.id },
      resolved: { credentialId },
    };
  }
  if (resource === "thread" && operation === "getAll") return gmailList(node, context, item, "threads");
  if (resource === "thread" && operation === "reply") {
    return gmailSendLike(node, context, item, {
      threadId: String(expr(data.threadId, context, item) || ""),
    });
  }
  if (resource === "thread" && (operation === "trash" || operation === "untrash")) {
    const credentialId = requireCredential(data);
    const id = String(expr(data.threadId || data.id, context, item) || "").trim();
    const verb = operation === "trash" ? "trash" : "untrash";
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}/${verb}`,
      method: "POST",
      body: {},
    });
    return {
      items: [{ json: { id: res.body?.id || id, [verb]: true } }],
      output: { id: res.body?.id || id },
      resolved: { credentialId },
    };
  }
  if (resource === "thread" && (operation === "addLabels" || operation === "removeLabels")) {
    const credentialId = requireCredential(data);
    const id = String(expr(data.threadId || data.id, context, item) || "").trim();
    const labels = parseLabelList(data.labelIds, context, item);
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_gmail",
      url: `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}/modify`,
      method: "POST",
      body:
        operation === "addLabels"
          ? { addLabelIds: labels }
          : { removeLabelIds: labels },
    });
    return {
      items: [{ json: { id: res.body?.id || id, labelIds: res.body?.labelIds || [] } }],
      output: { id: res.body?.id || id },
      resolved: { credentialId },
    };
  }
  throw new Error(`Unsupported Gmail ${resource}/${operation}`);
};

const sheetsValuesUrl = (spreadsheetId, range) =>
  `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;

const rowsFromMatrix = (values, hasHeaderRow) => {
  const matrix = Array.isArray(values) ? values : [];
  if (!hasHeaderRow) {
    return matrix.map((row) => {
      const json = {};
      (row || []).forEach((cell, i) => {
        json[`col${i + 1}`] = cell;
      });
      return { json };
    });
  }
  const headers = (matrix[0] || []).map((h, i) => String(h || `col${i + 1}`));
  return matrix.slice(1).map((row) => {
    const json = {};
    headers.forEach((h, i) => {
      json[h] = row?.[i] ?? "";
    });
    return { json };
  });
};

const itemsToMatrix = (items, hasHeaderRow, columnOrder) => {
  const rows = items.map((it) => itemPayload(it) || {});
  const keys = columnOrder?.length
    ? columnOrder
    : [...new Set(rows.flatMap((r) => Object.keys(r || {})))];
  const matrix = [];
  if (hasHeaderRow) matrix.push(keys);
  for (const row of rows) {
    matrix.push(keys.map((k) => (row[k] == null ? "" : row[k])));
  }
  return matrix;
};

const runSheets = async (node, context, item, allItems) => {
  const data = node.data || {};
  const credentialId = requireCredential(data);
  const operation = String(data.operation || "readRows");
  const spreadsheetId = parseSpreadsheetRef(
    String(expr(data.spreadsheetId, context, item) || "").trim()
  ).spreadsheetId;
  const sheet = String(expr(data.sheetName || data.sheet, context, item) || "").trim();
  const rangePart = String(expr(data.range, context, item) || "A:Z").trim();
  const range = sheet ? `${sheet}!${rangePart}` : rangePart;
  const hasHeaderRow = data.hasHeaderRow !== false;
  const valueRenderMode = data.valueRenderMode || "FORMATTED_VALUE";
  const valueInputMode = data.valueInputMode || "USER_ENTERED";

  if (operation === "createSpreadsheet") {
    const title = String(expr(data.title || data.spreadsheetTitle, context, item) || "Untitled");
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: "https://sheets.googleapis.com/v4/spreadsheets",
      method: "POST",
      body: { properties: { title } },
    });
    return {
      items: [{ json: { spreadsheetId: res.body?.spreadsheetId, title } }],
      output: { spreadsheetId: res.body?.spreadsheetId, title },
      resolved: { credentialId },
    };
  }
  if (operation === "addSheet") {
    if (!spreadsheetId) throw new Error("spreadsheetId is required");
    const title = String(expr(data.sheetName || data.title, context, item) || "Sheet");
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      method: "POST",
      body: { requests: [{ addSheet: { properties: { title } } }] },
    });
    return {
      items: [{ json: { spreadsheetId, sheet: title } }],
      output: { spreadsheetId, sheet: title },
      resolved: { credentialId, replies: res.body?.replies ? true : true },
    };
  }
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  if (operation === "getSpreadsheet") {
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
      method: "GET",
    });
    const sheets = (res.body?.sheets || []).map((s) => s.properties?.title).filter(Boolean);
    return {
      items: [{ json: { spreadsheetId, title: res.body?.properties?.title, sheets } }],
      output: { spreadsheetId, sheets },
      resolved: { credentialId },
    };
  }

  if (operation === "readRows") {
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: `${sheetsValuesUrl(spreadsheetId, range)}?valueRenderOption=${encodeURIComponent(valueRenderMode)}`,
      method: "GET",
    });
    const values = (res.body?.values || []).slice(0, SHEETS_ROW_MAX);
    const items = rowsFromMatrix(values, hasHeaderRow);
    return {
      items,
      output: { spreadsheetId, range, rowCount: items.length },
      resolved: { credentialId, spreadsheetId, range, valueRenderMode },
    };
  }

  const values = itemsToMatrix(allItems, false, parseList(data.columnOrder));

  if (operation === "appendRows") {
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: `${sheetsValuesUrl(spreadsheetId, range)}:append?valueInputOption=${encodeURIComponent(valueInputMode)}`,
      method: "POST",
      body: { values },
    });
    return {
      items: allItems.map((it) => ({ json: itemPayload(it) || {} })),
      output: { spreadsheetId, range, updatedRange: res.body?.updates?.updatedRange || null },
      resolved: { credentialId, valueInputMode },
    };
  }
  if (operation === "updateRows") {
    const res = await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: `${sheetsValuesUrl(spreadsheetId, range)}?valueInputOption=${encodeURIComponent(valueInputMode)}`,
      method: "PUT",
      body: { values: itemsToMatrix(allItems, false, parseList(data.columnOrder)) },
    });
    return {
      items: allItems.map((it) => ({ json: itemPayload(it) || {} })),
      output: { spreadsheetId, range, updatedCells: res.body?.updatedCells || null },
      resolved: { credentialId, valueInputMode },
    };
  }
  if (operation === "clearRange") {
    await googleApiRequest({
      credentialId,
      workspaceId: context.workspaceId,
      requiredType: "google_sheets",
      url: `${sheetsValuesUrl(spreadsheetId, range)}:clear`,
      method: "POST",
      body: {},
    });
    return {
      items: [{ json: { spreadsheetId, range, cleared: true } }],
      output: { spreadsheetId, range, cleared: true },
      resolved: { credentialId },
    };
  }
  throw new Error(`Unsupported Google Sheets operation: ${operation}`);
};

const wrapFanOut = (result, inputItem) => {
  const items = (result.items || []).map((it, i) => ({
    json: it.json ?? it,
    ...(it.binary ? { binary: it.binary } : {}),
    pairedItem: { item: 0, inputItemIndex: i },
  }));
  void inputItem;
  return { ...result, items };
};

const executeGoogleNode = async (node, context) => {
  const type = node.type || node.data?.nodeType;
  const itemsIn = inputItemsOf(context);
  try {
    if (type === "googleSearchConsole") {
      const first = itemsIn[0];
      return wrapFanOut(await gscQuery(node, context, first), first);
    }
    if (type === "googleAnalytics") {
      const first = itemsIn[0];
      return wrapFanOut(await ga4Report(node, context, first), first);
    }
    if (type === "gmail") {
      const out = [];
      let last = null;
      for (const item of itemsIn) {
        last = await runGmail(node, context, item);
        out.push(...(last.items || []));
      }
      return { ...last, items: out };
    }
    if (type === "googleSheets") {
      const op = String(node.data?.operation || "readRows");
      if (op === "readRows" || op === "getSpreadsheet" || op === "createSpreadsheet" || op === "addSheet" || op === "clearRange") {
        return wrapFanOut(await runSheets(node, context, itemsIn[0], itemsIn), itemsIn[0]);
      }
      return runSheets(node, context, itemsIn[0], itemsIn);
    }
    throw new Error(`Unknown Google node: ${type}`);
  } catch (err) {
    if (err && err.code && String(err.code).startsWith("GOOGLE_")) throw err;
    if (err && err.providerStatus) throw err;
    throw err;
  }
};

module.exports = {
  executeGoogleNode,
  gscQuery,
  ga4Report,
  runGmail,
  runSheets,
  getBinaryPart,
  GSC_ROW_MAX,
  GA4_ROW_MAX,
  GMAIL_LIST_MAX,
  GMAIL_ATTACH_MAX_BYTES,
  SHEETS_ROW_MAX,
  GA4_METRICS,
  GA4_DIMENSIONS,
  sanitizeGoogleError,
};
