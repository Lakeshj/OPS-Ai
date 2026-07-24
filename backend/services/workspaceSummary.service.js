const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { openai } = require("../config/openai");
const AppError = require("../utils/AppError");
const {
  withGenerationOptions,
} = require("../utils/openaiCompletionOptions");
const {
  assertWorkspaceAccess,
  assertWorkspaceManageAccess,
} = require("./authorization.service");
const {
  getByUseCase,
} = require("../modules/systemPrompts/systemPrompts.service");
const {
  normalizeScoringCategories,
  resolveScoringCategories,
  catalogByKey,
} = require("../utils/scoringCategories");

const SUMMARY_HISTORY_LIMIT = 3;
const BATCH_MAX_CHARS = 40000;

const parseJson = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const formatSummary = (row) => ({
  workspaceId: row.workspace_id,
  version: Number(row.version),
  content: row.content,
  source: row.source,
  documentSnapshot: parseJson(row.document_snapshot, []),
  evaluationScore:
    row.evaluation_score == null ? null : Number(row.evaluation_score),
  evaluationFeedback: row.evaluation_feedback,
  evaluationDetails: parseJson(row.evaluation_details, null),
  summaryModel: row.summary_model,
  evaluationModel: row.evaluation_model,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatVersion = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  version: Number(row.version),
  content: row.content,
  source: row.source,
  documentSnapshot: parseJson(row.document_snapshot, []),
  evaluationScore:
    row.evaluation_score == null ? null : Number(row.evaluation_score),
  evaluationFeedback: row.evaluation_feedback,
  evaluationDetails: parseJson(row.evaluation_details, null),
  summaryModel: row.summary_model,
  evaluationModel: row.evaluation_model,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const getSettings = async () => {
  const [rows] = await pool.execute(
    "SELECT * FROM admin_ai_settings WHERE id = 1"
  );
  if (rows.length === 0) {
    throw new AppError(
      "Admin AI settings are missing",
      500,
      "SETTINGS_MISSING"
    );
  }

  const legacy = rows[0];
  const workspaceSummaryPrompt = await getByUseCase("workspace_summary");
  const scoringCategoryKeys = normalizeScoringCategories(
    workspaceSummaryPrompt?.config?.scoringCategories
  );

  return {
    ...legacy,
    summary_model:
      workspaceSummaryPrompt?.config?.model || legacy.summary_model,
    evaluation_model:
      workspaceSummaryPrompt?.config?.model || legacy.evaluation_model,
    evaluation_prompt:
      workspaceSummaryPrompt?.promptContent || legacy.evaluation_prompt,
    evaluation_config: workspaceSummaryPrompt?.config || {},
    scoringCategoryKeys,
    scoringCategories: resolveScoringCategories(scoringCategoryKeys),
    systemPromptId: workspaceSummaryPrompt?.id || null,
  };
};

const getSummaryRow = async (workspaceId) => {
  const [rows] = await pool.execute(
    "SELECT * FROM workspace_summaries WHERE workspace_id = ?",
    [workspaceId]
  );
  return rows[0] || null;
};

const getSummary = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const summary = await getSummaryRow(workspaceId);
  return summary ? formatSummary(summary) : null;
};

const getVersions = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const [rows] = await pool.execute(
    `
    SELECT *
    FROM workspace_summary_versions
    WHERE workspace_id = ?
    ORDER BY version DESC
    LIMIT 3
    `,
    [workspaceId]
  );
  return rows.map(formatVersion);
};

const getSummaryWithVersions = async (workspaceId, authUser) => {
  const settings = await getSettings();
  return {
    summary: await getSummary(workspaceId, authUser),
    versions: await getVersions(workspaceId, authUser),
    activeScoringCategories: settings.scoringCategoryKeys,
  };
};

const extractJsonObject = (text) => {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Evaluation did not return JSON");
    return JSON.parse(match[0]);
  }
};

const EVALUATION_CATEGORIES = [
  "business_intelligence",
  "customer_intelligence",
  "brand_intelligence",
  "marketing_intelligence",
  "operational_intelligence",
  "constraints",
  "coverage",
  "objectives",
  "persona",
  "completeness",
  "tone",
  "clarity",
  "deliverables",
];

const clampScore = (value) =>
  Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));

const normalizeCategory = (key, raw) => {
  if (raw && typeof raw === "object") {
    return {
      score: clampScore(raw.score),
      feedback:
        typeof raw.feedback === "string" && raw.feedback.trim()
          ? raw.feedback.trim()
          : "No category feedback provided.",
      label:
        typeof raw.label === "string" && raw.label.trim()
          ? raw.label.trim()
          : catalogByKey[key]?.label || undefined,
    };
  }
  if (typeof raw === "number") {
    return {
      score: clampScore(raw),
      feedback: "No category feedback provided.",
      label: catalogByKey[key]?.label,
    };
  }
  return {
    score: 0,
    feedback: `${key} was not assessed.`,
    label: catalogByKey[key]?.label,
  };
};

const normalizeEvaluationDetails = (details, categoryKeys = EVALUATION_CATEGORIES) => {
  const categories = {};
  const sourceCategories =
    details.categories && typeof details.categories === "object"
      ? details.categories
      : details;

  const keys =
    Array.isArray(categoryKeys) && categoryKeys.length > 0
      ? categoryKeys
      : Object.keys(sourceCategories).filter((key) =>
          EVALUATION_CATEGORIES.includes(key)
        );

  const orderedKeys = keys.length > 0 ? keys : EVALUATION_CATEGORIES;

  for (const key of orderedKeys) {
    const raw =
      sourceCategories[key] ??
      sourceCategories[key.replace(/_/g, "")] ??
      null;
    categories[key] = normalizeCategory(key, raw);
    if (!categories[key].label) {
      categories[key].label = catalogByKey[key]?.label || key;
    }
  }

  const resolved = resolveScoringCategories(orderedKeys);
  const hasWeights = resolved.every((item) => typeof item.weight === "number");
  let score;
  if (details.score != null) {
    score = clampScore(details.score);
  } else if (hasWeights) {
    const weightTotal = resolved.reduce((sum, item) => sum + item.weight, 0) || 1;
    score = clampScore(
      resolved.reduce(
        (sum, item) =>
          sum + (categories[item.key]?.score || 0) * (item.weight / weightTotal),
        0
      )
    );
  } else {
    const categoryScores = orderedKeys.map((key) => categories[key].score);
    score = clampScore(
      categoryScores.reduce((sum, value) => sum + value, 0) /
        Math.max(categoryScores.length, 1)
    );
  }

  return {
    score,
    categories,
    categoryOrder: orderedKeys,
    feedback:
      typeof details.feedback === "string" && details.feedback.trim()
        ? details.feedback.trim()
        : typeof details.readinessLevel === "string"
          ? details.readinessLevel
          : "Evaluation completed.",
    strengths: Array.isArray(details.strengths) ? details.strengths : [],
    gaps: Array.isArray(details.gaps) ? details.gaps : [],
    recommendations: Array.isArray(details.recommendations)
      ? details.recommendations
      : [],
    confidence:
      typeof details.confidence === "string" ? details.confidence : null,
    confidenceReason:
      typeof details.confidenceReason === "string"
        ? details.confidenceReason
        : null,
  };
};

const buildEvaluationJsonContract = (scoringCategories) => {
  const categoryLines = scoringCategories
    .map(
      (item) =>
        `    "${item.key}": { "score": <0-100>, "feedback": "<short reason>", "label": "${item.label}" }`
    )
    .join(",\n");

  return `IMPORTANT: Respond with a single JSON object only (valid json). Do not use markdown tables.

Required JSON shape:
{
  "score": <number 0-100 overall AI readiness>,
  "feedback": "<short overall assessment>",
  "categories": {
${categoryLines}
  },
  "strengths": ["<strength useful for AI>", "..."],
  "gaps": ["<missing information>", "..."],
  "recommendations": ["<next upload / improvement>", "..."],
  "confidence": "Low|Medium|High|Very High",
  "confidenceReason": "<why>"
}

Only score these selected categories: ${scoringCategories.map((c) => c.label).join(", ")}.`;
};

const evaluateSummary = async (content, settings) => {
  const evaluationModel =
    settings.evaluation_config?.model ||
    settings.evaluation_model ||
    "gpt-4o-mini";
  const scoringCategories =
    settings.scoringCategories?.length > 0
      ? settings.scoringCategories
      : resolveScoringCategories(settings.scoringCategoryKeys);
  const basePrompt =
    settings.evaluation_prompt ||
    "You are the Workspace Knowledge Evaluator for OpsAi.";
  const evaluationPrompt = `${basePrompt}\n\n${buildEvaluationJsonContract(scoringCategories)}`;

  try {
    const completion = await openai.chat.completions.create(
      withGenerationOptions(evaluationModel, {
        temperature: Number(settings.evaluation_config?.temperature ?? 0.1),
        maxTokens: Number(settings.evaluation_config?.maxTokens ?? 2000),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: evaluationPrompt,
          },
          {
            role: "user",
            content: `Evaluate this workspace knowledge summary and return JSON only.\n\n${content}`,
          },
        ],
      })
    );

    const details = normalizeEvaluationDetails(
      extractJsonObject(completion.choices[0]?.message?.content || "{}"),
      scoringCategories.map((item) => item.key)
    );

    return {
      score: details.score,
      feedback: details.feedback,
      details,
      model: evaluationModel,
    };
  } catch (error) {
    console.error("[workspace-summary] evaluation failed:", error.message);
    throw new AppError(
      error?.message || "Failed to evaluate workspace summary",
      error?.status || error?.statusCode || 502,
      "SUMMARY_EVALUATION_FAILED"
    );
  }
};

const summarizeText = async ({ model, systemPrompt, content }) => {
  const completion = await openai.chat.completions.create(
    withGenerationOptions(model, {
      temperature: 0.2,
      maxTokens: 1400,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    })
  );

  return completion.choices[0]?.message?.content?.trim() || "";
};

const splitIntoBatches = (text, maxChars = BATCH_MAX_CHARS) => {
  const source = String(text || "");
  const batches = [];
  for (let start = 0; start < source.length; start += maxChars) {
    batches.push(source.slice(start, start + maxChars));
  }
  return batches;
};

const getDocumentInputs = async (workspaceId) => {
  const [documents] = await pool.execute(
    `
    SELECT id, original_name
    FROM workspace_documents
    WHERE workspace_id = ?
      AND status = 'ready'
      AND included_in_summary = TRUE
    ORDER BY created_at ASC
    `,
    [workspaceId]
  );

  const inputs = [];
  for (const document of documents) {
    const [chunks] = await pool.execute(
      `
      SELECT content
      FROM document_chunks
      WHERE document_id = ?
      ORDER BY chunk_index ASC
      `,
      [document.id]
    );
    inputs.push({
      id: document.id,
      name: document.original_name,
      content: chunks.map((chunk) => chunk.content).join("\n\n"),
    });
  }
  return inputs;
};

const condenseForFinalSummary = async (sections, model) => {
  let current = sections;
  const systemPrompt =
    "Condense these document summaries without losing business facts, customers/personas, brand/messaging, marketing context, workflows/roles, constraints/guardrails, decisions, terminology, or known gaps. Do not invent details.";

  for (let round = 0; round < 4; round += 1) {
    if (current.join("\n\n---\n\n").length <= 60000) return current;

    const groups = [];
    let group = [];
    let groupChars = 0;
    for (const section of current) {
      if (group.length > 0 && groupChars + section.length > 50000) {
        groups.push(group);
        group = [];
        groupChars = 0;
      }
      group.push(section);
      groupChars += section.length;
    }
    if (group.length > 0) groups.push(group);

    const condensed = [];
    for (const [index, items] of groups.entries()) {
      condensed.push(
        await summarizeText({
          model,
          systemPrompt,
          content: `Summary group ${index + 1} of ${groups.length}\n\n${items.join("\n\n---\n\n")}`,
        })
      );
    }
    current = condensed.filter(Boolean);
  }

  return current;
};

const compileWorkspaceSummary = async (workspaceId, settings) => {
  const documents = await getDocumentInputs(workspaceId);
  if (documents.length === 0) {
    return {
      content:
        "# Workspace Summary\n\nNo active workspace documents are available.",
      documentSnapshot: [],
    };
  }

  // Internal pipeline steps stay in code (not admin System Prompt cards).
  const model = settings.summary_model || "gpt-4o-mini";
  const extractPrompt =
    "Extract factual workspace knowledge for AI chat grounding. Preserve: business/company facts, products/services, customers/personas/ICP, brand voice and messaging, marketing strategy, workflows/processes/roles, constraints/guardrails, terminology, decisions, and known gaps. Do not add facts.";
  const finalPrompt =
    "Create one authoritative Markdown workspace summary for AI chat context. Structure with: business overview, offerings, customers/personas, brand & messaging, marketing context, how we work (processes/roles/tools), constraints/guardrails, key terminology, active decisions, and known gaps. Goal: a chat user should not need to re-explain what this workspace is. Resolve duplication but do not invent facts. Keep concise for repeated LLM context while retaining critical knowledge.";

  const documentSummaries = [];
  for (const document of documents) {
    const batches = splitIntoBatches(document.content);
    const batchSummaries = [];

    for (const [index, batch] of batches.entries()) {
      const summary = await summarizeText({
        model,
        systemPrompt: extractPrompt,
        content: `Document: ${document.name}\nSection ${index + 1} of ${batches.length}\n\n${batch}`,
      });
      if (summary) batchSummaries.push(summary);
    }

    documentSummaries.push(
      `## ${document.name}\n\n${batchSummaries.join("\n\n")}`
    );
  }

  const condensedSummaries = await condenseForFinalSummary(
    documentSummaries,
    model
  );
  const finalContent = await summarizeText({
    model,
    systemPrompt: finalPrompt,
    content: condensedSummaries.join("\n\n---\n\n"),
  });

  return {
    content:
      finalContent || "# Workspace Summary\n\nSummary generation returned no content.",
    documentSnapshot: documents.map((document) => document.id),
  };
};

const pruneVersions = async (connection, workspaceId) => {
  const [rows] = await connection.execute(
    `
    SELECT id
    FROM workspace_summary_versions
    WHERE workspace_id = ?
    ORDER BY version DESC
    `,
    [workspaceId]
  );

  const staleIds = rows
    .slice(SUMMARY_HISTORY_LIMIT)
    .map((row) => row.id);
  if (staleIds.length === 0) return;

  const placeholders = staleIds.map(() => "?").join(", ");
  await connection.execute(
    `DELETE FROM workspace_summary_versions WHERE id IN (${placeholders})`,
    staleIds
  );
};

const saveSummary = async ({
  workspaceId,
  content,
  source,
  documentSnapshot,
  evaluation,
  summaryModel,
  updatedBy,
}) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [currentRows] = await connection.execute(
      "SELECT * FROM workspace_summaries WHERE workspace_id = ? FOR UPDATE",
      [workspaceId]
    );
    const current = currentRows[0] || null;

    if (current) {
      await connection.execute(
        `
        INSERT IGNORE INTO workspace_summary_versions (
          id, workspace_id, version, content, source, document_snapshot,
          evaluation_score, evaluation_feedback, evaluation_details,
          summary_model, evaluation_model, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          workspaceId,
          current.version,
          current.content,
          current.source,
          JSON.stringify(parseJson(current.document_snapshot, [])),
          current.evaluation_score,
          current.evaluation_feedback,
          current.evaluation_details
            ? JSON.stringify(parseJson(current.evaluation_details, {}))
            : null,
          current.summary_model,
          current.evaluation_model,
          current.updated_by,
          current.updated_at,
        ]
      );
    }

    const nextVersion = current ? Number(current.version) + 1 : 1;
    await connection.execute(
      `
      INSERT INTO workspace_summaries (
        workspace_id, version, content, source, document_snapshot,
        evaluation_score, evaluation_feedback, evaluation_details,
        summary_model, evaluation_model, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        version = VALUES(version),
        content = VALUES(content),
        source = VALUES(source),
        document_snapshot = VALUES(document_snapshot),
        evaluation_score = VALUES(evaluation_score),
        evaluation_feedback = VALUES(evaluation_feedback),
        evaluation_details = VALUES(evaluation_details),
        summary_model = VALUES(summary_model),
        evaluation_model = VALUES(evaluation_model),
        updated_by = VALUES(updated_by),
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        workspaceId,
        nextVersion,
        content,
        source,
        JSON.stringify(documentSnapshot),
        evaluation.score,
        evaluation.feedback,
        JSON.stringify(evaluation.details),
        summaryModel,
        evaluation.model,
        updatedBy,
      ]
    );

    await pruneVersions(connection, workspaceId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return formatSummary(await getSummaryRow(workspaceId));
};

const regenerateSummary = async (workspaceId, updatedBy = null) => {
  const settings = await getSettings();
  const compiled = await compileWorkspaceSummary(workspaceId, settings);
  const evaluation = await evaluateSummary(compiled.content, settings);

  return saveSummary({
    workspaceId,
    content: compiled.content,
    source: "auto",
    documentSnapshot: compiled.documentSnapshot,
    evaluation,
    summaryModel: settings.summary_model,
    updatedBy,
  });
};

const regenerateSummaryForUser = async (workspaceId, authUser) => {
  await assertWorkspaceManageAccess(authUser, workspaceId);
  return regenerateSummary(workspaceId, authUser.userId);
};

/**
 * Re-score existing summary content with the current System Prompt + checklist.
 * Much faster than full regenerate-from-files.
 */
const reevaluateExistingSummary = async (workspaceId, updatedBy = null) => {
  const current = await getSummaryRow(workspaceId);
  if (!current) return null;

  const settings = await getSettings();
  const evaluation = await evaluateSummary(current.content, settings);

  return saveSummary({
    workspaceId,
    content: current.content,
    source: current.source || "auto",
    documentSnapshot: parseJson(current.document_snapshot, []),
    evaluation,
    summaryModel: current.summary_model || settings.summary_model,
    updatedBy,
  });
};

const reevaluateAllSummaries = async (updatedBy = null) => {
  const [rows] = await pool.execute(
    "SELECT workspace_id FROM workspace_summaries ORDER BY updated_at DESC"
  );

  const results = [];
  for (const row of rows) {
    try {
      const summary = await reevaluateExistingSummary(
        row.workspace_id,
        updatedBy
      );
      results.push({
        workspaceId: row.workspace_id,
        status: "ok",
        score: summary?.evaluationScore ?? null,
      });
    } catch (error) {
      console.error(
        `[workspace-summary] reevaluate failed for ${row.workspace_id}:`,
        error.message
      );
      results.push({
        workspaceId: row.workspace_id,
        status: "error",
        error: error.message,
      });
    }
  }
  return results;
};

const updateSummary = async (workspaceId, content, authUser) => {
  await assertWorkspaceManageAccess(authUser, workspaceId);
  if (!content || typeof content !== "string" || !content.trim()) {
    throw new AppError(
      "Summary content is required",
      400,
      "VALIDATION_ERROR"
    );
  }

  const settings = await getSettings();
  const current = await getSummaryRow(workspaceId);
  const snapshot = current
    ? parseJson(current.document_snapshot, [])
    : (await getDocumentInputs(workspaceId)).map((document) => document.id);
  const evaluation = await evaluateSummary(content.trim(), settings);

  return saveSummary({
    workspaceId,
    content: content.trim(),
    source: "manual",
    documentSnapshot: snapshot,
    evaluation,
    summaryModel: current?.summary_model || settings.summary_model,
    updatedBy: authUser.userId,
  });
};

const restoreVersion = async (workspaceId, versionId, authUser) => {
  await assertWorkspaceManageAccess(authUser, workspaceId);
  const [rows] = await pool.execute(
    `
    SELECT *
    FROM workspace_summary_versions
    WHERE id = ? AND workspace_id = ?
    `,
    [versionId, workspaceId]
  );
  if (rows.length === 0) {
    throw new AppError("Summary version not found", 404, "NOT_FOUND");
  }

  const version = rows[0];
  const snapshot = parseJson(version.document_snapshot, []);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE workspace_documents SET included_in_summary = FALSE WHERE workspace_id = ?",
      [workspaceId]
    );
    if (snapshot.length > 0) {
      const placeholders = snapshot.map(() => "?").join(", ");
      await connection.execute(
        `
        UPDATE workspace_documents
        SET included_in_summary = TRUE
        WHERE workspace_id = ? AND id IN (${placeholders})
        `,
        [workspaceId, ...snapshot]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const settings = await getSettings();
  const evaluation = {
    score: Number(version.evaluation_score || 0),
    feedback: version.evaluation_feedback || "Restored evaluation.",
    details: parseJson(version.evaluation_details, {}),
    model: version.evaluation_model || settings.evaluation_model,
  };

  return saveSummary({
    workspaceId,
    content: version.content,
    source: "restored",
    documentSnapshot: snapshot,
    evaluation,
    summaryModel: version.summary_model || settings.summary_model,
    updatedBy: authUser.userId,
  });
};

const summaryJobs = new Map();

const runQueuedSummary = async (workspaceId) => {
  const job = summaryJobs.get(workspaceId);
  if (!job) return;
  if (job.running) {
    job.rerun = true;
    return;
  }

  job.running = true;
  job.timer = null;
  try {
    await regenerateSummary(workspaceId, job.updatedBy);
  } catch (error) {
    console.error(
      `[workspace-summary] Failed for ${workspaceId}:`,
      error.message
    );
  } finally {
    job.running = false;
    if (job.rerun) {
      job.rerun = false;
      job.timer = setTimeout(() => {
        void runQueuedSummary(workspaceId);
      }, 1000);
    } else {
      summaryJobs.delete(workspaceId);
    }
  }
};

const queueSummaryRegeneration = (workspaceId, updatedBy = null) => {
  const current = summaryJobs.get(workspaceId) || {
    timer: null,
    running: false,
    rerun: false,
    updatedBy,
  };
  current.updatedBy = updatedBy || current.updatedBy;

  if (current.running) {
    current.rerun = true;
  } else {
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => {
      void runQueuedSummary(workspaceId);
    }, 1500);
  }

  summaryJobs.set(workspaceId, current);
};

module.exports = {
  getSettings,
  getSummary,
  getVersions,
  getSummaryWithVersions,
  regenerateSummary,
  regenerateSummaryForUser,
  reevaluateExistingSummary,
  reevaluateAllSummaries,
  updateSummary,
  restoreVersion,
  queueSummaryRegeneration,
};
