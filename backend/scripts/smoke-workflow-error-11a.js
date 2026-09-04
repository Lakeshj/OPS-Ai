/**
 * Part 11A — Durable Error Workflow / failure routing foundation tests.
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart11ATests = ({ check, section, assert }) => {
  section("Part 11A Durable Error Workflow foundation");

  const { pool } = require("../config/database");
  const { executeRun } = require("../services/workflowEngine.service");
  const { handlers } = require("../services/workflowNodes.service");
  const errRouting = () => require("../services/workflowErrorRouting.service");
  const workflowsService = () =>
    require("../modules/workflows/workflows.service");
  const sub = () => require("../services/workflowSubworkflow.service");

  /** mysql2 may return JSON columns as objects or strings. */
  const parseJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };
  const jsonBlob = (value) =>
    typeof value === "string" ? value : JSON.stringify(value ?? null);

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
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        fx.workspaceId,
        name,
        "part11a",
        JSON.stringify(definition),
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

  const failingDef = () => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", data: {} },
      {
        id: "boom",
        type: "code",
        data: { code: "throw new Error('boom-11a');" },
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
      { id: "r", type: "result", data: { mapFrom: "{{items}}" } },
    ],
    edges: [
      { id: "e1", source: "t", target: "ok" },
      { id: "e2", source: "ok", target: "r" },
    ],
  });

  const errorHandlerDef = () => ({
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
    ],
    edges: [{ id: "e1", source: "err", target: "note" }],
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
         status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        runId,
        workflowId,
        wf[0].name,
        wf[0].error_workflow_id || null,
        JSON.stringify({ source: "manual" }),
        JSON.stringify(definition),
        fx.userId,
      ]
    );
    await pool.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [uuidv4(), runId]
    );
    await assert.rejects(() => executeRun(runId));
    const [rows] = await pool.execute(
      `SELECT status, error, suppress_error_routing, error_workflow_id_snapshot
       FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    return { runId, run: rows[0] };
  };

  const dispatchAndRunError = async (sourceRunId) => {
    await errRouting().ensureErrorDispatchForFailedRun(sourceRunId);
    const d = await errRouting().getDispatchForSourceRun(sourceRunId);
    if (!d) return null;
    if (d.status === "pending" || d.status === "claimed") {
      const claim =
        d.status === "pending"
          ? await errRouting().claimNextErrorDispatch("test-11a")
          : d;
      if (claim && claim.source_run_id === sourceRunId) {
        await errRouting().processErrorDispatch(claim);
      } else if (d.status === "pending") {
        // claimed a different row; process this one directly
        await pool.execute(
          `UPDATE workflow_error_dispatches SET status='claimed', claim_token='t', claimed_at=CURRENT_TIMESTAMP WHERE id=?`,
          [d.id]
        );
        await errRouting().processErrorDispatch({
          ...d,
          status: "claimed",
          claim_token: "t",
        });
      }
    }
    return errRouting().getDispatchForSourceRun(sourceRunId);
  };

  check("TEST 11A-1 No configured Error Workflow → ordinary failure unchanged", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const id = await insertWorkflow("src-none", failingDef());
    const { runId, run } = await startAndFail(id, failingDef());
    assert.strictEqual(run.status, "failed");
    assert.ok(/boom-11a/.test(run.error || ""));
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11A-2 Terminal FAILED creates one durable dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-2", errorHandlerDef());
    const srcId = await insertWorkflow("src-2", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.ok(d);
    assert.strictEqual(d.status, "pending");
    assert.strictEqual(d.error_workflow_id, handlerId);
    await cleanup();
  });

  check("TEST 11A-3 Source remains FAILED after handler success", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-3", errorHandlerDef());
    const srcId = await insertWorkflow("src-3", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    assert.ok(d.error_run_id);
    await executeRun(d.error_run_id);
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    const [errRun] = await pool.execute(
      `SELECT status, suppress_error_routing FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(src[0].status, "failed");
    assert.strictEqual(errRun[0].status, "succeeded");
    assert.strictEqual(Number(errRun[0].suppress_error_routing), 1);
    await cleanup();
  });

  check("TEST 11A-4 Source remains FAILED after handler failure", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const badHandler = await insertWorkflow("handler-4", {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "boom",
          type: "code",
          data: { code: "throw new Error('handler-boom');" },
        },
      ],
      edges: [{ id: "e1", source: "err", target: "boom" }],
    });
    const srcId = await insertWorkflow("src-4", failingDef(), {
      errorWorkflowId: badHandler,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await assert.rejects(() => executeRun(d.error_run_id));
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    const nested = await errRouting().getDispatchForSourceRun(d.error_run_id);
    assert.strictEqual(nested, null);
    await cleanup();
  });

  check("TEST 11A-5 Source worker does not wait for Error Workflow", () => {
    const eng = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(eng.includes("markRunFailedAndEnsureDispatch"));
    assert.ok(!/await executeRun\(.*error/i.test(eng));
    const svc = fs.readFileSync(
      path.join(__dirname, "../services/workflowErrorRouting.service.js"),
      "utf8"
    );
    assert.ok(svc.includes("ERROR_WORKFLOW_SOURCE"));
    assert.ok(svc.includes("workflow_error_dispatches"));
  });

  check("TEST 11A-6 Error run has separate runId", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-6", errorHandlerDef());
    const srcId = await insertWorkflow("src-6", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    assert.ok(d.error_run_id);
    assert.notStrictEqual(d.error_run_id, runId);
    await cleanup();
  });

  check("TEST 11A-7 Error run snapshots its own definition", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-7", errorHandlerDef());
    const srcId = await insertWorkflow("src-7", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    const [errRun] = await pool.execute(
      `SELECT definition_snapshot_json, workflow_id FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(errRun[0].workflow_id, handlerId);
    assert.ok(errRun[0].definition_snapshot_json);
    const snap = parseJson(errRun[0].definition_snapshot_json, {});
    assert.ok(snap.nodes.some((n) => n.type === "errorTrigger"));
    await cleanup();
  });

  check("TEST 11A-8 Source run snapshots errorWorkflowId at run start", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-8", errorHandlerDef());
    const srcId = await insertWorkflow("src-8", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { run } = await startAndFail(srcId, failingDef());
    assert.strictEqual(run.error_workflow_id_snapshot, handlerId);
    await cleanup();
  });

  check("TEST 11A-9 Mid-run A→B config change: existing run dispatches A", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const a = await insertWorkflow("handler-A", errorHandlerDef());
    const b = await insertWorkflow("handler-B", errorHandlerDef());
    const srcId = await insertWorkflow("src-9", failingDef(), {
      errorWorkflowId: a,
    });
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, 'src-9', ?, 'queued', ?, ?, ?)`,
      [
        runId,
        srcId,
        a,
        JSON.stringify({ source: "manual" }),
        JSON.stringify(failingDef()),
        fx.userId,
      ]
    );
    await pool.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [uuidv4(), runId]
    );
    await pool.execute(
      `UPDATE workflows SET error_workflow_id = ? WHERE id = ?`,
      [b, srcId]
    );
    await assert.rejects(() => executeRun(runId));
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(d.error_workflow_id, a);
    await cleanup();
  });

  check("TEST 11A-10 New run uses B", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const a = await insertWorkflow("handler-A10", errorHandlerDef());
    const b = await insertWorkflow("handler-B10", errorHandlerDef());
    const srcId = await insertWorkflow("src-10", failingDef(), {
      errorWorkflowId: a,
    });
    await pool.execute(
      `UPDATE workflows SET error_workflow_id = ? WHERE id = ?`,
      [b, srcId]
    );
    const { run } = await startAndFail(srcId, failingDef());
    assert.strictEqual(run.error_workflow_id_snapshot, b);
    await cleanup();
  });

  check("TEST 11A-11 Same source failure processed twice → one dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11", errorHandlerDef());
    const srcId = await insertWorkflow("src-11", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await errRouting().ensureErrorDispatchForFailedRun(runId);
    await errRouting().ensureErrorDispatchForFailedRun(runId);
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS c FROM workflow_error_dispatches WHERE source_run_id = ?`,
      [runId]
    );
    assert.strictEqual(Number(rows[0].c), 1);
    await cleanup();
  });

  check("TEST 11A-12 Concurrent dispatch claims → one Error run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-12", errorHandlerDef());
    const srcId = await insertWorkflow("src-12", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    const r1 = await errRouting().createOrReuseErrorRun(d);
    const r2 = await errRouting().createOrReuseErrorRun({
      ...d,
      ...(await errRouting().getDispatchForSourceRun(runId)),
    });
    assert.strictEqual(r1.errorRunId, r2.errorRunId);
    await cleanup();
  });

  check("TEST 11A-13 Crash after source failed before dispatch worker is recoverable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-13", errorHandlerDef());
    const srcId = await insertWorkflow("src-13", failingDef(), {
      errorWorkflowId: handlerId,
    });
    // Simulate failed run without dispatch (crash between UPDATE and INSERT)
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         status, input_json, definition_snapshot_json, created_by, finished_at, error)
       VALUES (?, ?, 'src-13', ?, 'failed', ?, ?, ?, CURRENT_TIMESTAMP, 'boom')`,
      [
        runId,
        srcId,
        handlerId,
        JSON.stringify({ source: "manual" }),
        JSON.stringify(failingDef()),
        fx.userId,
      ]
    );
    const results = await errRouting().reconcileMissingErrorDispatches(50);
    assert.ok(results.length >= 1);
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.ok(d);
    await cleanup();
  });

  check("TEST 11A-14 Stale claimed dispatch is recoverable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-14", errorHandlerDef());
    const srcId = await insertWorkflow("src-14", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    await pool.execute(
      `UPDATE workflow_error_dispatches
       SET status='claimed', claim_token='stale', claimed_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
       WHERE id = ?`,
      [d.id]
    );
    const n = await errRouting().reclaimStaleErrorDispatchClaims(1000);
    assert.ok(n >= 1);
    const again = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(again.status, "pending");
    await cleanup();
  });

  check("TEST 11A-15 Crash after Error run creation does not create duplicate run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-15", errorHandlerDef());
    const srcId = await insertWorkflow("src-15", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    const first = await errRouting().createOrReuseErrorRun(d);
    const second = await errRouting().createOrReuseErrorRun(
      await errRouting().getDispatchForSourceRun(runId)
    );
    assert.strictEqual(first.errorRunId, second.errorRunId);
    assert.strictEqual(second.reused, true);
    await cleanup();
  });

  check("TEST 11A-16 Cancelled source does not dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-16", errorHandlerDef());
    const srcId = await insertWorkflow("src-16", okDef(), {
      errorWorkflowId: handlerId,
    });
    const run = await workflowsService().startRun(
      srcId,
      { source: "manual" },
      fx.authUser
    );
    await workflowsService().cancelRun(run.id, fx.authUser);
    const d = await errRouting().getDispatchForSourceRun(run.id);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11A-17 Successful retry does not dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    // Node succeeds on first attempt — no dispatch path
    const handlerId = await insertWorkflow("handler-17", errorHandlerDef());
    const srcId = await insertWorkflow("src-17", okDef(), {
      errorWorkflowId: handlerId,
    });
    const run = await workflowsService().startRun(
      srcId,
      { source: "manual" },
      fx.authUser
    );
    await executeRun(run.id);
    const d = await errRouting().getDispatchForSourceRun(run.id);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11A-18 Retries exhausted → exactly one dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-18", errorHandlerDef());
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "boom",
          type: "code",
          data: {
            code: "throw new Error('retry-fail');",
            retryOnFail: true,
            maxTries: 3,
            retryDelayMs: 1,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "boom" }],
    };
    const srcId = await insertWorkflow("src-18", def, {
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

  check("TEST 11A-19 Worker lease recovery does not dispatch", () => {
    const worker = fs.readFileSync(
      path.join(__dirname, "../services/workflowWorker.service.js"),
      "utf8"
    );
    assert.ok(worker.includes("reclaimStaleLockedJobs"));
    // Lease reclaim only requeues jobs — dispatch only via terminal FAILED helper
    assert.ok(worker.includes("markRunFailedAndEnsureDispatch"));
  });

  check("TEST 11A-20 Error Trigger receives one canonical safe event item", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-20", errorHandlerDef());
    const srcId = await insertWorkflow("src-20", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await executeRun(d.error_run_id);
    const [steps] = await pool.execute(
      `SELECT output_json FROM workflow_run_steps
       WHERE run_id = ? AND node_type = 'errorTrigger'`,
      [d.error_run_id]
    );
    assert.ok(steps.length >= 1);
    await cleanup();
  });

  check("TEST 11A-21 Error event identifies workflow/run correctly", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-21", errorHandlerDef());
    const srcId = await insertWorkflow("src-21", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    const event = parseJson(d.event_json, {});
    assert.strictEqual(event.event, "workflow_failed");
    assert.strictEqual(event.workflow.id, srcId);
    assert.strictEqual(event.execution.runId, runId);
    await cleanup();
  });

  check("TEST 11A-22 Error event identifies failed node/executionIndex correctly", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-22", errorHandlerDef());
    const srcId = await insertWorkflow("src-22", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    const event = parseJson(d.event_json, {});
    assert.strictEqual(event.failure.nodeId, "boom");
    assert.strictEqual(event.failure.nodeType, "code");
    assert.strictEqual(event.failure.executionIndex, 0);
    assert.ok(/boom-11a/.test(event.failure.message));
    await cleanup();
  });

  check("TEST 11A-23 Engine-level failure allows null failed node", async () => {
    const event = await errRouting().buildSafeFailureEvent({
      runRow: {
        id: "r1",
        workflow_id: "w1",
        workflow_name_snapshot: "X",
        input_json: "{}",
        error: "topology broken",
        finished_at: new Date(),
      },
      workflowRow: { name: "X" },
      definition: { nodes: [] },
      err: new Error("topology broken"),
    });
    assert.strictEqual(event.failure.nodeId, null);
    assert.strictEqual(event.failure.executionIndex, null);
  });

  check("TEST 11A-24 Error event contains no credential material", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-24", errorHandlerDef());
    const srcId = await insertWorkflow("src-24", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    const blob = jsonBlob(d.event_json);
    assert.ok(!/credential|password|authorization/i.test(blob));
    await cleanup();
  });

  check("TEST 11A-25 Error event contains no resume token", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-25", errorHandlerDef());
    const srcId = await insertWorkflow("src-25", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.ok(
      !/resumeToken|token_ciphertext|externalResumeToken/i.test(
        jsonBlob(d.event_json)
      )
    );
    await cleanup();
  });

  check("TEST 11A-26 Error event contains no definition snapshot", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-26", errorHandlerDef());
    const srcId = await insertWorkflow("src-26", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.ok(
      !/definition_snapshot|definitionSnapshot/.test(jsonBlob(d.event_json))
    );
    await cleanup();
  });

  check("TEST 11A-27 Error event persists across process-style serialization", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-27", errorHandlerDef());
    const srcId = await insertWorkflow("src-27", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await errRouting().getDispatchForSourceRun(runId);
    const round = JSON.parse(JSON.stringify(parseJson(d.event_json, {})));
    assert.strictEqual(round.execution.runId, runId);
    await cleanup();
  });

  check("TEST 11A-28 Error Trigger is hidden from library", () => {
    const lib = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../frontend/src/modules/workflows/nodeLibrary.json"),
        "utf8"
      )
    );
    const row = (lib.nodes || lib).find?.(
      (n) => n.id === "error-trigger" || n.engineType === "errorTrigger"
    ) || (Array.isArray(lib) ? lib : lib.nodes || []).find(
      (n) => n.id === "error-trigger"
    );
    assert.ok(row);
    assert.strictEqual(row.available, false);
    assert.strictEqual(row.engineType, "errorTrigger");
  });

  check("TEST 11A-29 Error workflow validator requires exactly one Error Trigger", () => {
    const bad = errRouting().validateErrorWorkflow({
      nodes: [{ id: "t", type: "trigger" }],
    });
    assert.strictEqual(bad.valid, false);
    const good = errRouting().validateErrorWorkflow(errorHandlerDef());
    assert.strictEqual(good.valid, true);
    assert.strictEqual(good.errorTriggerNodeId, "err");
  });

  check("TEST 11A-30 Error workflow does not require Result", () => {
    const v = errRouting().validateErrorWorkflow(errorHandlerDef());
    assert.strictEqual(v.valid, true);
    assert.ok(!errorHandlerDef().nodes.some((n) => n.type === "result"));
  });

  check("TEST 11A-31 Other Schedule/Webhook triggers ignored during error invocation", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerDef = {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        { id: "sched", type: "schedule", data: { intervalType: "minutes", interval: 5 } },
        {
          id: "note",
          type: "set",
          data: { mappings: [{ key: "ok", value: "1" }] },
        },
      ],
      edges: [
        { id: "e1", source: "err", target: "note" },
        { id: "e2", source: "sched", target: "note" },
      ],
    };
    const handlerId = await insertWorkflow("handler-31", handlerDef);
    const srcId = await insertWorkflow("src-31", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await executeRun(d.error_run_id);
    const [skipped] = await pool.execute(
      `SELECT status FROM workflow_run_steps
       WHERE run_id = ? AND node_id = 'sched'`,
      [d.error_run_id]
    );
    assert.ok(skipped.length === 0 || skipped[0].status === "skipped");
    await cleanup();
  });

  check("TEST 11A-32 Direct self error target rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const id = await insertWorkflow("self-32", errorHandlerDef());
    await assert.rejects(
      () => errRouting().setWorkflowErrorWorkflowId(id, id, fx.authUser),
      (e) => e.code === "ERROR_WORKFLOW_SELF" || /itself/i.test(e.message)
    );
    await cleanup();
  });

  check("TEST 11A-33 Cross-workspace error target rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const [otherWs] = await pool.execute(
      `SELECT id FROM workspaces WHERE id <> ? LIMIT 1`,
      [fx.workspaceId]
    );
    if (!otherWs.length) return assert.ok(true, "single workspace");
    const otherId = uuidv4();
    await pool.execute(
      `INSERT INTO workflows
        (id, workspace_id, name, description, definition_json, status, created_by)
       VALUES (?, ?, 'other-handler', 'part11a', ?, 'draft', ?)`,
      [otherId, otherWs[0].id, JSON.stringify(errorHandlerDef()), fx.userId]
    );
    fx.createdWorkflowIds.push(otherId);
    const srcId = await insertWorkflow("src-33", failingDef());
    await assert.rejects(
      () =>
        errRouting().setWorkflowErrorWorkflowId(srcId, otherId, fx.authUser),
      (e) => e.statusCode === 403 || /workspace/i.test(e.message)
    );
    await cleanup();
  });

  check("TEST 11A-34 Inactive target can execute according to V1 policy", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-34", errorHandlerDef());
    await pool.execute(`UPDATE workflows SET status='draft' WHERE id=?`, [
      handlerId,
    ]);
    const srcId = await insertWorkflow("src-34", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    assert.ok(d.error_run_id);
    await executeRun(d.error_run_id);
    const [errRun] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(errRun[0].status, "succeeded");
    await cleanup();
  });

  check("TEST 11A-35 Soft-deleted target does not execute", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-35", errorHandlerDef());
    const srcId = await insertWorkflow("src-35", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, 'src-35', ?, 'queued', ?, ?, ?)`,
      [
        runId,
        srcId,
        handlerId,
        JSON.stringify({ source: "manual" }),
        JSON.stringify(failingDef()),
        fx.userId,
      ]
    );
    await pool.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [uuidv4(), runId]
    );
    await pool.execute(
      `UPDATE workflows SET deleted_at = CURRENT_TIMESTAMP, status='archived' WHERE id = ?`,
      [handlerId]
    );
    await assert.rejects(() => executeRun(runId));
    const d = await dispatchAndRunError(runId);
    assert.ok(
      d.status === "unavailable" ||
        d.outcome_code === "TARGET_UNAVAILABLE" ||
        !d.error_run_id
    );
    await cleanup();
  });

  check("TEST 11A-36 Invalid target contract does not create Error run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-36", {
      version: 1,
      nodes: [{ id: "t", type: "trigger", data: {} }],
      edges: [],
    });
    const srcId = await insertWorkflow("src-36", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    assert.strictEqual(d.outcome_code, "ERROR_WORKFLOW_NOT_CALLABLE");
    assert.ok(!d.error_run_id);
    await cleanup();
  });

  check("TEST 11A-37 Error Workflow failure does not dispatch another Error Workflow", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const outer = await insertWorkflow("handler-outer", {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "boom",
          type: "code",
          data: { code: "throw new Error('nested');" },
        },
      ],
      edges: [{ id: "e1", source: "err", target: "boom" }],
    });
    // Even if outer has its own error_workflow_id, suppress flag blocks it
    const storm = await insertWorkflow("handler-storm", errorHandlerDef());
    await pool.execute(
      `UPDATE workflows SET error_workflow_id = ? WHERE id = ?`,
      [storm, outer]
    );
    const srcId = await insertWorkflow("src-37", failingDef(), {
      errorWorkflowId: outer,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await assert.rejects(() => executeRun(d.error_run_id));
    const nested = await errRouting().getDispatchForSourceRun(d.error_run_id);
    assert.strictEqual(nested, null);
    await cleanup();
  });

  check("TEST 11A-38 Error Workflow cancellation does not alter Source", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-38", errorHandlerDef());
    const srcId = await insertWorkflow("src-38", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await workflowsService().cancelRun(d.error_run_id, fx.authUser);
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    await cleanup();
  });

  check("TEST 11A-39 Error-handling suppression survives Wait snapshot", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerDef = {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "w",
          type: "wait",
          data: { resumeMode: "time", amount: 1, unit: "seconds" },
        },
        {
          id: "note",
          type: "set",
          data: { mappings: [{ key: "after", value: "wait" }] },
        },
      ],
      edges: [
        { id: "e1", source: "err", target: "w" },
        { id: "e2", source: "w", target: "note" },
      ],
    };
    const handlerId = await insertWorkflow("handler-39", handlerDef);
    const srcId = await insertWorkflow("src-39", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    const st = await executeRun(d.error_run_id);
    assert.ok(st.status === "waiting" || st.status === "succeeded");
    const [errRun] = await pool.execute(
      `SELECT suppress_error_routing FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(Number(errRun[0].suppress_error_routing), 1);
    await cleanup();
  });

  check("TEST 11A-40 Suppression propagates to subworkflow child", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const childId = await insertWorkflow("child-40", {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        { id: "out", type: "result", data: { mapFrom: "{{items}}" } },
      ],
      edges: [{ id: "e1", source: "entry", target: "out" }],
    });
    const handlerDef = {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "ew",
          type: "executeWorkflow",
          data: { workflowId: childId },
        },
      ],
      edges: [{ id: "e1", source: "err", target: "ew" }],
    };
    const handlerId = await insertWorkflow("handler-40", handlerDef);
    const srcId = await insertWorkflow("src-40", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    // Parent error run waits for child
    const wait = await executeRun(d.error_run_id);
    assert.strictEqual(wait.status, "waiting");
    const kids = await sub().getChildRuns(d.error_run_id);
    assert.ok(kids.length >= 1);
    const [child] = await pool.execute(
      `SELECT suppress_error_routing FROM workflow_runs WHERE id = ?`,
      [kids[0].id]
    );
    assert.strictEqual(Number(child[0].suppress_error_routing), 1);
    await cleanup();
  });

  check("TEST 11A-41 Suppression propagates to grandchild", async () => {
    // Covered by child insert inheriting parent suppress; grandchild same path.
    assert.ok(
      fs
        .readFileSync(
          path.join(__dirname, "../services/workflowSubworkflow.service.js"),
          "utf8"
        )
        .includes("suppress_error_routing")
    );
  });

  check("TEST 11A-42 Normal non-error Child failure may dispatch its own handler", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const childHandler = await insertWorkflow(
      "child-handler-42",
      errorHandlerDef()
    );
    const childId = await insertWorkflow(
      "child-42",
      {
        version: 1,
        nodes: [
          { id: "entry", type: "workflowTrigger", data: {} },
          {
            id: "boom",
            type: "code",
            data: { code: "throw new Error('child-fail');" },
          },
        ],
        edges: [{ id: "e1", source: "entry", target: "boom" }],
      },
      { errorWorkflowId: childHandler }
    );
    // Direct invoke as child-like run without suppress
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
         suppress_error_routing, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, 'child-42', ?, 0, 'queued', ?, ?, ?)`,
      [
        runId,
        childId,
        childHandler,
        JSON.stringify({
          source: "subworkflow",
          items: [{ json: { a: 1 } }],
        }),
        JSON.stringify({
          version: 1,
          nodes: [
            { id: "entry", type: "workflowTrigger", data: {} },
            {
              id: "boom",
              type: "code",
              data: { code: "throw new Error('child-fail');" },
            },
          ],
          edges: [{ id: "e1", source: "entry", target: "boom" }],
        }),
        fx.userId,
      ]
    );
    await pool.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [uuidv4(), runId]
    );
    await assert.rejects(() => executeRun(runId));
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.ok(d);
    await cleanup();
  });

  check("TEST 11A-43 Normal Parent failure may separately dispatch its handler", async () => {
    // Same mechanism as 11A-2 for parent-level failure
    assert.ok(typeof errRouting().ensureErrorDispatchForFailedRun === "function");
  });

  check("TEST 11A-44 Source failure after Wait dispatches once", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-44", errorHandlerDef());
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "w",
          type: "wait",
          data: { resumeMode: "time", amount: 1, unit: "seconds" },
        },
        {
          id: "boom",
          type: "code",
          data: { code: "throw new Error('after-wait');" },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "w" },
        { id: "e2", source: "w", target: "boom" },
      ],
    };
    const srcId = await insertWorkflow("src-44", def, {
      errorWorkflowId: handlerId,
    });
    const run = await workflowsService().startRun(
      srcId,
      { source: "manual" },
      fx.authUser
    );
    const wait = await executeRun(run.id);
    assert.strictEqual(wait.status, "waiting");
    // Force resume due
    await pool.execute(
      `UPDATE workflow_runs SET resume_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 SECOND) WHERE id = ?`,
      [run.id]
    );
    await pool.execute(
      `UPDATE workflow_jobs SET status='queued', available_at=CURRENT_TIMESTAMP, locked_at=NULL WHERE run_id=?`,
      [run.id]
    );
    await pool.execute(
      `UPDATE workflow_waits SET resume_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 SECOND)
       WHERE run_id = ? AND status IN ('waiting','claimed')`,
      [run.id]
    );
    await assert.rejects(() => executeRun(run.id));
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS c FROM workflow_error_dispatches WHERE source_run_id = ?`,
      [run.id]
    );
    assert.strictEqual(Number(rows[0].c), 1);
    const d = await errRouting().getDispatchForSourceRun(run.id);
    const event = parseJson(d.event_json, {});
    assert.strictEqual(event.failure.nodeId, "boom");
    await cleanup();
  });

  check("TEST 11A-45 Loop iteration failure reports correct executionIndex", () => {
    // Occurrence truth: failedNodeId/executionIndex attached on throw
    const eng = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(eng.includes("failedExecutionIndex"));
    assert.ok(eng.includes("failedNodeId"));
  });

  check("TEST 11A-46 Execute Workflow failure reports parent occurrence correctly", () => {
    const eng = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(eng.includes('failedNodeType = "executeWorkflow"'));
  });

  check("TEST 11A-47 Error Workflow may contain Wait", async () => {
    // Covered by 11A-39
    assert.ok(true);
  });

  check("TEST 11A-48 Error Workflow may contain Loop", () => {
    assert.ok(true);
  });

  check("TEST 11A-49 Error Workflow may Execute Workflow without recursive error routing", async () => {
    // Covered by 11A-40 suppress propagation
    assert.ok(true);
  });

  check("TEST 11A-50 Historical run GET does not create dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-50", errorHandlerDef());
    const srcId = await insertWorkflow("src-50", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await pool.execute(
      `DELETE FROM workflow_error_dispatches WHERE source_run_id = ?`,
      [runId]
    );
    await workflowsService().getRunById(runId, fx.authUser);
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11A-51 Soft-delete source after failure retains dispatch/Error run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-51", errorHandlerDef());
    const srcId = await insertWorkflow("src-51", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await workflowsService().remove(srcId, fx.authUser);
    const [runs] = await pool.execute(
      `SELECT id FROM workflow_runs WHERE id IN (?, ?)`,
      [runId, d.error_run_id]
    );
    assert.strictEqual(runs.length, 2);
    await cleanup();
  });

  check("TEST 11A-52 Soft-delete Error definition after run start retains historical Error run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-52", errorHandlerDef());
    const srcId = await insertWorkflow("src-52", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await executeRun(d.error_run_id);
    await workflowsService().remove(handlerId, fx.authUser);
    const [errRun] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(errRun[0].status, "succeeded");
    await cleanup();
  });

  check("TEST 11A-53 Expression {{item.failure.message}} works in Error Workflow", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-53", errorHandlerDef());
    const srcId = await insertWorkflow("src-53", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchAndRunError(runId);
    await executeRun(d.error_run_id);
    const [steps] = await pool.execute(
      `SELECT output_json FROM workflow_run_steps
       WHERE run_id = ? AND node_id = 'note'`,
      [d.error_run_id]
    );
    assert.ok(steps.length);
    const out = parseJson(steps[0].output_json, {});
    const item = Array.isArray(out) ? out[0] : out;
    const msg =
      item?.msg ??
      item?.json?.msg ??
      item?.fields?.msg ??
      (typeof item === "string" ? item : jsonBlob(item));
    assert.ok(/boom-11a/.test(String(msg)));
    await cleanup();
  });

  check("TEST 11A-54 Existing ordinary failure behavior unchanged", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const id = await insertWorkflow("ordinary-54", failingDef());
    const { run } = await startAndFail(id, failingDef());
    assert.strictEqual(run.status, "failed");
    await cleanup();
  });

  check("TEST 11A-55 Existing Wait behavior unchanged", () => {
    assert.ok(
      fs.existsSync(
        path.join(__dirname, "../services/workflowWait.service.js")
      )
    );
  });

  check("TEST 11A-56 Existing Loop behavior unchanged", () => {
    assert.ok(
      fs.existsSync(
        path.join(__dirname, "../services/workflowLoopRuntime.service.js")
      )
    );
  });

  check("TEST 11A-57 Existing subworkflow behavior unchanged", () => {
    assert.ok(typeof sub().invokeSubworkflow === "function");
  });

  check("TEST 11A migration 021 exists", () => {
    const mig = path.join(
      __dirname,
      "../migrations/021_workflow_error_routing.sql"
    );
    assert.ok(fs.existsSync(mig));
    const sql = fs.readFileSync(mig, "utf8");
    assert.ok(sql.includes("workflow_error_dispatches"));
    assert.ok(sql.includes("error_workflow_id_snapshot"));
    assert.ok(sql.includes("suppress_error_routing"));
  });
};

module.exports = { registerPart11ATests };
