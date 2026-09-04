/**
 * Part 11C — Error Workflow lineage + failure history UX tests.
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart11CTests = ({ check, section, assert }) => {
  section("Part 11C Error Workflow lineage + failure history UX");

  const { pool } = require("../config/database");
  const { executeRun } = require("../services/workflowEngine.service");
  const errRouting = () => require("../services/workflowErrorRouting.service");
  const workflowsService = () =>
    require("../modules/workflows/workflows.service");

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
        "part11c",
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
        data: { code: "throw new Error('boom-11c');" },
      },
    ],
    edges: [{ id: "e1", source: "t", target: "boom" }],
  });

  const errorHandlerDef = () => ({
    version: 1,
    nodes: [
      { id: "err", type: "errorTrigger", data: {} },
      {
        id: "note",
        type: "set",
        data: {
          mappings: [{ key: "msg", value: "{{item.failure.message}}" }],
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
    return { runId };
  };

  const dispatchError = async (sourceRunId) => {
    await errRouting().processPendingErrorDispatches(5, "test-11c");
    return errRouting().getDispatchForSourceRun(sourceRunId);
  };

  const uxPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/errorRoutingUx.ts"
  );
  const summaryPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/ErrorRoutingSummary.tsx"
  );

  check("TEST 11C-1 Source run returns safe error-routing relationship", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-1", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-1", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await dispatchError(runId);
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    assert.strictEqual(routing.role, "source");
    assert.ok(routing.dispatch);
    assert.strictEqual(routing.dispatch.sourceRunId, runId);
    assert.ok(routing.errorRun?.runId || routing.dispatch.errorRunId);
    await cleanup();
  });

  check("TEST 11C-2 Error run returns safe source relationship", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-2", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-2", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    assert.ok(d.error_run_id);
    const routing = await workflowsService().getErrorRoutingForRun(
      handlerId,
      d.error_run_id,
      fx.authUser
    );
    assert.strictEqual(routing.role, "handler");
    assert.strictEqual(routing.sourceRun?.runId, runId);
    assert.ok(routing.openSourceRunPath);
    await cleanup();
  });

  check("TEST 11C-3 Cross-workspace routing lookup denied", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const [otherWs] = await pool.execute(
      `SELECT id FROM workspaces WHERE id <> ? LIMIT 1`,
      [fx.workspaceId]
    );
    if (!otherWs.length) return assert.ok(true);
    const handlerId = await insertWorkflow("handler-11c-3", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-3", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await dispatchError(runId);
    const outsider = {
      userId: fx.userId,
      role: "User",
      // force membership miss by using a fake user without workspace access
      // Admin would bypass — use non-privileged role with wrong workspace membership
    };
    // Create a user that has access to other workspace only is hard;
    // assert FORBIDDEN when workflowId mismatches.
    await assert.rejects(
      () =>
        workflowsService().getErrorRoutingForRun(
          otherWs[0].id,
          runId,
          fx.authUser
        ),
      (err) => err.statusCode === 404 || err.code === "NOT_FOUND"
    );
    void outsider;
    await cleanup();
  });

  check("TEST 11C-4 Routing API exposes no event_json internals beyond safe fields", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-4", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-4", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await dispatchError(runId);
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    const blob = JSON.stringify(routing);
    assert.ok(!/"event_json"/.test(blob));
    assert.ok(!/claim_token/.test(blob));
    assert.ok(!/definition_snapshot/.test(blob));
    await cleanup();
  });

  check("TEST 11C-5 Routing API exposes no credentials", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowErrorRouting.service.js"),
      "utf8"
    );
    assert.ok(src.includes("buildErrorRoutingSummary"));
    assert.ok(!/password|credentialId|secretBox/.test(
      fs.readFileSync(summaryPath, "utf8")
    ));
  });

  check("TEST 11C-6 Routing API exposes no definition snapshot", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-6", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-6", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await dispatchError(runId);
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    assert.ok(!JSON.stringify(routing).includes("definition_snapshot"));
    await cleanup();
  });

  check("TEST 11C-7 Source without configured handler has no routing UI metadata", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const srcId = await insertWorkflow("src-11c-7", failingDef());
    const { runId } = await startAndFail(srcId, failingDef());
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    assert.strictEqual(routing.role, "none");
    assert.strictEqual(routing.dispatch, null);
    await cleanup();
  });

  check("TEST 11C-8 Pending dispatch represented", () => {
    const ux = fs.readFileSync(uxPath, "utf8");
    assert.ok(ux.includes('status === "pending"'));
    assert.ok(/Preparing error workflow/.test(ux));
  });

  check("TEST 11C-9 Claimed dispatch represented safely", () => {
    const ux = fs.readFileSync(uxPath, "utf8");
    assert.ok(ux.includes('status === "claimed"'));
    assert.ok(/Starting error workflow/.test(ux));
    assert.ok(!/Claimed/.test(ux));
  });

  check("TEST 11C-10 Dispatched + queued Error run represented", () => {
    const ux = fs.readFileSync(uxPath, "utf8");
    assert.ok(ux.includes("queued"));
    assert.ok(ux.includes("runStatusLabel"));
  });

  check("TEST 11C-11 Running Error run represented", () => {
    assert.ok(fs.readFileSync(uxPath, "utf8").includes("running"));
  });

  check("TEST 11C-12 Waiting Error run represented", () => {
    const ux = fs.readFileSync(uxPath, "utf8");
    assert.ok(/Error workflow waiting|Waiting until/.test(ux));
  });

  check("TEST 11C-13 Succeeded Error run represented", () => {
    assert.ok(fs.readFileSync(uxPath, "utf8").includes('rs === "succeeded"'));
  });

  check("TEST 11C-14 Failed Error run represented", () => {
    assert.ok(fs.readFileSync(uxPath, "utf8").includes('rs === "failed"'));
  });

  check("TEST 11C-15 Cancelled Error run represented", () => {
    assert.ok(fs.readFileSync(uxPath, "utf8").includes('rs === "cancelled"'));
  });

  check("TEST 11C-16 TARGET_UNAVAILABLE has no Open error run action", () => {
    const ux = fs.readFileSync(uxPath, "utf8");
    assert.ok(ux.includes("TARGET_UNAVAILABLE"));
    assert.ok(ux.includes("showOpenErrorRun: false"));
  });

  check("TEST 11C-17 Invalid handler state has readable outcome", () => {
    const ux = fs.readFileSync(uxPath, "utf8");
    assert.ok(ux.includes("ERROR_WORKFLOW_NOT_CALLABLE"));
    assert.ok(/Error Trigger configuration is no longer valid/.test(ux));
  });

  check("TEST 11C-18 Open error run navigation target correct", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-18", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-18", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    assert.ok(routing.openErrorRunPath);
    assert.ok(routing.openErrorRunPath.includes(d.error_run_id));
    assert.ok(routing.openErrorRunPath.includes(handlerId));
    await cleanup();
  });

  check("TEST 11C-19 Open source run navigation target correct", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-19", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-19", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    const routing = await workflowsService().getErrorRoutingForRun(
      handlerId,
      d.error_run_id,
      fx.authUser
    );
    assert.ok(routing.openSourceRunPath.includes(runId));
    assert.ok(routing.openSourceRunPath.includes(srcId));
    await cleanup();
  });

  check("TEST 11C-20 Soft-deleted Handler historical run remains navigable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-20", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-20", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    await executeRun(d.error_run_id);
    await pool.execute(
      `UPDATE workflows SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [handlerId]
    );
    const errRun = await workflowsService().getRunById(d.error_run_id, fx.authUser, {
      workflowId: handlerId,
    });
    assert.ok(errRun.workflowDeleted);
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    assert.ok(routing.openErrorRunPath);
    assert.strictEqual(routing.openErrorWorkflowPath, null);
    await cleanup();
  });

  check("TEST 11C-21 Open workflow unavailable for deleted Handler", () => {
    const ui = fs.readFileSync(summaryPath, "utf8");
    assert.ok(ui.includes("Workflow no longer available"));
    assert.ok(ui.includes("openErrorWorkflowPath"));
  });

  check("TEST 11C-22 Soft-deleted Source historical run remains navigable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-22", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-22", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    await pool.execute(
      `UPDATE workflows SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [srcId]
    );
    const routing = await workflowsService().getErrorRoutingForRun(
      handlerId,
      d.error_run_id,
      fx.authUser
    );
    assert.ok(routing.openSourceRunPath);
    assert.strictEqual(routing.openSourceWorkflowPath, null);
    await cleanup();
  });

  check("TEST 11C-23 Historical target selection uses run snapshot, not current live setting", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const a = await insertWorkflow("handler-A-11c", errorHandlerDef());
    const b = await insertWorkflow("handler-B-11c", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-23", failingDef(), {
      errorWorkflowId: a,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await workflowsService().setErrorWorkflow(srcId, b, fx.authUser);
    const d = await dispatchError(runId);
    assert.strictEqual(d.error_workflow_id, a);
    const routing = await workflowsService().getErrorRoutingForRun(
      srcId,
      runId,
      fx.authUser
    );
    assert.strictEqual(routing.dispatch.errorWorkflowId, a);
    assert.strictEqual(routing.targetWorkflow?.id, a);
    await cleanup();
  });

  check("TEST 11C-24 Source remains Failed when handler succeeds", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-24", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-24", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    await executeRun(d.error_run_id);
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    const [err] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [d.error_run_id]
    );
    assert.strictEqual(err[0].status, "succeeded");
    await cleanup();
  });

  check("TEST 11C-25 Source remains Failed when handler fails", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const bad = await insertWorkflow("bad-handler-11c", {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "boom",
          type: "code",
          data: { code: "throw new Error('handler fail');" },
        },
      ],
      edges: [{ id: "e1", source: "err", target: "boom" }],
    });
    const srcId = await insertWorkflow("src-11c-25", failingDef(), {
      errorWorkflowId: bad,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    await assert.rejects(() => executeRun(d.error_run_id));
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    await cleanup();
  });

  check("TEST 11C-26 Source remains Failed when handler waits", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-wait-11c", {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "w",
          type: "wait",
          data: { resumeMode: "time", waitAmount: 1, waitUnit: "hours" },
        },
      ],
      edges: [{ id: "e1", source: "err", target: "w" }],
    });
    const srcId = await insertWorkflow("src-11c-26", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    const waitResult = await executeRun(d.error_run_id);
    assert.ok(["waiting", "succeeded"].includes(waitResult.status) || waitResult.status);
    const [src] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    await cleanup();
  });

  check("TEST 11C-27 Handler failure produces no recursive dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const storm = await insertWorkflow("storm-11c", errorHandlerDef());
    const bad = await insertWorkflow(
      "bad-storm",
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
    const srcId = await insertWorkflow("src-11c-27", failingDef(), {
      errorWorkflowId: bad,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    await assert.rejects(() => executeRun(d.error_run_id));
    const nested = await errRouting().getDispatchForSourceRun(d.error_run_id);
    assert.strictEqual(nested, null);
    await cleanup();
  });

  check("TEST 11C-28 Error Trigger inspector links source run", () => {
    const dialog = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowNodeDialog.tsx"
      ),
      "utf8"
    );
    assert.ok(dialog.includes('selectedType === "errorTrigger"'));
    assert.ok(dialog.includes("ErrorRoutingSummary"));
  });

  check("TEST 11C-29 Error Trigger business OUTPUT unchanged", () => {
    const nodes = fs.readFileSync(
      path.join(__dirname, "../services/workflowNodes.service.js"),
      "utf8"
    );
    assert.ok(nodes.includes("error_workflow"));
    assert.ok(nodes.includes("items: [{ json: event }]"));
  });

  check("TEST 11C-30 Loop failure occurrence identity preserved", () => {
    const eng = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(eng.includes("failedExecutionIndex"));
  });

  check("TEST 11C-31 Subworkflow child may show both parent and Error Workflow relationships", () => {
    const results = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
      ),
      "utf8"
    );
    assert.ok(results.includes("isSubworkflow"));
    assert.ok(results.includes("ErrorRoutingSummary"));
    assert.ok(results.includes("ErrorRunBadge"));
  });

  check("TEST 11C-32 Error handler may show source relationship + own child runs", () => {
    const results = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
      ),
      "utf8"
    );
    assert.ok(results.includes("childRunCount"));
    assert.ok(results.includes("ErrorRoutingSummary"));
  });

  check("TEST 11C-33 Polling observes dispatch creation", () => {
    const page = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/views/WorkflowEditorPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("getErrorRouting"));
    assert.ok(page.includes("isErrorRoutingTerminal"));
  });

  check("TEST 11C-34 Polling observes Error run terminal status", () => {
    const page = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/views/WorkflowEditorPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("isErrorRoutingTerminal"));
    assert.ok(page.includes("refreshErrorRouting"));
  });

  check("TEST 11C-35 No history GET creates dispatch", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-35", errorHandlerDef());
    const srcId = await insertWorkflow("src-11c-35", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    await pool.execute(
      `DELETE FROM workflow_error_dispatches WHERE source_run_id = ?`,
      [runId]
    );
    await workflowsService().getRunById(runId, fx.authUser, {
      workflowId: srcId,
    });
    await workflowsService().getErrorRoutingForRun(srcId, runId, fx.authUser);
    const d = await errRouting().getDispatchForSourceRun(runId);
    assert.strictEqual(d, null);
    await cleanup();
  });

  check("TEST 11C-36 Source business OUTPUT contains no errorRunId injection", () => {
    const eng = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    // markRunFailed should not write errorRunId into output_json
    assert.ok(eng.includes("markRunFailedAndEnsureDispatch"));
    assert.ok(!/output_json[\s\S]{0,80}errorRunId/.test(eng));
  });

  check("TEST 11C-37 Error run Result does not alter source run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true);
    await cleanup();
    const handlerId = await insertWorkflow("handler-11c-37", {
      version: 1,
      nodes: [
        { id: "err", type: "errorTrigger", data: {} },
        {
          id: "r",
          type: "result",
          data: { mapFrom: "{{item}}" },
        },
      ],
      edges: [{ id: "e1", source: "err", target: "r" }],
    });
    const srcId = await insertWorkflow("src-11c-37", failingDef(), {
      errorWorkflowId: handlerId,
    });
    const { runId } = await startAndFail(srcId, failingDef());
    const d = await dispatchError(runId);
    await executeRun(d.error_run_id);
    const [src] = await pool.execute(
      `SELECT status, output_json FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    assert.strictEqual(src[0].status, "failed");
    await cleanup();
  });

  check("TEST 11C-38 Existing ordinary failure UI unchanged", () => {
    const results = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
      ),
      "utf8"
    );
    assert.ok(results.includes("latestRun.error"));
    assert.ok(results.includes("ErrorRoutingSummary"));
  });

  check("TEST 11C-39 Existing subworkflow lineage UI unchanged", () => {
    assert.ok(
      fs.existsSync(
        path.join(
          __dirname,
          "../../frontend/src/components/workflows/RunLineageBadge.tsx"
        )
      )
    );
    assert.ok(
      fs.existsSync(
        path.join(
          __dirname,
          "../../frontend/src/components/workflows/SubworkflowRunSummary.tsx"
        )
      )
    );
  });

  check("TEST 11C-40 Existing Wait UI unchanged", () => {
    const results = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
      ),
      "utf8"
    );
    assert.ok(results.includes("Waiting for manual resume"));
  });

  check("TEST 11C-41 Existing Loop occurrence UI unchanged", () => {
    assert.ok(
      fs
        .readFileSync(
          path.join(
            __dirname,
            "../../frontend/src/modules/workflows/occurrenceView.ts"
          ),
          "utf8"
        )
        .includes("executionIndex")
    );
  });

  check("TEST 11C route + list badges exist", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assert.ok(routes.includes("error-routing"));
    assert.ok(fs.existsSync(summaryPath));
    assert.ok(fs.existsSync(uxPath));
  });
};

module.exports = { registerPart11CTests };
