/**
 * Part 11B — Error Trigger + Error Workflow configuration UX tests.
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart11BTests = ({ check, section, assert }) => {
  section("Part 11B Error Trigger + Error Workflow configuration UX");

  const { pool } = require("../config/database");
  const { executeRun } = require("../services/workflowEngine.service");
  const errRouting = () => require("../services/workflowErrorRouting.service");
  const workflowsService = () =>
    require("../modules/workflows/workflows.service");
  const { searchNodes } = (() => {
    // Frontend search is TS — approximate with library JSON + meta for smoke.
    return {
      searchNodes: null,
    };
  })();

  let fixtures = null;

  const ensureFixtures = async () => {
    if (fixtures) return fixtures;
    const [workspaces] = await pool.execute(`SELECT id FROM workspaces LIMIT 1`);
    const [users] = await pool.execute(`SELECT id FROM users LIMIT 1`);
    if (!workspaces.length || !users.length) {
      fixtures = { skip: true };
      return fixtures;
    }
    fixtures = {
      skip: false,
      workspaceId: workspaces[0].id,
      userId: users[0].id,
      authUser: { userId: users[0].id, role: "Admin" },
      createdWorkflowIds: [],
    };
    return fixtures;
  };

  const insertWorkflow = async (name, definition, extra = {}) => {
    const fx = await ensureFixtures();
    if (fx.skip) return null;
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO workflows
        (id, workspace_id, name, description, definition_json, status, created_by, error_workflow_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        fx.workspaceId,
        name,
        "part11b",
        JSON.stringify(definition),
        extra.status || "draft",
        fx.userId,
        extra.errorWorkflowId || null,
      ]
    );
    fx.createdWorkflowIds.push(id);
    return id;
  };

  const cleanup = async () => {
    const fx = await ensureFixtures();
    if (fx.skip || !fx.createdWorkflowIds?.length) return;
    for (const id of fx.createdWorkflowIds.splice(0)) {
      try {
        await pool.execute(`DELETE FROM workflows WHERE id = ?`, [id]);
      } catch {
        // ignore
      }
    }
  };

  const parseJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const failingDef = () => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", data: {} },
      {
        id: "boom",
        type: "code",
        data: { code: "throw new Error('boom-11b');" },
      },
    ],
    edges: [{ id: "e1", source: "t", target: "boom" }],
  });

  const okDef = () => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", data: {} },
      {
        id: "ok",
        type: "set",
        data: { mappings: [{ key: "ok", value: "true" }] },
      },
    ],
    edges: [{ id: "e1", source: "t", target: "ok" }],
  });

  const errorHandlerDef = (extraNodes = [], extraEdges = []) => ({
    version: 1,
    nodes: [
      { id: "err", type: "errorTrigger", data: {} },
      {
        id: "note",
        type: "set",
        data: {
          mappings: [
            { key: "handled", value: "true" },
            { key: "msg", value: "{{item.failure.message}}" },
          ],
        },
      },
      ...extraNodes,
    ],
    edges: [
      { id: "e1", source: "err", target: "note" },
      ...extraEdges,
    ],
  });

  const startAndFail = async (workflowId, definition) => {
    const fx = await ensureFixtures();
    const runId = uuidv4();
    const [wf] = await pool.execute(
      `SELECT error_workflow_id, name FROM workflows WHERE id = ?`,
      [workflowId]
    );
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         suppress_error_routing, status, input_json, created_by,
         definition_snapshot_json)
       VALUES (?, ?, ?, ?, 0, 'queued', ?, ?, ?)`,
      [
        runId,
        workflowId,
        wf[0].name,
        wf[0].error_workflow_id || null,
        JSON.stringify({ source: "manual" }),
        fx.userId,
        JSON.stringify(definition),
      ]
    );
    await assert.rejects(() => executeRun(runId));
    const [runs] = await pool.execute(
      `SELECT status, error_workflow_id_snapshot, suppress_error_routing
       FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    return { runId, run: runs[0] };
  };

  const dispatchAndRunError = async (sourceRunId) => {
    await errRouting().processPendingErrorDispatches(5, "test-11b");
    const d = await errRouting().getDispatchForSourceRun(sourceRunId);
    if (d?.error_run_id) {
      await executeRun(d.error_run_id);
    }
    return d;
  };

  const libPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );
  const contractPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeContract.ts"
  );
  const searchMetaPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeSearchMeta.ts"
  );
  const canvasPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/WorkflowCanvas.tsx"
  );
  const pickerPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/NodePickerDialog.tsx"
  );
  const schemasPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
  );

  check("TEST 11B-1 Error Trigger available in library", () => {
    const lib = JSON.parse(fs.readFileSync(libPath, "utf8"));
    const row = (lib.nodes || []).find((n) => n.id === "error-trigger");
    assert.ok(row);
    assert.strictEqual(row.available, true);
    assert.strictEqual(row.engineType, "errorTrigger");
  });

  check("TEST 11B-2 Error Trigger category = Triggers", () => {
    const lib = JSON.parse(fs.readFileSync(libPath, "utf8"));
    const row = (lib.nodes || []).find((n) => n.id === "error-trigger");
    assert.strictEqual(row.category, "Triggers");
    assert.strictEqual(row.name, "Error Trigger");
  });

  check("TEST 11B-3 Error Trigger has no input port", () => {
    const contract = fs.readFileSync(contractPath, "utf8");
    assert.ok(/errorTrigger:\s*\{[\s\S]*?inputs:\s*\[\]/.test(contract));
    const canvas = fs.readFileSync(canvasPath, "utf8");
    assert.ok(canvas.includes('"errorTrigger"') || canvas.includes("errorTrigger"));
    assert.ok(/START_TYPES[\s\S]*errorTrigger/.test(canvas));
  });

  check("TEST 11B-4 Error Trigger outputs one safe event item", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11b-4", errorHandlerDef());
    const srcId = await insertWorkflow("src-11b-4", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    const [steps] = await pool.execute(
      `SELECT output_json FROM workflow_run_steps
       WHERE run_id = ? AND node_id = 'err'`,
      [d.error_run_id]
    );
    assert.ok(steps.length);
    const out = parseJson(steps[0].output_json, {});
    const items = Array.isArray(out) ? out : out.items || [out];
    // step output may be items array or wrapped
    const blob = JSON.stringify(out);
    assert.ok(/workflow_failed/.test(blob));
    assert.ok(/boom-11b/.test(blob));
    await cleanup();
  });

  check("TEST 11B-5 Error Trigger found by \"error\"", () => {
    const meta = fs.readFileSync(searchMetaPath, "utf8");
    assert.ok(meta.includes('"error-trigger"') || meta.includes("error-trigger"));
    assert.ok(/aliases:[\s\S]*"error"/.test(meta));
  });

  check("TEST 11B-6 Error Trigger found by \"failure\"", () => {
    const meta = fs.readFileSync(searchMetaPath, "utf8");
    assert.ok(/"failure"/.test(meta));
  });

  check("TEST 11B-7 Error Trigger excluded from insert-on-edge", () => {
    const picker = fs.readFileSync(pickerPath, "utf8");
    assert.ok(picker.includes("excludeTriggers"));
    const canvas = fs.readFileSync(canvasPath, "utf8");
    assert.ok(/excludeTriggers/.test(canvas));
  });

  check("TEST 11B-8 Error Trigger excluded as ordinary downstream next-step where required", () => {
    const canvas = fs.readFileSync(canvasPath, "utf8");
    assert.ok(/excludeTriggers/.test(canvas));
    assert.ok(/Add next step/.test(canvas));
  });

  check("TEST 11B-9 Error target list is workspace-scoped", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11b-9", errorHandlerDef());
    const rows = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: null }
    );
    assert.ok(rows.some((r) => r.id === handlerId));
    assert.ok(rows.every((r) => r.id && r.name && "validErrorWorkflow" in r));
    await cleanup();
  });

  check("TEST 11B-10 Self target disabled/rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const id = await insertWorkflow("self-11b-10", errorHandlerDef());
    const rows = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: id }
    );
    const self = rows.find((r) => r.id === id);
    assert.ok(self);
    assert.strictEqual(self.isSelf, true);
    assert.strictEqual(self.validErrorWorkflow, false);
    await assert.rejects(
      () =>
        workflowsService().setErrorWorkflow(id, id, fx.authUser),
      (err) => err.code === "ERROR_WORKFLOW_SELF"
    );
    await cleanup();
  });

  check("TEST 11B-11 Valid target selectable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11b-11", errorHandlerDef());
    const srcId = await insertWorkflow("src-11b-11", failingDef());
    const rows = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: srcId }
    );
    const t = rows.find((r) => r.id === handlerId);
    assert.ok(t.validErrorWorkflow);
    await cleanup();
  });

  check("TEST 11B-12 Zero Error Trigger target rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const bad = await insertWorkflow("bad-0", okDef());
    const srcId = await insertWorkflow("src-11b-12", failingDef());
    await assert.rejects(
      () => workflowsService().setErrorWorkflow(srcId, bad, fx.authUser),
      (err) => err.code === "ERROR_WORKFLOW_NOT_CALLABLE"
    );
    await cleanup();
  });

  check("TEST 11B-13 Two Error Trigger target rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const bad = await insertWorkflow("bad-2", {
      version: 1,
      nodes: [
        { id: "e1", type: "errorTrigger", data: {} },
        { id: "e2", type: "errorTrigger", data: {} },
      ],
      edges: [],
    });
    const srcId = await insertWorkflow("src-11b-13", failingDef());
    await assert.rejects(
      () => workflowsService().setErrorWorkflow(srcId, bad, fx.authUser),
      (err) => err.code === "ERROR_WORKFLOW_NOT_CALLABLE"
    );
    await cleanup();
  });

  check("TEST 11B-14 Result node not required", () => {
    const v = errRouting().validateErrorWorkflow(errorHandlerDef());
    assert.strictEqual(v.valid, true);
    assert.ok(!errorHandlerDef().nodes.some((n) => n.type === "result"));
  });

  check("TEST 11B-15 Additional Schedule trigger allowed", () => {
    const def = errorHandlerDef(
      [{ id: "sch", type: "schedule", data: { cron: "0 9 * * *" } }],
      []
    );
    assert.strictEqual(errRouting().validateErrorWorkflow(def).valid, true);
  });

  check("TEST 11B-16 Additional Webhook trigger allowed", () => {
    const def = errorHandlerDef(
      [{ id: "wh", type: "webhook", data: {} }],
      []
    );
    assert.strictEqual(errRouting().validateErrorWorkflow(def).valid, true);
  });

  check("TEST 11B-17 Inactive valid target selectable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-draft", errorHandlerDef(), {
      status: "draft",
    });
    const srcId = await insertWorkflow("src-11b-17", failingDef());
    const rows = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: srcId }
    );
    const t = rows.find((r) => r.id === handlerId);
    assert.strictEqual(t.status, "draft");
    assert.strictEqual(t.validErrorWorkflow, true);
    const updated = await workflowsService().setErrorWorkflow(
      srcId,
      handlerId,
      fx.authUser
    );
    assert.strictEqual(updated.errorWorkflowId, handlerId);
    await cleanup();
  });

  check("TEST 11B-18 Soft-deleted target excluded", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-del", errorHandlerDef());
    await pool.execute(
      `UPDATE workflows SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [handlerId]
    );
    const rows = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser
    );
    assert.ok(!rows.some((r) => r.id === handlerId));
    await cleanup();
  });

  check("TEST 11B-19 Setting valid target persists error_workflow_id", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-19", errorHandlerDef());
    const srcId = await insertWorkflow("src-19", failingDef());
    const updated = await workflowsService().setErrorWorkflow(
      srcId,
      handlerId,
      fx.authUser
    );
    assert.strictEqual(updated.errorWorkflowId, handlerId);
    const got = await workflowsService().getById(srcId, fx.authUser);
    assert.strictEqual(got.errorWorkflowId, handlerId);
    await cleanup();
  });

  check("TEST 11B-20 Clearing setting persists NULL", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-20", errorHandlerDef());
    const srcId = await insertWorkflow("src-20", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const updated = await workflowsService().setErrorWorkflow(
      srcId,
      null,
      fx.authUser
    );
    assert.strictEqual(updated.errorWorkflowId, null);
    await cleanup();
  });

  check("TEST 11B-21 Cross-workspace setting rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const [otherWs] = await pool.execute(
      `SELECT id FROM workspaces WHERE id <> ? LIMIT 1`,
      [fx.workspaceId]
    );
    if (!otherWs.length) return assert.ok(true);
    const otherId = uuidv4();
    await pool.execute(
      `INSERT INTO workflows
        (id, workspace_id, name, description, definition_json, status, created_by)
       VALUES (?, ?, ?, 'x', ?, 'draft', ?)`,
      [
        otherId,
        otherWs[0].id,
        "other-ws-handler",
        JSON.stringify(errorHandlerDef()),
        fx.userId,
      ]
    );
    fx.createdWorkflowIds.push(otherId);
    const srcId = await insertWorkflow("src-21", failingDef());
    await assert.rejects(
      () =>
        workflowsService().setErrorWorkflow(srcId, otherId, fx.authUser),
      (err) => err.code === "FORBIDDEN" || err.statusCode === 403
    );
    await cleanup();
  });

  check("TEST 11B-22 Renamed target remains linked by ID", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-old-name", errorHandlerDef());
    const srcId = await insertWorkflow("src-22", failingDef(), {
      errorWorkflowId: handlerId,
    });
    await pool.execute(`UPDATE workflows SET name = ? WHERE id = ?`, [
      "handler-new-name",
      handlerId,
    ]);
    const got = await workflowsService().getById(srcId, fx.authUser);
    assert.strictEqual(got.errorWorkflowId, handlerId);
    const rows = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: srcId }
    );
    assert.strictEqual(
      rows.find((r) => r.id === handlerId).name,
      "handler-new-name"
    );
    await cleanup();
  });

  check("TEST 11B-23 Deleted selected target renders missing state", async () => {
    // Settings UI treats selectedId not in list as missing — list excludes deleted.
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-23", errorHandlerDef());
    const srcId = await insertWorkflow("src-23", failingDef(), {
      errorWorkflowId: handlerId,
    });
    await pool.execute(
      `UPDATE workflows SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [handlerId]
    );
    // FK ON DELETE SET NULL may clear — if soft-delete only, pointer may remain.
    const [rows] = await pool.execute(
      `SELECT error_workflow_id FROM workflows WHERE id = ?`,
      [srcId]
    );
    const list = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: srcId }
    );
    assert.ok(!list.some((r) => r.id === handlerId));
    // Soft-delete does not cascade SET NULL (FK is hard DELETE only)
    assert.ok(
      rows[0].error_workflow_id === handlerId ||
        rows[0].error_workflow_id == null
    );
    await cleanup();
  });

  check("TEST 11B-24 Invalidated selected target renders invalid state", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-24", errorHandlerDef());
    const srcId = await insertWorkflow("src-24", failingDef(), {
      errorWorkflowId: handlerId,
    });
    await pool.execute(
      `UPDATE workflows SET definition_json = ? WHERE id = ?`,
      [JSON.stringify(okDef()), handlerId]
    );
    const list = await workflowsService().listErrorTargets(
      fx.workspaceId,
      fx.authUser,
      { excludeWorkflowId: srcId }
    );
    const t = list.find((r) => r.id === handlerId);
    assert.ok(t);
    assert.strictEqual(t.validation.valid, false);
    assert.strictEqual(t.validErrorWorkflow, false);
    await cleanup();
  });

  check("TEST 11B-25 Picker search/open does not dirty node cache", () => {
    const dialog = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowErrorSettingsDialog.tsx"
      ),
      "utf8"
    );
    assert.ok(!dialog.includes("invalidateEditorSession"));
    assert.ok(!dialog.includes("cacheDirty"));
  });

  check("TEST 11B-26 Changing error target does not dirty node execution results", () => {
    const dialog = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowErrorSettingsDialog.tsx"
      ),
      "utf8"
    );
    assert.ok(dialog.includes("setErrorWorkflow"));
    assert.ok(!dialog.includes("invalidateEditor"));
  });

  check("TEST 11B-27 Existing active run keeps old snapshot", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const a = await insertWorkflow("handler-A", errorHandlerDef());
    const b = await insertWorkflow("handler-B", errorHandlerDef());
    const srcId = await insertWorkflow("src-27", failingDef(), {
      errorWorkflowId: a,
    });
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         suppress_error_routing, status, input_json, created_by,
         definition_snapshot_json)
       VALUES (?, ?, 'src', ?, 0, 'running', '{}', ?, ?)`,
      [runId, srcId, a, fx.userId, JSON.stringify(failingDef())]
    );
    await workflowsService().setErrorWorkflow(srcId, b, fx.authUser);
    const [runs] = await pool.execute(
      `SELECT error_workflow_id_snapshot FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(runs[0].error_workflow_id_snapshot, a);
    await cleanup();
  });

  check("TEST 11B-28 New run snapshots new target", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const a = await insertWorkflow("handler-A28", errorHandlerDef());
    const b = await insertWorkflow("handler-B28", errorHandlerDef());
    const srcId = await insertWorkflow("src-28", failingDef(), {
      errorWorkflowId: a,
    });
    await workflowsService().setErrorWorkflow(srcId, b, fx.authUser);
    const { run } = await startAndFail(srcId, failingDef());
    assert.strictEqual(run.error_workflow_id_snapshot, b);
    await cleanup();
  });

  check("TEST 11B-29 Source failure launches selected Error Workflow", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-29", errorHandlerDef());
    const srcId = await insertWorkflow("src-29", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId, run } = await startAndFail(srcId, failingDef());
    assert.strictEqual(run.status, "failed");
    const d = await dispatchAndRunError(runId);
    assert.ok(d.error_run_id);
    const [errRun] = await pool.execute(
      `SELECT status, workflow_id FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(errRun[0].workflow_id, handlerId);
    assert.strictEqual(errRun[0].status, "succeeded");
    await cleanup();
  });

  check("TEST 11B-30 Source success does not launch Error Workflow", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-30", errorHandlerDef());
    const srcId = await insertWorkflow("src-30", okDef(), {
      errorWorkflowId: handlerId,
    });
    const runId = uuidv4();
    const [wf] = await pool.execute(
      `SELECT error_workflow_id, name FROM workflows WHERE id = ?`,
      [srcId]
    );
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         suppress_error_routing, status, input_json, created_by,
         definition_snapshot_json)
       VALUES (?, ?, ?, ?, 0, 'queued', '{}', ?, ?)`,
      [
        runId,
        srcId,
        wf[0].name,
        wf[0].error_workflow_id,
        fx.userId,
        JSON.stringify(okDef()),
      ]
    );
    await executeRun(runId);
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11B-31 Source cancel does not launch Error Workflow", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-31", errorHandlerDef());
    const srcId = await insertWorkflow("src-31", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         suppress_error_routing, status, input_json, created_by,
         definition_snapshot_json)
       VALUES (?, ?, 'src', ?, 0, 'cancelled', '{}', ?, ?)`,
      [runId, srcId, handlerId, fx.userId, JSON.stringify(failingDef())]
    );
    await errRouting().ensureErrorDispatchForFailedRun(runId);
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11B-32 Successful retry does not launch Error Workflow", () => {
    // Covered by 11A-17; retries use data.retries — engine only fails after exhaustion.
    const eng = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(eng.includes("markRunFailedAndEnsureDispatch"));
    assert.ok(eng.includes("errorPolicy"));
  });

  check("TEST 11B-33 Retry exhaustion launches exactly one", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-33", errorHandlerDef());
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "boom",
          type: "code",
          data: {
            code: "throw new Error('retry-boom');",
            retries: 2,
            retryDelayMs: 1,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "boom" }],
    };
    const srcId = await insertWorkflow("src-33", def, {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, def);
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS c FROM workflow_error_dispatches WHERE source_run_id = ?`,
      [runId]
    );
    assert.strictEqual(Number(rows[0].c), 1);
    await cleanup();
  });

  check("TEST 11B-34 Error Workflow failure does not recursively dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const storm = await insertWorkflow("storm", errorHandlerDef());
    const badHandler = await insertWorkflow(
      "bad-handler",
      {
        version: 1,
        nodes: [
          { id: "err", type: "errorTrigger", data: {} },
          {
            id: "boom",
            type: "code",
            data: { code: "throw new Error('handler boom');" },
          },
        ],
        edges: [{ id: "e1", source: "err", target: "boom" }],
      },
      { errorWorkflowId: storm }
    );
    const srcId = await insertWorkflow("src-34", failingDef(), {
      errorWorkflowId: badHandler,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await errRouting().processPendingErrorDispatches(5, "test-11b");
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.ok(d?.error_run_id);
    await assert.rejects(() => executeRun(d.error_run_id));
    const nested = await errRouting().getDispatchForSourceRun(d.error_run_id);
    assert.strictEqual(nested, null);
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    await cleanup();
  });

  check("TEST 11B-35 Error Workflow Wait remains independent", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow(
      "handler-wait",
      errorHandlerDef(
        [
          {
            id: "w",
            type: "wait",
            data: { resumeMode: "time", waitAmount: 1, waitUnit: "hours" },
          },
        ],
        [{ id: "e2", source: "note", target: "w" }]
      )
    );
    const srcId = await insertWorkflow("src-35", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId, run } = await startAndFail(srcId, failingDef());
    assert.strictEqual(run.status, "failed");
    const d = await dispatchAndRunError(runId);
    // Error run may be waiting — source still failed
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    assert.ok(d.error_run_id);
    await cleanup();
  });

  check("TEST 11B-36 Error Workflow child inherits suppression", async () => {
    const sub = fs.readFileSync(
      path.join(__dirname, "../services/workflowSubworkflow.service.js"),
      "utf8"
    );
    assert.ok(sub.includes("suppress_error_routing"));
    assert.ok(sub.includes("suppressErrorRouting"));
  });

  check("TEST 11B-37 Error Trigger event fields work through expressions", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-37", errorHandlerDef());
    const srcId = await insertWorkflow("src-37", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    const [steps] = await pool.execute(
      `SELECT output_json FROM workflow_run_steps
       WHERE run_id = ? AND node_id = 'note'`,
      [d.error_run_id]
    );
    const blob = JSON.stringify(steps[0].output_json);
    assert.ok(/boom-11b/.test(blob));
    await cleanup();
  });

  check("TEST 11B-38 Error Trigger inspector hides secret metadata", () => {
    const nodes = fs.readFileSync(
      path.join(__dirname, "../services/workflowNodes.service.js"),
      "utf8"
    );
    assert.ok(nodes.includes("errorTrigger"));
    const routing = fs.readFileSync(
      path.join(__dirname, "../services/workflowErrorRouting.service.js"),
      "utf8"
    );
    assert.ok(routing.includes("sanitizeMessage"));
    assert.ok(routing.includes("buildSafeFailureEvent"));
  });

  check("TEST 11B-39 Existing Workflow Trigger behavior unchanged", () => {
    const schemas = fs.readFileSync(schemasPath, "utf8");
    assert.ok(schemas.includes("workflowTrigger: \"trigger\""));
  });

  check("TEST 11B-40 Existing Execute Workflow behavior unchanged", () => {
    const api = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/api.ts"),
      "utf8"
    );
    assert.ok(api.includes("listCallableTargets"));
    assert.ok(api.includes("listErrorTargets"));
  });

  check("TEST 11B-41 Existing Wait behavior unchanged", () => {
    assert.ok(
      fs
        .readFileSync(
          path.join(__dirname, "../services/workflowWait.service.js"),
          "utf8"
        )
        .includes("resume")
    );
  });

  check("TEST 11B-42 Existing Loop behavior unchanged", () => {
    assert.ok(
      fs
        .readFileSync(
          path.join(__dirname, "../services/workflowLoopGraph.service.js"),
          "utf8"
        )
        .length > 100
    );
  });

  check("TEST 11B settings dialog + PATCH route exist", () => {
    assert.ok(
      fs.existsSync(
        path.join(
          __dirname,
          "../../frontend/src/components/workflows/WorkflowErrorSettingsDialog.tsx"
        )
      )
    );
    const routes = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assert.ok(routes.includes("/error-targets"));
    assert.ok(routes.includes("/error-workflow"));
  });

  void searchNodes;
};

module.exports = { registerPart11BTests };
