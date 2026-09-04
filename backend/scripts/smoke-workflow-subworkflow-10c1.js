/**
 * Part 10C.1 — Historical subworkflow run retention after live definition delete.
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart10C1Tests = ({ check, section, assert }) => {
  section("Part 10C.1 Historical subworkflow run retention");

  const workflowsService = () =>
    require("../modules/workflows/workflows.service");
  const sub = () => require("../services/workflowSubworkflow.service");
  const { pool } = require("../config/database");
  const { executeRun } = require("../services/workflowEngine.service");

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

  const insertWorkflow = async (name, definition) => {
    const fx = await ensureFixtures();
    if (fx.skip) return null;
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO workflows
        (id, workspace_id, name, description, definition_json, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
      [id, fx.workspaceId, name, "part10c1", JSON.stringify(definition), fx.userId]
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

  const callableChild = () => ({
    version: 1,
    nodes: [
      { id: "entry", type: "workflowTrigger", data: {} },
      {
        id: "pass",
        type: "set",
        data: { mappings: [{ key: "processed", value: "true" }] },
      },
      { id: "out", type: "result", data: { mapFrom: "{{items}}" } },
    ],
    edges: [
      { id: "e1", source: "entry", target: "pass" },
      { id: "e2", source: "pass", target: "out" },
    ],
  });

  const parentWithExecute = (childId) => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", data: {} },
      {
        id: "ew",
        type: "executeWorkflow",
        data: { workflowId: childId },
      },
      { id: "out", type: "result", data: { mapFrom: "{{items}}" } },
    ],
    edges: [
      { id: "e1", source: "t", target: "ew" },
      { id: "e2", source: "ew", target: "out" },
    ],
  });

  /**
   * Stable parent→child fixture (same pattern as Part 10C): invoke + execute child.
   */
  const runParentChild = async (childName = "child-10c1") => {
    const fx = await ensureFixtures();
    const childId = await insertWorkflow(childName, callableChild());
    const parentDef = parentWithExecute(childId);
    const parentId = await insertWorkflow("parent-10c1", parentDef);
    const parentRunId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, root_run_id, status,
         input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?)`,
      [
        parentRunId,
        parentId,
        "parent-10c1",
        parentRunId,
        JSON.stringify({ source: "manual" }),
        JSON.stringify(parentDef),
        fx.userId,
      ]
    );
    await pool.execute(
      `UPDATE workflow_runs
       SET waiting_reason = 'child_run', waiting_node_id = 'ew'
       WHERE id = ?`,
      [parentRunId]
    );
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status, output_json)
       VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'waiting', ?)`,
      [
        stepId,
        parentRunId,
        JSON.stringify({ waiting: true, waitingReason: "child_run" }),
      ]
    );
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "ew",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childId,
      inputItems: [{ json: { n: 1 } }],
      parentSnapshot: sub().buildChildWaitSnapshot({
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childRunId: null,
        waitInputItems: [{ json: { n: 1 } }],
        context: {
          input: {},
          steps: {},
          items: {},
          portOutputs: {},
          runData: { resultData: { runData: {} } },
        },
        scheduler: {
          edgeState: [],
          nodeState: [],
          loopCounts: [],
          closedLoops: [],
        },
        finalOutput: null,
        runErrors: [],
      }),
      authUser: fx.authUser,
    });
    const childRunId = inv.childRunId;
    await pool.execute(
      `UPDATE workflow_jobs
       SET status = 'queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = CURRENT_TIMESTAMP
       WHERE run_id = ?`,
      [childRunId]
    );
    let childStatus;
    try {
      childStatus = await executeRun(childRunId);
    } catch (err) {
      childStatus = { status: "error", error: String(err.message || err) };
    }
    if (childStatus.status !== "succeeded") {
      for (let i = 0; i < 25; i += 1) {
        const [rows] = await pool.execute(
          `SELECT status, error FROM workflow_runs WHERE id = ?`,
          [childRunId]
        );
        if (rows[0]?.status === "succeeded") {
          childStatus = { status: "succeeded" };
          break;
        }
        if (["failed", "cancelled"].includes(rows[0]?.status)) {
          assert.fail(
            `child ${childRunId} ${rows[0].status}: ${rows[0].error || childStatus.error || ""}`
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.strictEqual(
      childStatus.status,
      "succeeded",
      childStatus.error || `child ${childRunId} did not succeed`
    );
    // Apply child result onto parent Execute Workflow step (durable output).
    const result = await sub().getSubworkflowResult(childRunId);
    assert.strictEqual(result.status, "succeeded");
    await pool.execute(
      `UPDATE workflow_run_steps
       SET status = 'succeeded',
           output_json = ?,
           finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        JSON.stringify({
          items: result.items,
          childRunId,
          waiting: false,
        }),
        stepId,
      ]
    );
    // Parent may still be waiting on child_run — mark terminal so soft-delete
    // of the live definition is allowed (V1 blocks delete while active).
    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'succeeded',
           waiting_reason = NULL,
           waiting_node_id = NULL,
           resume_at = NULL,
           finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [parentRunId]
    );
    const parent = await workflowsService().getRunById(parentRunId, fx.authUser);
    const child = await workflowsService().getRunById(childRunId, fx.authUser);
    return {
      fx,
      parentId,
      childId,
      parentRunId,
      childRunId,
      parent,
      child,
      result,
    };
  };

  check("TEST 10C.1-1 Deleting live child does not delete completed child run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("keep-child-run");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const [rows] = await pool.execute(
      `SELECT id, status FROM workflow_runs WHERE id = ?`,
      [ctx.childRunId]
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, "succeeded");
    await cleanup();
  });

  check("TEST 10C.1-2 Child run steps remain", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("keep-steps");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const run = await workflowsService().getRunById(ctx.childRunId, fx.authUser, {
      workflowId: ctx.childId,
    });
    assert.ok(run.steps && run.steps.length >= 2);
    await cleanup();
  });

  check("TEST 10C.1-3 Parent→child lineage remains", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("lin-pc");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const lin = await workflowsService().getRunLineage(
      ctx.parentId,
      ctx.parentRunId,
      fx.authUser
    );
    assert.ok(lin.children.some((c) => c.runId === ctx.childRunId));
    assert.strictEqual(
      lin.children.find((c) => c.runId === ctx.childRunId).workflowDeleted,
      true
    );
    await cleanup();
  });

  check("TEST 10C.1-4 Child→parent lineage remains", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("lin-cp");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const lin = await workflowsService().getRunLineage(
      ctx.childId,
      ctx.childRunId,
      fx.authUser
    );
    assert.ok(lin.ancestors.some((a) => a.runId === ctx.parentRunId));
    assert.strictEqual(lin.run.workflowDeleted, true);
    await cleanup();
  });

  check("TEST 10C.1-5 rootRunId lineage remains", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("root-lin");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const lin = await workflowsService().getRunLineage(
      ctx.childId,
      ctx.childRunId,
      fx.authUser
    );
    assert.strictEqual(lin.rootRunId, ctx.parentRunId);
    await cleanup();
  });

  check("TEST 10C.1-6 Parent Execute Workflow occurrence still references historical child", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("occ-ref");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const summary = await workflowsService().getChildInvocationForStep(
      ctx.parentId,
      ctx.parentRunId,
      "ew",
      0,
      fx.authUser
    );
    assert.ok(summary);
    assert.strictEqual(summary.runId, ctx.childRunId);
    assert.strictEqual(summary.workflowDeleted, true);
    assert.ok(summary.openRunPath);
    assert.strictEqual(summary.openWorkflowPath, null);
    await cleanup();
  });

  check("TEST 10C.1-7 Historical callable result remains available", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("callable-res");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const result = await sub().getSubworkflowResult(ctx.childRunId);
    assert.strictEqual(result.status, "succeeded");
    assert.ok(Array.isArray(result.items));
    const parent = await workflowsService().getRunById(
      ctx.parentRunId,
      fx.authUser
    );
    const ewStep = (parent.steps || []).find((s) => s.nodeId === "ew");
    assert.ok(ewStep);
    assert.ok(ewStep.output != null);
    await cleanup();
  });

  check("TEST 10C.1-8 Historical run can be authorized/read without live editable definition", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("auth-read");
    await workflowsService().remove(ctx.childId, fx.authUser);
    await assert.rejects(
      () => workflowsService().getById(ctx.childId, fx.authUser),
      (err) => err.statusCode === 404
    );
    const run = await workflowsService().getRunById(ctx.childRunId, fx.authUser, {
      workflowId: ctx.childId,
    });
    assert.strictEqual(run.workflowDeleted, true);
    assert.ok(run.historicalDefinition);
    assert.ok(run.steps?.length);
    await cleanup();
  });

  check("TEST 10C.1-9 Cross-workspace historical run remains inaccessible", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("xws");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const stranger = {
      userId: "00000000-0000-4000-8000-000000000099",
      role: "Agent",
    };
    await assert.rejects(
      () => workflowsService().getRunById(ctx.childRunId, stranger),
      (err) => err.statusCode === 403 || err.statusCode === 404
    );
    await cleanup();
  });

  check("TEST 10C.1-10 Open-run navigation works for deleted live workflow", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("open-run");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const summary = await sub().getChildInvocationSummary(
      ctx.parentRunId,
      "ew",
      0,
      fx.authUser
    );
    assert.ok(summary.openRunPath.includes(ctx.childRunId));
    assert.ok(summary.openRunPath.includes(ctx.childId));
    await cleanup();
  });

  check("TEST 10C.1-11 Open-workflow action unavailable after deletion", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("open-wf");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const summary = await sub().getChildInvocationSummary(
      ctx.parentRunId,
      "ew",
      0,
      fx.authUser
    );
    assert.strictEqual(summary.openWorkflowPath, null);
    assert.strictEqual(summary.workflowDeleted, true);
    const summaryUi = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/SubworkflowRunSummary.tsx"
      ),
      "utf8"
    );
    assert.ok(summaryUi.includes("!summary.workflowDeleted"));
    await cleanup();
  });

  check("TEST 10C.1-12 New parent invocation after child deletion fails NOT_FOUND", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const childId = await insertWorkflow("gone-child", callableChild());
    const parentId = await insertWorkflow(
      "parent-new-inv",
      parentWithExecute(childId)
    );
    await workflowsService().remove(childId, fx.authUser);
    const parentRunId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, root_run_id, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      [
        parentRunId,
        parentId,
        parentRunId,
        JSON.stringify({}),
        JSON.stringify(parentWithExecute(childId)),
        fx.userId,
      ]
    );
    await assert.rejects(
      () =>
        sub().invokeSubworkflow({
          parentRunId,
          parentNodeId: "ew",
          parentExecutionIndex: 0,
          childWorkflowId: childId,
          inputItems: [{ json: { n: 1 } }],
          authUser: fx.authUser,
        }),
      (err) =>
        err.code === "CHILD_WORKFLOW_NOT_FOUND" ||
        /not found|Child workflow/i.test(String(err.message || err))
    );
    await cleanup();
  });

  check("TEST 10C.1-13 Deleted child stays absent from workflow picker", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const childId = await insertWorkflow("picker-gone", callableChild());
    await workflowsService().remove(childId, fx.authUser);
    const list = await workflowsService().listCallableTargets(
      fx.workspaceId,
      fx.authUser,
      {}
    );
    assert.ok(!list.some((w) => w.id === childId));
    const live = await workflowsService().listByWorkspace(
      fx.workspaceId,
      fx.authUser
    );
    assert.ok(!live.some((w) => w.id === childId));
    await cleanup();
  });

  check("TEST 10C.1-14 Delete parent live definition does not break historical child lineage", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("del-parent");
    await workflowsService().remove(ctx.parentId, fx.authUser);
    const [parentRows] = await pool.execute(
      `SELECT id FROM workflow_runs WHERE id = ?`,
      [ctx.parentRunId]
    );
    const [childRows] = await pool.execute(
      `SELECT id, parent_run_id FROM workflow_runs WHERE id = ?`,
      [ctx.childRunId]
    );
    assert.strictEqual(parentRows.length, 1);
    assert.strictEqual(childRows.length, 1);
    assert.strictEqual(childRows[0].parent_run_id, ctx.parentRunId);
    const lin = await workflowsService().getRunLineage(
      ctx.childId,
      ctx.childRunId,
      fx.authUser
    );
    assert.ok(lin.ancestors.some((a) => a.runId === ctx.parentRunId));
    assert.strictEqual(
      lin.ancestors.find((a) => a.runId === ctx.parentRunId).workflowDeleted,
      true
    );
    await cleanup();
  });

  check("TEST 10C.1-15 Delete both live definitions preserves historical lineage", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("del-both");
    await workflowsService().remove(ctx.childId, fx.authUser);
    await workflowsService().remove(ctx.parentId, fx.authUser);
    const lin = await workflowsService().getRunLineage(
      ctx.parentId,
      ctx.parentRunId,
      fx.authUser
    );
    assert.strictEqual(lin.run.workflowDeleted, true);
    assert.ok(lin.children.some((c) => c.runId === ctx.childRunId));
    assert.ok(lin.children.every((c) => c.workflowDeleted));
    await cleanup();
  });

  check("TEST 10C.1-16 Active-run deletion policy is deterministic", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const def = {
      version: 1,
      nodes: [{ id: "t", type: "trigger", data: {} }],
      edges: [],
    };
    const wfId = await insertWorkflow("active-del", def);
    const runId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, 'waiting', ?, ?, ?)`,
      [runId, wfId, JSON.stringify({}), JSON.stringify(def), fx.userId]
    );
    await assert.rejects(
      () => workflowsService().remove(wfId, fx.authUser),
      (err) =>
        err.code === "WORKFLOW_HAS_ACTIVE_RUNS" || err.statusCode === 409
    );
    const [wf] = await pool.execute(
      `SELECT deleted_at FROM workflows WHERE id = ?`,
      [wfId]
    );
    assert.strictEqual(wf[0].deleted_at, null);
    // After run finishes, delete succeeds.
    await pool.execute(
      `UPDATE workflow_runs SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [runId]
    );
    const result = await workflowsService().remove(wfId, fx.authUser);
    assert.strictEqual(result.success, true);
    const [wf2] = await pool.execute(
      `SELECT deleted_at FROM workflows WHERE id = ?`,
      [wfId]
    );
    assert.ok(wf2[0].deleted_at != null);
    await cleanup();
  });

  check("TEST 10C.1-17 Run dependency rows do not dangle", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("deps");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const [deps] = await pool.execute(
      `SELECT child_run_id FROM workflow_run_dependencies WHERE parent_run_id = ?`,
      [ctx.parentRunId]
    );
    assert.ok(deps.length >= 1);
    for (const d of deps) {
      const [child] = await pool.execute(
        `SELECT id FROM workflow_runs WHERE id = ?`,
        [d.child_run_id]
      );
      assert.strictEqual(child.length, 1);
    }
    await cleanup();
  });

  check("TEST 10C.1-18 Definition snapshot remains intact", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("snap");
    const [before] = await pool.execute(
      `SELECT definition_snapshot_json FROM workflow_runs WHERE id = ?`,
      [ctx.childRunId]
    );
    await workflowsService().remove(ctx.childId, fx.authUser);
    const [after] = await pool.execute(
      `SELECT definition_snapshot_json FROM workflow_runs WHERE id = ?`,
      [ctx.childRunId]
    );
    assert.ok(before[0].definition_snapshot_json);
    assert.strictEqual(
      String(before[0].definition_snapshot_json),
      String(after[0].definition_snapshot_json)
    );
    await cleanup();
  });

  check("TEST 10C.1-19 No secret fields added to lineage API", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const ctx = await runParentChild("secrets");
    await workflowsService().remove(ctx.childId, fx.authUser);
    const lin = await workflowsService().getRunLineage(
      ctx.parentId,
      ctx.parentRunId,
      fx.authUser
    );
    const blob = JSON.stringify(lin);
    assert.ok(!blob.includes("definition_snapshot"));
    assert.ok(!blob.includes("definitionSnapshot"));
    assert.ok(!blob.includes("credential"));
    assert.ok(!/token_hash|token_ciphertext|externalResumeToken/i.test(blob));
    assert.ok(!blob.includes("__callableReturnItems"));
    await cleanup();
  });

  check("TEST 10C.1-20 Ordinary workflow deletion matches soft-delete policy", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    const id = await insertWorkflow("ordinary-del", {
      version: 1,
      nodes: [{ id: "t", type: "trigger", data: {} }],
      edges: [],
    });
    const result = await workflowsService().remove(id, fx.authUser);
    assert.strictEqual(result.success, true);
    const [rows] = await pool.execute(
      `SELECT deleted_at, status FROM workflows WHERE id = ?`,
      [id]
    );
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].deleted_at != null);
    assert.strictEqual(rows[0].status, "archived");
    const src = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.service.js"),
      "utf8"
    );
    assert.ok(src.includes("deleted_at = CURRENT_TIMESTAMP"));
    assert.ok(!/DELETE FROM workflows WHERE id = \?/.test(src));
    await cleanup();
  });

  check("TEST 10C.1 migration 020 exists", () => {
    const mig = path.join(
      __dirname,
      "../migrations/020_workflow_soft_delete_run_retention.sql"
    );
    assert.ok(fs.existsSync(mig));
    const sql = fs.readFileSync(mig, "utf8");
    assert.ok(sql.includes("deleted_at"));
    assert.ok(sql.includes("workflow_name_snapshot"));
  });
};

module.exports = { registerPart10C1Tests };
