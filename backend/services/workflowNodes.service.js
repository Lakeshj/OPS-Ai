const { getClientForProvider } = require("../config/aiClients");
const { withGenerationOptions } = require("../utils/openaiCompletionOptions");
const assistantsService = require("../modules/assistants/assistants.service");
const { pool } = require("../config/database");
const { readTextFile, readBinaryFile } = require("./documentStorage.service");
const { sendMail } = require("./mailer.service");
const { runSandboxedCode } = require("./workflowCode.service");
const { redactHeaders, failWith } = require("../utils/workflowDebug");
const {
  ExpressionReferenceError,
  resolveStepsExpression,
  parseStepsKey,
} = require("./workflowExpression.service");
const {
  MERGE_PORT_IDS,
  PORT_STATES,
  normalizeMergeMode,
} = require("./workflowMultiInput.service");
const { cloneJsonData, cloneItem, normalizeNodeOutput } = require("./workflowProvenance.service");
const {
  normalizeSwitchRules,
  getSwitchOutputPortIds,
  SWITCH_FALLBACK_HANDLE,
} = require("./workflowDynamicPorts.service");
const {
  getSecretForWorkspace,
} = require("../modules/workflows/credentials.service");
const ExcelJS = require("exceljs");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

/**
 * Node handlers: (node, context) => { output, nextHandle? }
 * context: { input, steps, runId, workspaceId, workflowId }
 */

const cellToValue = (cell) => {
  if (cell == null) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text != null) return String(v.text);
    if (v.result != null) return v.result;
    if (v.richText) {
      return v.richText.map((p) => p.text || "").join("");
    }
    if (v instanceof Date) return v.toISOString();
  }
  return v;
};

const parseSpreadsheetBuffer = async (buffer, ext, options = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheetName = options.sheetName ? String(options.sheetName).trim() : "";
  const hasHeader = options.hasHeader !== false;
  const rowLimit = Math.min(Number(options.rowLimit) || 2000, 10000);

  if (ext === "csv" || ext === "txt") {
    const tmp = path.join(
      os.tmpdir(),
      `wf-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`
    );
    await fs.writeFile(tmp, buffer);
    try {
      await workbook.csv.readFile(tmp);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  } else {
    // xlsx / xls
    // exceljs xlsx.read needs a stream or file; use temp file for reliability
    const tmp = path.join(
      os.tmpdir(),
      `wf-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`
    );
    await fs.writeFile(tmp, buffer);
    try {
      await workbook.xlsx.readFile(tmp);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  const sheet =
    (sheetName && workbook.getWorksheet(sheetName)) ||
    workbook.worksheets[0] ||
    null;
  if (!sheet) {
    throw new Error("Spreadsheet has no worksheets");
  }

  const matrix = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (values.length < colNumber - 1) values.push("");
      values.push(cellToValue(cell));
    });
    matrix.push(values);
  });

  if (matrix.length === 0) {
    return {
      sheet: sheet.name,
      headers: [],
      rows: [],
      rowCount: 0,
      text: "",
    };
  }

  let headers;
  let dataRows;
  if (hasHeader) {
    headers = matrix[0].map((h, i) => {
      const label = String(h ?? "").trim();
      return label || `column_${i + 1}`;
    });
    dataRows = matrix.slice(1);
  } else {
    const width = Math.max(...matrix.map((r) => r.length), 0);
    headers = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    dataRows = matrix;
  }

  const limited = dataRows.slice(0, rowLimit);
  const rows = limited.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });

  const textLines = [
    headers.join("\t"),
    ...rows.map((row) => headers.map((h) => String(row[h] ?? "")).join("\t")),
  ];
  const text = textLines.join("\n");

  return {
    sheet: sheet.name,
    headers,
    rows,
    rowCount: rows.length,
    truncated: dataRows.length > rowLimit,
    text,
    textPreview: text.slice(0, 800),
  };
};

/**
 * After conversion, originals are often deleted and only markdown remains.
 * Spreadsheet conversion stores sheets as ```tsv blocks under ## SheetName.
 */
const parseSpreadsheetFromMarkdown = (markdown, options = {}) => {
  const hasHeader = options.hasHeader !== false;
  const rowLimit = Math.min(Number(options.rowLimit) || 2000, 10000);
  const wantedSheet = options.sheetName ? String(options.sheetName).trim() : "";
  const md = String(markdown || "");

  const blockRe =
    /##\s+([^\n]+)\n\s*```tsv\n([\s\S]*?)```/gi;
  const blocks = [];
  let match;
  while ((match = blockRe.exec(md)) !== null) {
    blocks.push({
      sheet: String(match[1] || "").trim(),
      body: String(match[2] || "").trim(),
    });
  }

  let chosen = null;
  if (wantedSheet) {
    chosen = blocks.find(
      (b) => b.sheet.toLowerCase() === wantedSheet.toLowerCase()
    );
  }
  if (!chosen) chosen = blocks[0] || null;

  let matrix = [];
  if (chosen?.body) {
    matrix = chosen.body
      .split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter((r) => r.some((c) => String(c || "").trim() !== ""));
  } else {
    // Fallback: treat whole markdown as TSV-ish lines
    matrix = md
      .split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter((r) => r.length > 1 && r.some((c) => String(c || "").trim()));
  }

  if (matrix.length === 0) {
    return {
      sheet: chosen?.sheet || "markdown",
      headers: [],
      rows: [],
      rowCount: 0,
      text: md.slice(0, 4000),
      textPreview: md.slice(0, 800),
      source: "markdown",
    };
  }

  let headers;
  let dataRows;
  if (hasHeader) {
    headers = matrix[0].map((h, i) => {
      const label = String(h ?? "").trim();
      return label || `column_${i + 1}`;
    });
    dataRows = matrix.slice(1);
  } else {
    const width = Math.max(...matrix.map((r) => r.length), 0);
    headers = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    dataRows = matrix;
  }

  const limited = dataRows.slice(0, rowLimit);
  const rows = limited.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });

  const textLines = [
    headers.join("\t"),
    ...rows.map((row) => headers.map((h) => String(row[h] ?? "")).join("\t")),
  ];
  const text = textLines.join("\n");

  return {
    sheet: chosen?.sheet || "Sheet1",
    headers,
    rows,
    rowCount: rows.length,
    truncated: dataRows.length > rowLimit,
    text,
    textPreview: text.slice(0, 800),
    source: "markdown",
  };
};

const DEFAULT_WORKFLOW_SYSTEM_PROMPT =
  "You are a helpful workflow assistant. Answer the user request using the provided data. Be concise and never dump the whole dataset unless explicitly asked.";

/**
 * Shared LLM execution for `ai` (generic model) and `bot` (Keyword Assistant).
 * `bot` requires an assistantId; `ai` runs on the configured provider/model.
 */
const runLlmNode = async (node, context, { requireBot }) => {
  const data = node.data || {};
  let provider = data.provider || "openai";
  let model = data.model || undefined;
  let systemPrompt = data.systemPrompt || DEFAULT_WORKFLOW_SYSTEM_PROMPT;
  const promptTemplate = data.prompt || "{{input}}";
  let assistantMeta = null;

  if (requireBot && !data.assistantId) {
    throw new Error(
      "Bot node requires a Keyword Assistant — pick one in Settings, or use a plain AI node instead"
    );
  }

  if (data.assistantId) {
    const assistant = await assistantsService.getById(data.assistantId);
    assistantMeta = { id: assistant.id, name: assistant.name };
    provider = assistant.provider || provider;
    model = assistant.model || model;
    if (assistant.promptTemplate) {
      systemPrompt = [
        "You are running inside an OpsAi workflow.",
        "",
        "## Selected Bot Instructions",
        assistant.promptTemplate,
        data.systemPrompt ? `\n## Extra workflow instructions\n${data.systemPrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  const userPrompt = interpolate(promptTemplate, {
    input: context.input,
    steps: context.steps,
  });

  const wantsJson = String(data.outputFormat || "text") === "json";
  if (wantsJson) {
    systemPrompt = `${systemPrompt}\n\nRespond with a single valid JSON object and nothing else.`;
  }

  const resolved = {
    provider,
    model: model || "gpt-4o-mini",
    outputFormat: wantsJson ? "json" : "text",
    assistantId: assistantMeta?.id || null,
    assistantName: assistantMeta?.name || data.assistantName || null,
    systemPrompt,
    promptTemplate,
    userPrompt: String(userPrompt || ""),
  };

  if (!String(userPrompt || "").trim()) {
    throw failWith(
      "Nothing to send to the model — set a prompt or provide Run input",
      resolved
    );
  }

  const { client } = getClientForProvider(provider, model);
  const generationOptions = withGenerationOptions(model || "gpt-4o-mini", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: String(userPrompt) },
    ],
    temperature: data.temperature ?? 0.4,
    maxTokens: data.maxTokens ?? 1200,
  });
  // Not every provider shim accepts response_format; the system prompt already
  // demands JSON, so only send the flag where it is known to be supported.
  if (wantsJson && ["openai", "deepseek"].includes(String(provider))) {
    generationOptions.response_format = { type: "json_object" };
  }
  resolved.model = generationOptions.model;

  let completion;
  try {
    completion = await client.chat.completions.create(generationOptions);
  } catch (err) {
    throw failWith(err instanceof Error ? err.message : String(err), resolved);
  }
  const text = completion.choices?.[0]?.message?.content || "";

  let json = null;
  let jsonError = null;
  if (wantsJson) {
    try {
      json = JSON.parse(extractJsonBlock(text));
    } catch (err) {
      jsonError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    resolved,
    output: {
      text,
      json,
      jsonError,
      provider,
      model: generationOptions.model,
      isLlm: true,
      assistantId: assistantMeta?.id || null,
      assistantName: assistantMeta?.name || data.assistantName || null,
    },
  };
};

/** Models sometimes wrap JSON in prose or a fenced block; pull the object out. */
const extractJsonBlock = (text) => {
  const raw = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced ? fenced[1] : raw).trim();
  if (candidate.startsWith("{") || candidate.startsWith("[")) return candidate;
  const start = candidate.search(/[{[]/);
  if (start === -1) return candidate;
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  return end > start ? candidate.slice(start, end + 1) : candidate;
};

const SINGLE_EXPRESSION = /^\{\{\s*([^}]+?)\s*\}\}$/;

/** Resolves one `{{...}}` key to its raw value (may be an object, array, number). */
const lookupExpression = (key, context) => {
  if (key === "input") {
    const input = context.input;
    if (input == null) return "";
    if (typeof input === "string") return input;
    if (typeof input === "object" && input.message != null) return input.message;
    return input;
  }
  if (key === "input.message") {
    const input = context.input;
    if (input == null) return "";
    if (typeof input === "string") return input;
    return input.message ?? "";
  }
  if (key.startsWith("input.")) {
    let cur = context.input;
    for (const p of key.slice("input.".length).split(".")) {
      if (cur == null) return "";
      cur = cur[p];
    }
    return cur ?? "";
  }
  if (key.startsWith("steps.")) {
    const parsed = parseStepsKey(key);
    if (!parsed) return "";
    try {
      return resolveStepsExpression(parsed, context);
    } catch (err) {
      if (err instanceof ExpressionReferenceError) throw err;
      throw err;
    }
  }
  if (key.startsWith("items.")) {
    const [nodeId, ...props] = key.slice("items.".length).split(".");
    let cur = context.items?.[nodeId];
    for (const p of props) {
      if (cur == null) return "";
      cur = cur[p];
    }
    return cur ?? "";
  }
  // `{{item.field}}` refers to the current item while iterating.
  if (key === "item") return getItemPayload(context.item) ?? "";
  if (key.startsWith("item.")) {
    let cur = getItemPayload(context.item);
    for (const p of key.slice("item.".length).split(".")) {
      if (cur == null) return "";
      cur = cur[p];
    }
    return cur ?? "";
  }
  return "";
};

/**
 * Every node output is also exposed as an array of items so the item-based
 * nodes (Split Out, Filter, Aggregate, ...) have something to work with,
 * without changing the single-payload `steps` channel older workflows use.
 */
const deriveItems = (output) => {
  if (output == null) return [];
  if (Array.isArray(output)) return output;
  if (typeof output !== "object") return [{ value: output }];
  if (Array.isArray(output.items)) return output.items;
  if (Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output.body)) return output.body;
  return [output];
};

const stringifyValue = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

/**
 * Type-preserving resolution: a template that is exactly one expression keeps
 * the underlying type (number stays a number), so comparisons behave sanely.
 * Mixed templates still produce a string.
 */
const resolveExpression = (template, context) => {
  if (typeof template !== "string") return template;
  const single = SINGLE_EXPRESSION.exec(template.trim());
  if (single) return lookupExpression(single[1].trim(), context);
  return interpolate(template, context);
};

const interpolate = (template, context) => {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, path) =>
    stringifyValue(lookupExpression(String(path).trim(), context))
  );
};

/** Unwrap canonical WorkflowItem { json } or legacy plain object payload. */
const getItemPayload = (item) => {
  if (item == null) return item;
  if (typeof item !== "object" || Array.isArray(item)) return item;
  if (
    item.json &&
    typeof item.json === "object" &&
    !Array.isArray(item.json)
  ) {
    return item.json;
  }
  const { pairedItem, binary, json, ...rest } = item;
  if (Object.keys(rest).length > 0) return rest;
  return item;
};

/** Reads `a.b.0.c` out of an item, tolerating missing links. */
const getByPath = (source, path) => {
  if (source == null) return undefined;
  let cur = getItemPayload(source);
  for (const part of String(path).split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
};

/** Upstream nodes often hand over a JSON-encoded array rather than an array. */
const parseArrayish = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
};

/** TSV-ish rendering so item lists stay usable by AI nodes and Result. */
const itemsToText = (items) => {
  if (!Array.isArray(items) || items.length === 0) return "";
  const objects = items
    .map((i) => getItemPayload(i))
    .filter((i) => i && typeof i === "object" && !Array.isArray(i));
  if (objects.length !== items.length) {
    return items.map((i) => stringifyValue(getItemPayload(i))).join("\n");
  }
  const headers = [...new Set(objects.flatMap((i) => Object.keys(i)))];
  return [
    headers.join("\t"),
    ...objects.map((i) => headers.map((h) => stringifyValue(i[h])).join("\t")),
  ].join("\n");
};

/**
 * Best-effort numeric coercion: spreadsheet and API values arrive as
 * "3.08%", "1,234" or "$99", which must compare as numbers.
 */
const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\s,%$£€]/g, "");
  if (!cleaned || !/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const isEmptyValue = (value) =>
  value == null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);

const isTruthyValue = (value) => {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0" && v !== "null" && v !== "undefined";
  }
  return Boolean(value);
};

/** Shared comparison used by the Condition and Filter nodes. */
const compareValues = (left, operator, right) => {
  switch (operator) {
    case "is_empty":
      return isEmptyValue(left);
    case "is_not_empty":
      return !isEmptyValue(left);
    case "truthy":
      return isTruthyValue(left);
    case "regex":
      try {
        return new RegExp(String(right)).test(stringifyValue(left));
      } catch {
        throw new Error(`Invalid regular expression: ${String(right)}`);
      }
    case "contains":
      return stringifyValue(left).includes(stringifyValue(right));
    case "not_contains":
      return !stringifyValue(left).includes(stringifyValue(right));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(left);
      const b = toNumber(right);
      if (a == null || b == null) {
        throw new Error(
          `Cannot compare "${stringifyValue(left)}" ${operator} "${stringifyValue(
            right
          )}" — both sides must be numeric`
        );
      }
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
    case "not_equals":
    case "equals":
    default: {
      const a = toNumber(left);
      const b = toNumber(right);
      const equal =
        a != null && b != null
          ? a === b
          : stringifyValue(left) === stringifyValue(right);
      return operator === "not_equals" ? !equal : equal;
    }
  }
};

const buildUrl = (base, query) => {
  const entries = Object.entries(query).filter(([, v]) => v !== "" && v != null);
  if (entries.length === 0) return base;
  const separator = base.includes("?") ? "&" : "?";
  const search = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}${separator}${search}`;
};

/** Injects a stored credential into the outgoing request. */
const applyCredential = async (credentialId, context, headers, query) => {
  let credential;
  try {
    credential = await getSecretForWorkspace(credentialId, context.workspaceId);
  } catch (err) {
    throw failWith(err instanceof Error ? err.message : String(err), {
      credentialId,
    });
  }

  const { type, secret } = credential;
  if (type === "bearer") {
    headers.Authorization = `Bearer ${secret.token}`;
  } else if (type === "api_key_header") {
    headers[secret.headerName] = secret.value;
  } else if (type === "basic") {
    const encoded = Buffer.from(
      `${secret.username}:${secret.password}`
    ).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else if (type === "query_param") {
    query[secret.paramName] = secret.value;
  }
};

const parseRetryAfter = (value) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.min(Math.max(at - Date.now(), 0), 60000);
};

/**
 * One request with a timeout, backing off on 429 and 5xx while honouring
 * Retry-After. Returns the parsed body alongside the status.
 */
const fetchWithRateLimitRetry = async (
  url,
  { method, headers, body },
  { timeoutMs, resolved, attempts = 2, redirect } = {}
) => {
  const maxAttempts = Math.min(Math.max(attempts, 0), 5) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        ...(redirect ? { redirect } : {}),
      });

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxAttempts) {
        const wait =
          parseRetryAfter(res.headers.get("retry-after")) ?? 1000 * attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      const parsed = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : await res.text();

      return { status: res.status, ok: res.ok, body: parsed };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw failWith(
        aborted
          ? `Request timed out after ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
        { ...resolved, url }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw failWith("HTTP request failed after retries", { ...resolved, url });
};

const handlers = {
  trigger: async (node, context) => ({
    output: {
      triggered: true,
      kind: "manual",
      input: context.input ?? node.data?.defaultInput ?? {},
    },
  }),

  // Part 10A/10B internal sub-workflow entry.
  workflowTrigger: async (node, context) => {
    const input = context.input || {};
    const toItems = (rawItems) =>
      (Array.isArray(rawItems) ? rawItems : []).map((raw) => {
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          if (
            Object.prototype.hasOwnProperty.call(raw, "json") ||
            Object.prototype.hasOwnProperty.call(raw, "binary")
          ) {
            const item = { json: raw.json ?? null };
            if (raw.binary != null) item.binary = raw.binary;
            return item;
          }
          return { json: raw };
        }
        return { json: raw ?? null };
      });

    if (input.source === "subworkflow" && Array.isArray(input.items)) {
      const items = toItems(input.items);
      return {
        output: {
          triggered: true,
          kind: "subworkflow",
          itemCount: items.length,
        },
        items,
      };
    }

    // Manual / editor test of a callable workflow: optional items on run input.
    if (Array.isArray(input.items)) {
      const items = toItems(input.items);
      return {
        output: {
          triggered: true,
          kind: "workflowTrigger",
          itemCount: items.length,
        },
        items,
      };
    }

    return {
      output: {
        triggered: true,
        kind: "workflowTrigger",
        itemCount: 0,
      },
      items: [{ json: {} }],
    };
  },

  // Part 11A — Error Workflow entry (library hidden until 11B).
  errorTrigger: async (node, context) => {
    const input = context.input || {};
    if (input.source === "error_workflow" && input.errorEvent) {
      const event =
        input.errorEvent && typeof input.errorEvent === "object"
          ? input.errorEvent
          : {};
      return {
        output: {
          triggered: true,
          kind: "error_workflow",
        },
        items: [{ json: event }],
      };
    }
    // Manual execute of a workflow that contains Error Trigger — empty safe event.
    return {
      output: {
        triggered: true,
        kind: "errorTrigger",
        empty: true,
      },
      items: [
        {
          json: {
            event: "workflow_failed",
            workflow: { id: null, name: null },
            execution: {
              runId: null,
              rootRunId: null,
              triggerSource: "manual",
              startedAt: null,
              failedAt: null,
            },
            failure: {
              nodeId: null,
              nodeName: null,
              nodeType: null,
              executionIndex: null,
              code: "NO_EVENT",
              message: "No failure event (manual Error Trigger execution)",
            },
          },
        },
      ],
    };
  },

  executeWorkflow: async (node, context) => {
    const childWorkflowId = String(node.data?.workflowId || "").trim();
    if (!childWorkflowId) {
      const err = new Error("Select a workflow to execute");
      err.code = "EXECUTE_WORKFLOW_MISSING_TARGET";
      throw err;
    }

    if (context.editorMode) {
      const err = new Error(
        "Execute Workflow requires a full workflow run. Run Step cannot safely wait for a child workflow."
      );
      err.code = "EXECUTE_WORKFLOW_PARTIAL_UNSUPPORTED";
      err.statusCode = 400;
      throw err;
    }

    if (!context.runId) {
      const err = new Error(
        "Execute Workflow requires a durable parent run"
      );
      err.code = "EXECUTE_WORKFLOW_NO_RUN";
      throw err;
    }

    if (childWorkflowId === context.workflowId) {
      const err = new Error("This workflow cannot call itself");
      err.code = "SUBWORKFLOW_RECURSION";
      throw err;
    }

    return {
      invokeChild: true,
      childWorkflowId,
      items: Array.isArray(context.inputItems) ? context.inputItems : [],
    };
  },

  schedule: async (node, context) => {
    const { rulesToCrons, buildTestTriggerPayload } = require("../utils/scheduleRules");
    const data = node.data || {};
    const timezone = data.timezone || "UTC";
    const crons = rulesToCrons(data);
    const testPayload = buildTestTriggerPayload(timezone);
    return {
      output: {
        triggered: true,
        kind: "schedule",
        cron: crons[0] || null,
        crons,
        timezone,
        input: context.input ?? {},
        ...testPayload,
      },
      items: [{ json: testPayload }],
    };
  },

  webhook: async (node, context) => ({
    output: {
      triggered: true,
      kind: "webhook",
      input: context.input ?? {},
    },
  }),

  ai: async (node, context) => runLlmNode(node, context, { requireBot: false }),

  bot: async (node, context) => runLlmNode(node, context, { requireBot: true }),

  // Part 12B — AI Agent (normal execution node)
  aiAgent: async (node, context) => {
    const { executeAiAgent } = require("./workflowAiAgent.service");
    return executeAiAgent(node, context, {
      interpolate,
      resolveExpression,
    });
  },

  // Part 12A fixtures — agent is structural passthrough; providers must not run.
  aiAgentTest: async (node, context) => {
    const items = Array.isArray(context.inputItems) ? context.inputItems : [];
    return {
      output: { items, passthrough: true, kind: "aiAgentTest" },
      items,
    };
  },
  aiModelProviderTest: async (node) => {
    const { assertNotProviderRunStep } = require("./workflowAiResources.service");
    assertNotProviderRunStep(node);
  },
  aiToolProviderTest: async (node) => {
    const { assertNotProviderRunStep } = require("./workflowAiResources.service");
    assertNotProviderRunStep(node);
  },
  aiMemoryProviderTest: async (node) => {
    const { assertNotProviderRunStep } = require("./workflowAiResources.service");
    assertNotProviderRunStep(node);
  },
  aiChatModel: async (node) => {
    const { assertNotProviderRunStep } = require("./workflowAiResources.service");
    assertNotProviderRunStep(node);
  },
  aiCalculatorTool: async (node) => {
    const { assertNotProviderRunStep } = require("./workflowAiResources.service");
    assertNotProviderRunStep(node);
  },
  aiHttpTool: async (node) => {
    const { assertNotProviderRunStep } = require("./workflowAiResources.service");
    assertNotProviderRunStep(node);
  },

  http: async (node, context) => {
    const data = node.data || {};
    const method = String(data.method || "GET").toUpperCase();
    const url = interpolate(data.url || "", {
      input: context.input,
      steps: context.steps,
    });
    if (!url) {
      throw new Error("HTTP node requires a URL");
    }

    const scope = { input: context.input, steps: context.steps };
    const headers = { ...(data.headers || {}) };
    const query = {};
    for (const row of Array.isArray(data.queryParams) ? data.queryParams : []) {
      const key = String(row?.key || "").trim();
      if (!key) continue;
      query[key] = stringifyValue(resolveExpression(String(row?.value ?? ""), scope));
    }

    if (data.credentialId) {
      await applyCredential(data.credentialId, context, headers, query);
    }

    let body;
    if (data.body != null && method !== "GET" && method !== "HEAD") {
      body =
        typeof data.body === "string"
          ? interpolate(data.body, scope)
          : JSON.stringify(data.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const timeoutMs = Number(data.timeoutMs) || 30000;
    const maxPages = Math.min(Math.max(Number(data.maxPages) || 1, 1), 50);
    const pageParam = String(data.pageParam || "").trim();
    const pageSizeParam = String(data.pageSizeParam || "").trim();
    const pageSize = Number(data.pageSize) || null;
    const itemsPath = String(data.itemsPath || "").trim();

    const resolved = {
      method,
      url,
      headers: redactHeaders(headers),
      query: redactHeaders(query),
      body: body ?? null,
      timeoutMs,
      credentialId: data.credentialId || null,
      maxPages,
    };

    const pages = [];
    const allItems = [];
    let lastStatus = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const requestUrl = buildUrl(url, {
        ...query,
        ...(pageParam ? { [pageParam]: String(page) } : {}),
        ...(pageSizeParam && pageSize
          ? { [pageSizeParam]: String(pageSize) }
          : {}),
      });

      const res = await fetchWithRateLimitRetry(
        requestUrl,
        { method, headers, body },
        { timeoutMs, resolved, attempts: Number(data.rateLimitRetries ?? 2) }
      );
      lastStatus = res.status;

      if (!res.ok && data.failOnHttpError !== false) {
        throw failWith(
          `HTTP ${res.status}: ${
            typeof res.body === "string"
              ? res.body.slice(0, 300)
              : JSON.stringify(res.body).slice(0, 300)
          }`,
          { ...resolved, url: requestUrl, status: res.status }
        );
      }

      pages.push(res.body);
      const pageItems = itemsPath
        ? getByPath(res.body, itemsPath)
        : Array.isArray(res.body)
          ? res.body
          : null;
      if (Array.isArray(pageItems)) allItems.push(...pageItems);

      // Stop as soon as a page comes back short or empty.
      if (maxPages === 1) break;
      if (!Array.isArray(pageItems) || pageItems.length === 0) break;
      if (pageSize && pageItems.length < pageSize) break;
    }

    const single = pages.length === 1;
    const responseBody = single ? pages[0] : pages;
    const items = allItems.length > 0 ? allItems : deriveItems(responseBody);

    return {
      resolved: { ...resolved, status: lastStatus, pagesFetched: pages.length },
      items,
      output: {
        status: lastStatus,
        ok: lastStatus != null && lastStatus < 400,
        body: responseBody,
        pages: single ? undefined : pages.length,
        items: allItems.length > 0 ? allItems : undefined,
      },
    };
  },

  condition: async (node, context) => {
    const data = node.data || {};
    const scope = { input: context.input, steps: context.steps };
    const leftTemplate = String(data.left ?? "{{input}}");
    const rightTemplate = String(data.right ?? "");
    const left = resolveExpression(leftTemplate, scope);
    const right = resolveExpression(rightTemplate, scope);
    const op = data.operator || "equals";

    const resolved = {
      leftTemplate,
      rightTemplate,
      left,
      leftType: typeof left,
      right,
      rightType: typeof right,
      operator: op,
    };

    let pass;
    try {
      pass = compareValues(left, op, right);
    } catch (err) {
      throw failWith(err instanceof Error ? err.message : String(err), resolved);
    }

    return {
      resolved: { ...resolved, pass },
      // A router forwards the data it received; it does not become the data.
      items: context.inputItems,
      output: { pass, left, right, operator: op },
      nextHandle: pass ? "true" : "false",
    };
  },

  set: async (node, context) => {
    const data = node.data || {};
    const mappings = Array.isArray(data.mappings) ? data.mappings : [];
    const inputItems = Array.isArray(context.inputItems) ? context.inputItems : [];

    const buildFields = (scope) => {
      const fields = {};
      for (const row of mappings) {
        const key = String(row?.key || "").trim();
        if (!key) continue;
        fields[key] = resolveExpression(String(row?.value ?? ""), scope);
      }
      if (data.fields && typeof data.fields === "object") {
        for (const [key, value] of Object.entries(data.fields)) {
          fields[key] = resolveExpression(String(value ?? ""), scope);
        }
      }
      return fields;
    };

    if (inputItems.length === 0) {
      const fields = buildFields({
        input: context.input,
        steps: context.steps,
        items: context.items,
        graph: context.graph,
        currentNodeId: node.id,
      });
      if (Object.keys(fields).length === 0) {
        throw new Error("Set node requires at least one mapping");
      }
      return {
        resolved: { fields },
        output: {
          fields,
          ...fields,
        },
      };
    }

    const items = inputItems.map((inputItem, index) => {
      const payload = getItemPayload(inputItem);
      const fields = buildFields({
        input: context.input,
        steps: context.steps,
        items: context.items,
        item: payload,
        currentItem: inputItem,
        currentItemIndex: index,
        currentNodeId: node.id,
        graph: context.graph,
        inputItems: context.inputItems,
      });
      if (Object.keys(fields).length === 0) {
        throw new Error("Set node requires at least one mapping");
      }
      return { ...payload, ...fields };
    });

    return {
      resolved: {
        itemsIn: inputItems.length,
        itemsOut: items.length,
        keys: Object.keys(buildFields({ input: context.input, steps: context.steps, item: getItemPayload(inputItems[0]) })),
      },
      items,
      output:
        items.length === 1
          ? items[0]
          : { count: items.length, items, text: itemsToText(items) },
    };
  },

  document: async (node, context) => {
    const data = node.data || {};
    const documentId = String(data.documentId || "").trim();
    if (!documentId) {
      throw new Error("Document node requires a documentId");
    }

    const [rows] = await pool.execute(
      "SELECT * FROM workspace_documents WHERE id = ?",
      [documentId]
    );
    if (rows.length === 0) {
      throw new Error("Document not found");
    }
    const doc = rows[0];
    if (
      context.workspaceId &&
      doc.workspace_id &&
      doc.workspace_id !== context.workspaceId
    ) {
      throw new Error("Document does not belong to this workspace");
    }

    let text = "";
    if (doc.markdown_storage_key) {
      try {
        text = await readTextFile(doc.markdown_storage_key);
      } catch (err) {
        throw new Error(
          `Failed to read document text: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    if (!text) {
      throw new Error(
        "Document has no extracted text yet — wait for conversion or pick another file"
      );
    }

    return {
      resolved: {
        documentId: doc.id,
        name: doc.original_name,
        characters: text.length,
      },
      output: {
        documentId: doc.id,
        name: doc.original_name,
        text,
        textPreview: String(text).slice(0, 500),
      },
    };
  },

  spreadsheet: async (node, context) => {
    const data = node.data || {};
    const documentId = String(data.documentId || "").trim();
    if (!documentId) {
      throw new Error(
        "Spreadsheet node requires a workspace Excel/CSV file — pick or upload one"
      );
    }

    const [rows] = await pool.execute(
      "SELECT * FROM workspace_documents WHERE id = ?",
      [documentId]
    );
    if (rows.length === 0) {
      throw new Error("Spreadsheet file not found");
    }
    const doc = rows[0];
    if (
      context.workspaceId &&
      doc.workspace_id &&
      doc.workspace_id !== context.workspaceId
    ) {
      throw new Error("File does not belong to this workspace");
    }

    const ext = String(
      doc.file_extension || path.extname(doc.original_name || "")
    )
      .replace(/^\./, "")
      .toLowerCase();
    const allowed = new Set(["xlsx", "xls", "csv", "txt"]);
    // Allow non-spreadsheet extensions if we only have converted markdown tables
    const parseOpts = {
      sheetName: data.sheetName,
      hasHeader: data.hasHeader !== false,
      rowLimit: data.rowLimit,
    };

    // Prefer original binary when still on disk
    if (doc.storage_key) {
      try {
        const buffer = await readBinaryFile(doc.storage_key);
        const useExt = allowed.has(ext) ? ext : "xlsx";
        const parsed = await parseSpreadsheetBuffer(buffer, useExt, parseOpts);
        return {
          resolved: {
            documentId: doc.id,
            name: doc.original_name,
            source: "original",
            sheet: parsed.sheet,
            headers: parsed.headers,
            rowCount: parsed.rowCount,
            truncated: Boolean(parsed.truncated),
            ...parseOpts,
          },
          output: {
            documentId: doc.id,
            name: doc.original_name,
            source: "original",
            ...parsed,
          },
        };
      } catch (err) {
        console.warn(
          `[workflow-spreadsheet] original read failed for ${documentId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // Fallback: converted markdown (original often deleted after conversion)
    if (doc.markdown_storage_key) {
      try {
        const markdown = await readTextFile(doc.markdown_storage_key);
        const parsed = parseSpreadsheetFromMarkdown(markdown, parseOpts);
        if (parsed.rowCount === 0 && !String(parsed.text || "").trim()) {
          throw new Error("Converted spreadsheet markdown was empty");
        }
        return {
          resolved: {
            documentId: doc.id,
            name: doc.original_name,
            source: "markdown",
            sheet: parsed.sheet,
            headers: parsed.headers,
            rowCount: parsed.rowCount,
            truncated: Boolean(parsed.truncated),
            ...parseOpts,
          },
          output: {
            documentId: doc.id,
            name: doc.original_name,
            ...parsed,
          },
        };
      } catch (err) {
        throw new Error(
          `Failed to read spreadsheet data: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    throw new Error(
      "Spreadsheet has no original file or converted data. Re-upload the Excel/CSV in this node’s Settings, then Execute again."
    );
  },

  email: async (node, context) => {
    const data = node.data || {};
    const to = interpolate(String(data.to || ""), {
      input: context.input,
      steps: context.steps,
    });
    const subject = interpolate(String(data.subject || ""), {
      input: context.input,
      steps: context.steps,
    });
    const bodyTemplate = data.emailBody || data.body || "";
    const text = interpolate(String(bodyTemplate), {
      input: context.input,
      steps: context.steps,
    });

    const resolved = { to, subject, text };
    if (!String(to).trim()) {
      throw failWith("Email node requires a To address", resolved);
    }
    if (!String(subject).trim()) {
      throw failWith("Email node requires a subject", resolved);
    }
    if (!String(text).trim()) {
      throw failWith("Email node requires a body", resolved);
    }

    const result = await sendMail({ to, subject, text });
    return {
      resolved,
      output: {
        to,
        subject,
        sent: result.sent,
        skipped: Boolean(result.skipped),
        messageId: result.messageId || null,
      },
    };
  },

  splitOut: async (node, context) => {
    const data = node.data || {};
    const field = String(data.fieldName || "").trim();
    const scope = { input: context.input, steps: context.steps, items: context.items };

    let source;
    if (field) {
      source = field.includes("{{")
        ? resolveExpression(field, scope)
        : context.inputItems
            .map((item) => getByPath(item, field))
            .map(parseArrayish)
            .find((v) => Array.isArray(v));
    } else {
      source = context.inputItems;
    }
    source = parseArrayish(source);

    if (!Array.isArray(source)) {
      throw failWith(
        field
          ? `Split Out: "${field}" is not an array on the incoming data`
          : "Split Out: nothing to split — connect a node that produces a list",
        { fieldName: field, itemsIn: context.inputItems.length }
      );
    }

    const items = source.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry
        : { value: entry }
    );

    return {
      resolved: { fieldName: field || "(incoming items)", itemsOut: items.length },
      items,
      output: { count: items.length, items, text: itemsToText(items) },
    };
  },

  filter: async (node, context) => {
    const data = node.data || {};
    const field = String(data.fieldName || "").trim();
    const operator = data.operator || "truthy";
    const right = data.right ?? "";
    const items = context.inputItems;

    const kept = [];
    const dropped = [];
    for (const item of items) {
      const left = field
        ? getByPath(item, field)
        : resolveExpression(String(data.left || "{{item}}"), {
            input: context.input,
            steps: context.steps,
            items: context.items,
            item: getItemPayload(item),
            currentItem: item,
            currentNodeId: node.id,
            graph: context.graph,
            inputItems: context.inputItems,
          });
      const comparison = compareValues(left, operator, right);
      if (comparison) kept.push(item);
      else dropped.push(item);
    }

    return {
      resolved: {
        fieldName: field || String(data.left || "{{item}}"),
        operator,
        right,
        itemsIn: items.length,
        kept: kept.length,
        dropped: dropped.length,
      },
      items: kept,
      output: {
        count: kept.length,
        droppedCount: dropped.length,
        items: kept,
        text: itemsToText(kept),
      },
    };
  },

  limit: async (node, context) => {
    const max = Math.max(Number(node.data?.maxItems) || 10, 0);
    const keepLast = node.data?.keep === "last";
    const items = keepLast
      ? context.inputItems.slice(-max)
      : context.inputItems.slice(0, max);
    return {
      resolved: { maxItems: max, keep: keepLast ? "last" : "first", itemsIn: context.inputItems.length },
      items,
      output: { count: items.length, items, text: itemsToText(items) },
    };
  },

  sort: async (node, context) => {
    const field = String(node.data?.fieldName || "").trim();
    if (!field) throw new Error("Sort node requires a field name");
    const descending = node.data?.direction === "desc";

    const items = [...context.inputItems].sort((a, b) => {
      const av = getByPath(a, field);
      const bv = getByPath(b, field);
      const an = toNumber(av);
      const bn = toNumber(bv);
      const result =
        an != null && bn != null
          ? an - bn
          : stringifyValue(av).localeCompare(stringifyValue(bv));
      return descending ? -result : result;
    });

    return {
      resolved: { fieldName: field, direction: descending ? "desc" : "asc", itemsIn: items.length },
      items,
      output: { count: items.length, items, text: itemsToText(items) },
    };
  },

  removeDuplicates: async (node, context) => {
    const field = String(node.data?.fieldName || "").trim();
    const seen = new Set();
    const items = [];
    for (const item of context.inputItems) {
      const key = field
        ? stringifyValue(getByPath(item, field))
        : JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    return {
      resolved: {
        fieldName: field || "(whole item)",
        itemsIn: context.inputItems.length,
        removed: context.inputItems.length - items.length,
      },
      items,
      output: { count: items.length, items, text: itemsToText(items) },
    };
  },

  aggregate: async (node, context) => {
    const data = node.data || {};
    const operation = data.operation || "count";
    const field = String(data.fieldName || "").trim();
    const items = context.inputItems;

    const numbers = field
      ? items.map((i) => toNumber(getByPath(i, field))).filter((n) => n != null)
      : [];

    let value;
    switch (operation) {
      case "sum":
        value = numbers.reduce((a, b) => a + b, 0);
        break;
      case "avg":
        value = numbers.length
          ? numbers.reduce((a, b) => a + b, 0) / numbers.length
          : 0;
        break;
      case "min":
        value = numbers.length ? Math.min(...numbers) : null;
        break;
      case "max":
        value = numbers.length ? Math.max(...numbers) : null;
        break;
      case "concat":
        value = items
          .map((i) => stringifyValue(field ? getByPath(i, field) : i))
          .join(data.separator ?? ", ");
        break;
      case "list":
        value = items.map((i) => (field ? getByPath(i, field) : i));
        break;
      case "count":
      default:
        value = items.length;
        break;
    }

    if (
      ["sum", "avg", "min", "max"].includes(operation) &&
      numbers.length === 0
    ) {
      throw failWith(
        `Aggregate: no numeric values found in "${field || "(no field set)"}"`,
        { operation, fieldName: field, itemsIn: items.length }
      );
    }

    const aggregated = {
      operation,
      field: field || null,
      value,
      count: items.length,
    };

    return {
      resolved: { operation, fieldName: field || null, itemsIn: items.length, value },
      items: [aggregated],
      output: { ...aggregated, text: stringifyValue(value) },
    };
  },

  merge: async (node, context) => {
    const mode = normalizeMergeMode(node.data?.mode);
    const portInputs = context.portInputs;

    const getPortItems = (portId) => {
      const port = portInputs?.[portId];
      if (!port || port.state === PORT_STATES.SKIPPED) return [];
      return port.items || [];
    };

    const payloadOf = (item) => {
      if (item && typeof item === "object" && item.json && !Array.isArray(item.json)) {
        return item.json;
      }
      return item && typeof item === "object" ? item : {};
    };

    const binaryOf = (item) =>
      item && typeof item === "object" && item.binary ? item.binary : undefined;

    const wrapOutput = (items, resolved) => ({
      resolved,
      items,
      output: {
        count: items.length,
        items,
        text: itemsToText(items),
      },
    });

    // Legacy flat combine (no port separation) — backward compatible.
    if (!portInputs && mode === "combine") {
      const flat = context.inputItems || [];
      const combined = flat.reduce(
        (acc, item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? { ...acc, ...payloadOf(item) }
            : acc,
        {}
      );
      return wrapOutput([combined], { mode, itemsIn: flat.length, legacy: true });
    }

    if (!portInputs) {
      const flat = context.inputItems || [];
      return wrapOutput(flat, { mode, itemsIn: flat.length });
    }

    const input1Items = getPortItems("input1");
    const input2Items = getPortItems("input2");

    if (mode === "append") {
      const items = [];
      for (const portId of MERGE_PORT_IDS) {
        const port = portInputs[portId];
        if (!port || port.state === PORT_STATES.SKIPPED) continue;
        for (let i = 0; i < port.items.length; i += 1) {
          const src = port.items[i];
          const item = { json: cloneJsonData(payloadOf(src)) };
          if (binaryOf(src)) item.binary = binaryOf(src);
          item.pairedItem = { item: i, input: port.inputIndex };
          items.push(item);
        }
      }
      return wrapOutput(items, {
        mode,
        input1Count: input1Items.length,
        input2Count: input2Items.length,
      });
    }

    if (mode === "combineByPosition") {
      const count = Math.min(input1Items.length, input2Items.length);
      const items = [];
      for (let i = 0; i < count; i += 1) {
        const j1 = payloadOf(input1Items[i]);
        const j2 = payloadOf(input2Items[i]);
        const merged = { ...cloneJsonData(j1), ...cloneJsonData(j2) };
        const item = {
          json: merged,
          pairedItem: [
            { item: i, input: 0 },
            { item: i, input: 1 },
          ],
        };
        const b1 = binaryOf(input1Items[i]);
        const b2 = binaryOf(input2Items[i]);
        if (b1 || b2) item.binary = { ...(b1 || {}), ...(b2 || {}) };
        items.push(item);
      }
      return wrapOutput(items, {
        mode,
        matchedPositions: count,
        input1Count: input1Items.length,
        input2Count: input2Items.length,
      });
    }

    if (mode === "combineByKey") {
      const fields = node.data?.matchFields || {};
      const field1 = String(fields.field1 || fields.input1Field || "").trim();
      const field2 = String(fields.field2 || fields.input2Field || "").trim();
      const joinMode = node.data?.joinMode || "keepMatches";

      const keyOf = (obj, field) => {
        if (!field) return undefined;
        return field
          .split(".")
          .reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
      };

      const index2 = new Map();
      for (let i = 0; i < input2Items.length; i += 1) {
        const k = keyOf(payloadOf(input2Items[i]), field2);
        if (k === undefined || index2.has(k)) continue;
        index2.set(k, i);
      }

      const items = [];
      const matched2 = new Set();

      for (let i = 0; i < input1Items.length; i += 1) {
        const j1 = payloadOf(input1Items[i]);
        const k1 = keyOf(j1, field1);
        const j = k1 !== undefined ? index2.get(k1) : undefined;
        const hasMatch = j !== undefined;

        if (joinMode === "keepMatches" && !hasMatch) continue;
        if (joinMode === "keepNonMatches" && hasMatch) continue;

        let merged;
        let pairedItem;
        if (hasMatch) {
          matched2.add(j);
          const j2 = payloadOf(input2Items[j]);
          merged = { ...cloneJsonData(j1), ...cloneJsonData(j2) };
          pairedItem = [
            { item: i, input: 0 },
            { item: j, input: 1 },
          ];
        } else if (joinMode === "enrichInput1" || joinMode === "keepNonMatches") {
          merged = cloneJsonData(j1);
          pairedItem = { item: i, input: 0 };
        } else {
          continue;
        }

        const item = { json: merged, pairedItem };
        const b1 = binaryOf(input1Items[i]);
        const b2 = hasMatch ? binaryOf(input2Items[j]) : undefined;
        if (b1 || b2) item.binary = { ...(b1 || {}), ...(b2 || {}) };
        items.push(item);
      }

      if (joinMode === "keepNonMatches") {
        for (let j = 0; j < input2Items.length; j += 1) {
          if (matched2.has(j)) continue;
          const j2 = payloadOf(input2Items[j]);
          const item = {
            json: cloneJsonData(j2),
            pairedItem: { item: j, input: 1 },
          };
          const b2 = binaryOf(input2Items[j]);
          if (b2) item.binary = b2;
          items.push(item);
        }
      }

      return wrapOutput(items, {
        mode,
        joinMode,
        field1,
        field2,
        input1Count: input1Items.length,
        input2Count: input2Items.length,
      });
    }

    if (mode === "combine") {
      const fold = (portItems) =>
        portItems.reduce(
          (acc, item) => ({ ...acc, ...cloneJsonData(payloadOf(item)) }),
          {}
        );
      const combined = { ...fold(input1Items), ...fold(input2Items) };
      return wrapOutput([combined], {
        mode,
        input1Count: input1Items.length,
        input2Count: input2Items.length,
      });
    }

    return wrapOutput([], { mode, input1Count: 0, input2Count: 0 });
  },

  switch: async (node, context) => {
    const data = normalizeSwitchRules(node.data || {}, { nodeId: node.id });
    const rules = Array.isArray(data.rules) ? data.rules : [];
    const routingMode = data.routingMode || "firstMatch";
    const enableFallback = data.enableFallback !== false;
    const inputItems = Array.isArray(context.inputItems) ? context.inputItems : [];

    const outputsByPort = {};
    for (const rule of rules) {
      outputsByPort[rule.id] = [];
    }
    if (enableFallback) {
      outputsByPort[SWITCH_FALLBACK_HANDLE] = [];
    }

    for (let inputIndex = 0; inputIndex < inputItems.length; inputIndex += 1) {
      const sourceItem = inputItems[inputIndex];
      const itemPayload = getItemPayload(sourceItem);
      const scope = {
        input: context.input,
        steps: context.steps,
        item: itemPayload,
        items: inputItems,
        graph: context.graph,
        currentNodeId: node.id,
        currentItemIndex: inputIndex,
        currentItem: sourceItem,
      };

      const matchedPorts = [];
      for (const rule of rules) {
        const left = resolveExpression(String(rule.left ?? "{{item}}"), scope);
        const right =
          rule.right != null && String(rule.right).length > 0
            ? resolveExpression(String(rule.right), scope)
            : "";
        let pass;
        try {
          pass = compareValues(left, rule.operator || "equals", right);
        } catch (err) {
          throw failWith(
            err instanceof Error ? err.message : String(err),
            { ruleId: rule.id, left, operator: rule.operator, right }
          );
        }
        if (pass) {
          matchedPorts.push(rule.id);
          if (routingMode === "firstMatch") break;
        }
      }

      if (matchedPorts.length === 0 && enableFallback) {
        matchedPorts.push(SWITCH_FALLBACK_HANDLE);
      }

      for (const portId of matchedPorts) {
        if (!outputsByPort[portId]) continue;
        const cloned = cloneItem(sourceItem);
        outputsByPort[portId].push(cloned);
      }
    }

    const activeHandles = getSwitchOutputPortIds(data);
    const portCounts = Object.fromEntries(
      Object.entries(outputsByPort).map(([portId, items]) => [portId, items.length])
    );

    return {
      resolved: {
        routingMode,
        ruleCount: rules.length,
        itemsIn: inputItems.length,
        portCounts,
      },
      outputsByPort,
      activeHandles,
      items: [],
      output: {
        routed: true,
        routingMode,
        portCounts,
      },
    };
  },

  code: async (node, context) => {
    const data = node.data || {};
    const mode = data.mode === "each" ? "each" : "all";
    const timeoutMs = Number(data.timeoutMs) || 2000;

    const { result, logs } = runSandboxedCode({
      code: data.code,
      mode,
      items: context.inputItems,
      input: context.input,
      steps: context.steps,
      timeoutMs,
    });

    const items = Array.isArray(result)
      ? result.map((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? entry
            : { value: entry }
        )
      : result && typeof result === "object"
        ? [result]
        : [{ value: result }];

    return {
      resolved: {
        mode,
        timeoutMs,
        itemsIn: context.inputItems.length,
        itemsOut: items.length,
        logs,
      },
      items,
      output: {
        result,
        count: items.length,
        items,
        logs,
        text: typeof result === "string" ? result : itemsToText(items),
      },
    };
  },

  noop: async (node, context) => ({
    items: context.inputItems,
    output: {
      passthrough: true,
      label: node.data?.label || "No Operation",
      input: context.input,
    },
  }),

  loop: async (node, context) => {
    const {
      executeLoopOccurrence,
    } = require("./workflowLoopRuntime.service");
    if (context?.editorMode) {
      const err = new Error(
        "Loop is not supported in editor partial execution (Part 9C)."
      );
      err.code = "LOOP_PARTIAL_UNSUPPORTED";
      throw err;
    }
    return executeLoopOccurrence({
      node,
      graph: context.graph,
      context,
      runData: context.runData || {},
    });
  },

  wait: async (node, context) => {
    const data = node.data || {};
    const inputItems = Array.isArray(context.inputItems) ? context.inputItems : [];
    const now = context.now instanceof Date ? context.now : new Date();
    const {
      resolveWaitMode,
      WAIT_MODES,
      computeWaitResumeAt: computeResume,
    } = require("./workflowWait.service");
    const mode = resolveWaitMode(data);

    // Completing a previously suspended Wait on resume.
    if (context.resumingWaitNodeId === node.id) {
      return {
        items: inputItems,
        output: {
          waited: true,
          resumeMode: mode,
          resumedAt: now.toISOString(),
          resumeAt: context.waitResumeAt
            ? new Date(context.waitResumeAt).toISOString()
            : undefined,
          resumeMechanism: context.waitResumeMechanism || undefined,
        },
        resolved: { resumed: true, resumeMode: mode, itemsOut: inputItems.length },
      };
    }

    // Editor partial runs never create durable suspensions or tokens.
    if (context.editorMode) {
      const preview =
        mode === WAIT_MODES.TIME
          ? { wouldResumeAt: computeResume(data, now).toISOString() }
          : { wouldWaitFor: mode };
      return {
        items: inputItems,
        output: {
          waited: false,
          editorPreview: true,
          resumeMode: mode,
          ...preview,
          message:
            "Wait requires a full workflow execution to suspend. This preview does not sleep.",
        },
        resolved: {
          editorPreview: true,
          resumeMode: mode,
          ...preview,
          itemsOut: inputItems.length,
        },
      };
    }

    if (mode === WAIT_MODES.MANUAL) {
      return {
        suspend: true,
        resumeMode: WAIT_MODES.MANUAL,
        resumeAt: null,
        items: inputItems,
        output: {
          waiting: true,
          resumeMode: WAIT_MODES.MANUAL,
        },
        resolved: {
          waiting: true,
          resumeMode: WAIT_MODES.MANUAL,
          itemsIn: inputItems.length,
        },
      };
    }

    if (mode === WAIT_MODES.EXTERNAL) {
      return {
        suspend: true,
        resumeMode: WAIT_MODES.EXTERNAL,
        resumeAt: null,
        items: inputItems,
        output: {
          waiting: true,
          resumeMode: WAIT_MODES.EXTERNAL,
        },
        resolved: {
          waiting: true,
          resumeMode: WAIT_MODES.EXTERNAL,
          itemsIn: inputItems.length,
        },
      };
    }

    const resumeAt = computeResume(data, now);
    return {
      suspend: true,
      resumeMode: WAIT_MODES.TIME,
      resumeAt: resumeAt.toISOString(),
      items: inputItems,
      output: {
        waiting: true,
        resumeMode: WAIT_MODES.TIME,
        resumeAt: resumeAt.toISOString(),
      },
      resolved: {
        waiting: true,
        resumeMode: WAIT_MODES.TIME,
        resumeAt: resumeAt.toISOString(),
        itemsIn: inputItems.length,
      },
    };
  },

  integration: async (node) => {
    const name = node.data?.label || node.data?.libraryId || "Integration";
    throw new Error(
      `${name} is not executable yet in OpsAi. Remove it or replace with an available node.`
    );
  },

  result: async (node, context) => {
    const data = node.data || {};
    const mapFrom = data.mapFrom || "{{input}}";

    const hasText = (out) =>
      out && typeof out === "object" && typeof out.text === "string";
    const steps = Object.entries(context.steps || {});
    const llmStep = [...steps].reverse().find(([, out]) => hasText(out) && out.isLlm);

    let effectiveMapFrom = mapFrom;
    if (mapFrom === "{{input}}" || mapFrom === "{{input.message}}") {
      const anyTextStep = [...steps].reverse().find(([, out]) => hasText(out));
      const chosen = llmStep || anyTextStep;
      if (chosen) {
        effectiveMapFrom = `{{steps.${chosen[0]}.text}}`;
      }
    } else if (llmStep) {
      // An AI/Bot ran in this workflow: never return raw loader output instead
      // of the generated answer (e.g. Result still pointing at a Spreadsheet).
      const referenced = /\{\{\s*steps\.([^.}\s]+)/.exec(String(mapFrom))?.[1];
      const referencedOutput = referenced ? context.steps[referenced] : null;
      const referencesLoader =
        referencedOutput &&
        typeof referencedOutput === "object" &&
        !referencedOutput.isLlm;
      if (referencesLoader) {
        effectiveMapFrom = `{{steps.${llmStep[0]}.text}}`;
      }
    }

    let mapped = interpolate(effectiveMapFrom, {
      input: context.input,
      steps: context.steps,
    });

    if (typeof mapped === "string") {
      const trimmed = mapped.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.message != null &&
            Object.keys(parsed).length <= 2
          ) {
            mapped = String(parsed.message);
          }
        } catch {
          // keep mapped
        }
      }
    }

    // Historical Result contract (pre-10B): terminal scalar `output.result` only.
    // Canonical WorkflowItem[] for callable return are captured by the engine from
    // Result's *incoming* items (__callableReturnItems) — not by changing Result
    // into a passthrough node.
    return {
      resolved: { mapFrom, effectiveMapFrom },
      output: {
        result: mapped,
      },
      terminal: true,
    };
  },
};

const executeNode = async (node, context) => {
  const type = node.type || node.data?.nodeType;
  const handler = handlers[type];
  if (!handler) {
    throw new Error(`Unknown node type: ${type}`);
  }
  return handler(node, context);
};

module.exports = {
  handlers,
  executeNode,
  interpolate,
  resolveExpression,
  compareValues,
  deriveItems,
  getItemPayload,
  getByPath,
  ExpressionReferenceError,
  // Shared HTTP primitives (Part 13A HTTP Tool reuses these)
  buildUrl,
  applyCredential,
  fetchWithRateLimitRetry,
};
