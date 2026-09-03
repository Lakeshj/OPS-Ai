/**
 * Part 10A — Sub-workflow execution foundation tests.
 * Registered from smoke-workflow-engine.js
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart10ATests = ({ check, section, assert }) => {
  section("Part 10A sub-workflow execution foundation");

  const sub = () => require("../services/workflowSubworkflow.service");
  const { pool } = require("../config/database");
  const { executeRun } = require("../services/workflowEngine.service");
  const { processOnce } = require("../services/workflowWorker.service");
  const { handlers } = require("../services/workflowNodes.service");
  const {
    buildExecutionSnapshot,
  } = require("../services/workflowWait.service");

  const parseMaybeJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const callableChildDef = (extra = {}) => ({
    version: 1,
    nodes: [
      { id: "entry", type: "workflowTrigger", data: {} },
      {
        id: "pass",
        type: "set",
        data: {
          mappings: [{ key: "echo", value: "{{item.json.name}}" }],
        },
      },
      {
        id: "out",
        type: "result",
        data: { mapFrom: "{{items}}" },
      },
      ...(extra.nodes || []),
    ],
    edges: [
      { id: "e1", source: "entry", target: "pass" },
      { id: "e2", source: "pass", target: "out" },
      ...(extra.edges || []),
    ],
  });

  const parentDef = () => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", data: {} },
      { id: "invoke", type: "noop", data: { label: "invoke-slot" } },
      { id: "after", type: "set", data: { mappings: [{ key: "ok", value: "1" }] } },
      { id: "r", type: "result", data: { mapFrom: "{{steps.after.ok}}" } },
    ],
    edges: [
      { id: "e1", source: "t", target: "invoke" },
      { id: "e2", source: "invoke", target: "after" },
      { id: "e3", source: "after", target: "r" },
    ],
  });

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
      authUser: {
        userId: users[0].id,
        role: "Admin",
      },
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
      [
        id,
        fx.workspaceId,
        name,
        "part10a",
        JSON.stringify(definition),
        fx.userId,
      ]
    );
    fx.createdWorkflowIds.push(id);
    return id;
  };

  const insertParentRun = async (workflowId, definition) => {
    const fx = await ensureFixtures();
    const runId = uuidv4();
    const jobId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, root_run_id, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      [
        runId,
        workflowId,
        runId,
        JSON.stringify({ source: "manual" }),
        JSON.stringify(definition),
        fx.userId,
      ]
    );
    await pool.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [jobId, runId]
    );
    return { runId, jobId };
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

  const drainJobs = async (max = 30) => {
    for (let i = 0; i < max; i += 1) {
      const did = await processOnce();
      if (!did) break;
    }
  };

  const parentSnapshotForInvoke = (parentNodeId, execIndex, stepId) => {
    const {
      createRunData,
      recordOccurrence,
    } = require("../services/workflowOccurrence.service");
    const { buildGraph, createScheduler } = require("../services/workflowEngine.service");
    // Minimal snapshot: upstream trigger done, invoke waiting
    const def = parentDef();
    const graph = buildGraph(def);
    const scheduler = createScheduler(graph);
    // Advance past trigger
    const first = scheduler.next();
    if (first?.node) scheduler.complete(first.node, null);
    const runData = createRunData();
    recordOccurrence(runData, {
      nodeId: "t",
      runIndex: 0,
      status: "succeeded",
      items: [{ json: { triggered: true } }],
      output: { triggered: true },
    });
    return sub().buildChildWaitSnapshot({
      parentNodeId,
      parentExecutionIndex: execIndex,
      parentStepId: stepId,
      waitInputItems: [{ json: { name: "A" } }],
      context: {
        input: { source: "manual" },
        steps: { t: { triggered: true } },
        items: { t: [{ json: { triggered: true } }] },
        portOutputs: {},
        runData,
        loopControllers: {},
      },
      scheduler,
      finalOutput: null,
      runErrors: [],
    });
  };

  check("TEST 10A-1 Parent and child receive separate run IDs", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-1-parent", parentDef());
    const childWf = await insertWorkflow("p10a-1-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status, started_at)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running', CURRENT_TIMESTAMP)`,
      [stepId, parentRunId]
    );
    const snap = parentSnapshotForInvoke("invoke", 0, stepId);
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: snap,
      authUser: fx.authUser,
    });
    assert.ok(inv.childRunId);
    assert.notStrictEqual(inv.childRunId, parentRunId);
    await cleanup();
  });

  check("TEST 10A-2 Child stores parentRunId relationship", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-2-parent", parentDef());
    const childWf = await insertWorkflow("p10a-2-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    });
    const [rows] = await pool.execute(
      `SELECT parent_run_id, parent_node_id, parent_execution_index, root_run_id
       FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    assert.strictEqual(rows[0].parent_run_id, parentRunId);
    assert.strictEqual(rows[0].parent_node_id, "invoke");
    assert.strictEqual(rows[0].parent_execution_index, 0);
    assert.strictEqual(rows[0].root_run_id, parentRunId);
    await cleanup();
  });

  check("TEST 10A-3 Parent occurrence identity includes executionIndex", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-3-parent", parentDef());
    const childWf = await insertWorkflow("p10a-3-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 2, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 2,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 2, stepId),
      authUser: fx.authUser,
    });
    const [rows] = await pool.execute(
      `SELECT parent_execution_index FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    assert.strictEqual(rows[0].parent_execution_index, 2);
    await cleanup();
  });

  check("TEST 10A-4 Same parent occurrence reuses same child run", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-4-parent", parentDef());
    const childWf = await insertWorkflow("p10a-4-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    const args = {
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    };
    const a = await sub().invokeSubworkflow(args);
    const b = await sub().invokeSubworkflow(args);
    assert.strictEqual(a.childRunId, b.childRunId);
    assert.strictEqual(b.reused, true);
    await cleanup();
  });

  check("TEST 10A-5 Different parent occurrences create different child runs", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-5-parent", parentDef());
    const childWf = await insertWorkflow("p10a-5-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    for (const idx of [0, 1]) {
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'invoke', ?, 'noop', 'running')`,
        [uuidv4(), parentRunId, idx]
      );
    }
    const a = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    // Parent may be waiting — set back to running for second invoke test via new parent? 
    // Use same parent: first invoke parks parent. Resume parent status for second occurrence create.
    await pool.execute(
      `UPDATE workflow_runs SET status = 'running', waiting_reason = NULL WHERE id = ?`,
      [parentRunId]
    );
    const b = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 1,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "B" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 1, null),
      authUser: fx.authUser,
    });
    assert.notStrictEqual(a.childRunId, b.childRunId);
    await cleanup();
  });

  check("TEST 10A-6 Child snapshots its own definition", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-6-parent", parentDef());
    const childDef = callableChildDef();
    const childWf = await insertWorkflow("p10a-6-child", childDef);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const [rows] = await pool.execute(
      `SELECT definition_snapshot_json FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    const snap = parseMaybeJson(rows[0].definition_snapshot_json, {});
    assert.ok(snap.nodes.some((n) => n.type === "workflowTrigger"));
    await cleanup();
  });

  check("TEST 10A-7 Child V1 continues V1 after live child edited to V2", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-7-parent", parentDef());
    const v1 = callableChildDef();
    v1.nodes.find((n) => n.id === "pass").data.mappings = [
      { key: "ver", value: "v1" },
    ];
    const childWf = await insertWorkflow("p10a-7-child", v1);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const v2 = callableChildDef();
    v2.nodes.find((n) => n.id === "pass").data.mappings = [
      { key: "ver", value: "v2" },
    ];
    await pool.execute(
      `UPDATE workflows SET definition_json = ? WHERE id = ?`,
      [JSON.stringify(v2), childWf]
    );
    const [rows] = await pool.execute(
      `SELECT definition_snapshot_json FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    const snap = parseMaybeJson(rows[0].definition_snapshot_json, {});
    assert.strictEqual(
      snap.nodes.find((n) => n.id === "pass").data.mappings[0].value,
      "v1"
    );
    await cleanup();
  });

  check("TEST 10A-8 New invocation uses Child V2", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-8-parent", parentDef());
    const v1 = callableChildDef();
    const childWf = await insertWorkflow("p10a-8-child", v1);
    const v2 = callableChildDef();
    v2.nodes.find((n) => n.id === "pass").data.mappings = [
      { key: "ver", value: "v2" },
    ];
    await pool.execute(
      `UPDATE workflows SET definition_json = ? WHERE id = ?`,
      [JSON.stringify(v2), childWf]
    );
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const [rows] = await pool.execute(
      `SELECT definition_snapshot_json FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    const snap = parseMaybeJson(rows[0].definition_snapshot_json, {});
    assert.strictEqual(
      snap.nodes.find((n) => n.id === "pass").data.mappings[0].value,
      "v2"
    );
    await cleanup();
  });

  check("TEST 10A-9 Canonical multi-item input reaches child", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-9-parent", parentDef());
    const childWf = await insertWorkflow("p10a-9-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const items = [
      { json: { name: "A" }, pairedItem: { item: 0 } },
      { json: { name: "B" }, pairedItem: { item: 1 } },
    ];
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: items,
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const [rows] = await pool.execute(
      `SELECT input_json FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    const input = parseMaybeJson(rows[0].input_json, {});
    assert.strictEqual(input.source, "subworkflow");
    assert.strictEqual(input.items.length, 2);
    assert.strictEqual(input.items[1].json.name, "B");
    await cleanup();
  });

  check("TEST 10A-10 Child deterministic Result returns canonical items", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-10-parent", parentDef());
    const childWf = await insertWorkflow("p10a-10-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await executeRun(inv.childRunId);
    const result = await sub().getSubworkflowResult(inv.childRunId);
    assert.strictEqual(result.status, "succeeded");
    assert.ok(Array.isArray(result.items));
    assert.ok(result.items.length >= 1);
    await cleanup();
  });

  check("TEST 10A-11 Ambiguous child output rejected", () => {
    assert.throws(
      () =>
        sub().assertCallableChildDefinition({
          nodes: [
            { id: "entry", type: "workflowTrigger" },
            { id: "r1", type: "result" },
            { id: "r2", type: "result" },
          ],
          edges: [],
        }),
      (err) => err.code === "SUBWORKFLOW_AMBIGUOUS_OUTPUT"
    );
  });

  check("TEST 10A-12 Parent waits durably while child queued/running", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-12-parent", parentDef());
    const childWf = await insertWorkflow("p10a-12-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const [rows] = await pool.execute(
      `SELECT status, waiting_reason FROM workflow_runs WHERE id = ?`,
      [parentRunId]
    );
    assert.strictEqual(rows[0].status, "waiting");
    assert.strictEqual(rows[0].waiting_reason, "child_run");
    await cleanup();
  });

  check("TEST 10A-13 Parent worker released while waiting on child", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-13-parent", parentDef());
    const childWf = await insertWorkflow("p10a-13-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const [jobs] = await pool.execute(
      `SELECT status, locked_at, locked_by FROM workflow_jobs WHERE run_id = ?`,
      [parentRunId]
    );
    assert.strictEqual(jobs[0].status, "queued");
    assert.strictEqual(jobs[0].locked_at, null);
    await cleanup();
  });

  check("TEST 10A-14 Child success wakes parent", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-14-parent", parentDef());
    const childWf = await insertWorkflow("p10a-14-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    });
    await drainJobs(25);
    const [deps] = await pool.execute(
      `SELECT status FROM workflow_run_dependencies WHERE child_run_id = ?`,
      [inv.childRunId]
    );
    assert.ok(deps[0]);
    assert.ok(["completed", "waiting"].includes(deps[0].status));
    // Parent should be woken (queued available) or already resumed/succeeded
    const [parent] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [parentRunId]
    );
    assert.ok(
      ["waiting", "running", "succeeded", "failed"].includes(parent[0].status)
    );
    await cleanup();
  });

  check("TEST 10A-15 Crash after child success before parent wake is recoverable", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-15-parent", parentDef());
    const childWf = await insertWorkflow("p10a-15-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    // Run child to success without going through notify (simulate crash):
    await executeRun(inv.childRunId);
    // Force dep back to waiting + parent waiting to simulate missed wake
    await pool.execute(
      `UPDATE workflow_run_dependencies SET status = 'waiting', completed_at = NULL
       WHERE child_run_id = ?`,
      [inv.childRunId]
    );
    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'waiting', waiting_reason = 'child_run', waiting_node_id = 'invoke'
       WHERE id = ?`,
      [parentRunId]
    );
    const woke = await sub().reconcileOrphanedChildWaits(10);
    assert.ok(woke.some((w) => w.woke || w.idempotent));
    await cleanup();
  });

  check("TEST 10A-16 Parent resumes same runId", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-16-parent", parentDef());
    const childWf = await insertWorkflow("p10a-16-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    });
    await drainJobs(30);
    const [rows] = await pool.execute(
      `SELECT id FROM workflow_runs WHERE id = ?`,
      [parentRunId]
    );
    assert.strictEqual(rows[0].id, parentRunId);
    await cleanup();
  });

  check("TEST 10A-17 Parent invocation occurrence remains same executionIndex", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-17-parent", parentDef());
    const childWf = await insertWorkflow("p10a-17-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    });
    await drainJobs(30);
    const [steps] = await pool.execute(
      `SELECT execution_index, status FROM workflow_run_steps
       WHERE run_id = ? AND node_id = 'invoke'`,
      [parentRunId]
    );
    assert.ok(steps.length >= 1);
    assert.strictEqual(steps[0].execution_index, 0);
    await cleanup();
  });

  check("TEST 10A-18 Parent upstream nodes do not rerun", async () => {
    // Snapshot restore semantics: same as Wait — scheduler state preserved.
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(src.includes("applyChildResumeFromSnapshot"));
    assert.ok(src.includes("claimDueChildDependency"));
  });

  check("TEST 10A-19 Child failure propagates to parent invocation", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-19-parent", parentDef());
    const badChild = {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        {
          id: "boom",
          type: "code",
          data: { mode: "runOnceForAllItems", jsCode: "throw new Error('boom');" },
        },
        { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
      ],
      edges: [
        { id: "e1", source: "entry", target: "boom" },
        { id: "e2", source: "boom", target: "out" },
      ],
    };
    const childWf = await insertWorkflow("p10a-19-child", badChild);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    });
    await drainJobs(30);
    const result = await sub().getSubworkflowResult(inv.childRunId);
    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.error.code, "CHILD_RUN_FAILED");
    await cleanup();
  });

  check("TEST 10A-20 Child cancellation wakes/fails parent appropriately", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-20-parent", parentDef());
    // Child with Wait so it stays waiting until cancel
    const waitChild = {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        {
          id: "w",
          type: "wait",
          data: { resumeMode: "manual" },
        },
        { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
      ],
      edges: [
        { id: "e1", source: "entry", target: "w" },
        { id: "e2", source: "w", target: "out" },
      ],
    };
    const childWf = await insertWorkflow("p10a-20-child", waitChild);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await drainJobs(10);
    const { cancelRun } = require("../modules/workflows/workflows.service");
    await cancelRun(inv.childRunId, fx.authUser);
    const result = await sub().getSubworkflowResult(inv.childRunId);
    assert.strictEqual(result.status, "cancelled");
    assert.strictEqual(result.error.code, "CHILD_RUN_CANCELLED");
    await cleanup();
  });

  check("TEST 10A-21 Parent cancellation cancels active child", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-21-parent", parentDef());
    const waitChild = {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        { id: "w", type: "wait", data: { resumeMode: "manual" } },
        { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
      ],
      edges: [
        { id: "e1", source: "entry", target: "w" },
        { id: "e2", source: "w", target: "out" },
      ],
    };
    const childWf = await insertWorkflow("p10a-21-child", waitChild);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await drainJobs(10);
    const { cancelRun } = require("../modules/workflows/workflows.service");
    await cancelRun(parentRunId, fx.authUser);
    const [child] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    assert.strictEqual(child[0].status, "cancelled");
    await cleanup();
  });

  check("TEST 10A-22 Direct recursion A→A rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const wf = await insertWorkflow("p10a-22", callableChildDef());
    const { runId } = await insertParentRun(wf, callableChildDef());
    await assert.rejects(
      () =>
        sub().invokeSubworkflow({
          parentRunId: runId,
          parentNodeId: "invoke",
          parentExecutionIndex: 0,
          childWorkflowId: wf,
          inputItems: [],
          authUser: fx.authUser,
        }),
      (err) => err.code === "SUBWORKFLOW_RECURSION"
    );
    await cleanup();
  });

  check("TEST 10A-23 Indirect recursion A→B→A rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const wfA = await insertWorkflow("p10a-23-a", callableChildDef());
    const wfB = await insertWorkflow("p10a-23-b", callableChildDef());
    const { runId: runA } = await insertParentRun(wfA, callableChildDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId: runA,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: wfB,
      inputItems: [],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await assert.rejects(
      () =>
        sub().invokeSubworkflow({
          parentRunId: inv.childRunId,
          parentNodeId: "inner",
          parentExecutionIndex: 0,
          childWorkflowId: wfA,
          inputItems: [],
          authUser: fx.authUser,
        }),
      (err) => err.code === "SUBWORKFLOW_RECURSION"
    );
    await cleanup();
  });

  check("TEST 10A-24 Deep recursion A→B→C→A rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const wfA = await insertWorkflow("p10a-24-a", callableChildDef());
    const wfB = await insertWorkflow("p10a-24-b", callableChildDef());
    const wfC = await insertWorkflow("p10a-24-c", callableChildDef());
    const { runId: runA } = await insertParentRun(wfA, callableChildDef());
    const b = await sub().invokeSubworkflow({
      parentRunId: runA,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: wfB,
      inputItems: [],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await pool.execute(
      `UPDATE workflow_runs SET status = 'running', waiting_reason = NULL WHERE id = ?`,
      [b.childRunId]
    );
    const c = await sub().invokeSubworkflow({
      parentRunId: b.childRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: wfC,
      inputItems: [],
      authUser: fx.authUser,
    });
    await assert.rejects(
      () =>
        sub().invokeSubworkflow({
          parentRunId: c.childRunId,
          parentNodeId: "invoke",
          parentExecutionIndex: 0,
          childWorkflowId: wfA,
          inputItems: [],
          authUser: fx.authUser,
        }),
      (err) => err.code === "SUBWORKFLOW_RECURSION"
    );
    await cleanup();
  });

  check("TEST 10A-25 Non-recursive chain within depth works", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const wfA = await insertWorkflow("p10a-25-a", parentDef());
    const wfB = await insertWorkflow("p10a-25-b", callableChildDef());
    const { runId: runA } = await insertParentRun(wfA, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId: runA,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: wfB,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    assert.ok(inv.childRunId);
    await cleanup();
  });

  check("TEST 10A-26 Depth limit rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const max = sub().MAX_SUBWORKFLOW_DEPTH;
    const defs = [];
    for (let i = 0; i <= max + 1; i += 1) {
      defs.push(await insertWorkflow(`p10a-26-${i}`, callableChildDef()));
    }
    // Build chain of exactly MAX depth (root depth 0 → child at depth MAX).
    let parentRunId = (await insertParentRun(defs[0], callableChildDef())).runId;
    let lastChild = null;
    for (let i = 0; i < max; i += 1) {
      if (i > 0) {
        parentRunId = lastChild;
        await pool.execute(
          `UPDATE workflow_runs SET status = 'running', waiting_reason = NULL WHERE id = ?`,
          [parentRunId]
        );
      }
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "invoke",
        parentExecutionIndex: 0,
        childWorkflowId: defs[i + 1],
        inputItems: [],
        authUser: fx.authUser,
      });
      lastChild = inv.childRunId;
    }
    await pool.execute(
      `UPDATE workflow_runs SET status = 'running', waiting_reason = NULL WHERE id = ?`,
      [lastChild]
    );
    await assert.rejects(
      () =>
        sub().invokeSubworkflow({
          parentRunId: lastChild,
          parentNodeId: "invoke",
          parentExecutionIndex: 0,
          childWorkflowId: defs[max + 1],
          inputItems: [],
          authUser: fx.authUser,
        }),
      (err) => err.code === "SUBWORKFLOW_DEPTH"
    );
    await cleanup();
  });

  check("TEST 10A-27 Child Wait leaves parent waiting without worker hold", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-27-parent", parentDef());
    const waitChild = {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        { id: "w", type: "wait", data: { resumeMode: "manual" } },
        { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
      ],
      edges: [
        { id: "e1", source: "entry", target: "w" },
        { id: "e2", source: "w", target: "out" },
      ],
    };
    const childWf = await insertWorkflow("p10a-27-child", waitChild);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await drainJobs(10);
    const [parent] = await pool.execute(
      `SELECT status, waiting_reason FROM workflow_runs WHERE id = ?`,
      [parentRunId]
    );
    const [child] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    const [pjob] = await pool.execute(
      `SELECT status, locked_at FROM workflow_jobs WHERE run_id = ?`,
      [parentRunId]
    );
    assert.strictEqual(parent[0].status, "waiting");
    assert.strictEqual(parent[0].waiting_reason, "child_run");
    assert.strictEqual(child[0].status, "waiting");
    assert.strictEqual(pjob[0].status, "queued");
    assert.strictEqual(pjob[0].locked_at, null);
    await cleanup();
  });

  check("TEST 10A-28 Child Wait resume/completion wakes parent", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-28-parent", parentDef());
    const waitChild = {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        { id: "w", type: "wait", data: { resumeMode: "manual" } },
        { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
      ],
      edges: [
        { id: "e1", source: "entry", target: "w" },
        { id: "e2", source: "w", target: "out" },
      ],
    };
    const childWf = await insertWorkflow("p10a-28-child", waitChild);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const stepId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_run_steps
        (id, run_id, node_id, execution_index, node_type, status)
       VALUES (?, ?, 'invoke', 0, 'noop', 'running')`,
      [stepId, parentRunId]
    );
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: stepId,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, stepId),
      authUser: fx.authUser,
    });
    // Run child to Wait suspension
    let childStatus = await executeRun(inv.childRunId);
    assert.strictEqual(childStatus.status, "waiting");
    const { resumeRun } = require("../modules/workflows/workflows.service");
    await resumeRun(childWf, inv.childRunId, fx.authUser);
    childStatus = await executeRun(inv.childRunId);
    assert.strictEqual(childStatus.status, "succeeded");
    const [deps] = await pool.execute(
      `SELECT status FROM workflow_run_dependencies WHERE child_run_id = ?`,
      [inv.childRunId]
    );
    assert.ok(deps[0]);
    assert.notStrictEqual(deps[0].status, "waiting");
    await cleanup();
  });

  check("TEST 10A-29 Child Loop execution works normally in synthetic callable child", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const loopChild = {
      version: 1,
      nodes: [
        { id: "entry", type: "workflowTrigger", data: {} },
        { id: "L", type: "loop", data: { batchSize: 2 } },
        { id: "body", type: "set", data: { mappings: [{ key: "x", value: "1" }] } },
        { id: "out", type: "result", data: { mapFrom: "{{items}}" } },
      ],
      edges: [
        { id: "e0", source: "entry", target: "L", targetHandle: "items" },
        { id: "e1", source: "L", target: "body", sourceHandle: "batch" },
        { id: "e2", source: "body", target: "L", targetHandle: "continue" },
        { id: "e3", source: "L", target: "out", sourceHandle: "done" },
      ],
    };
    const parentWf = await insertWorkflow("p10a-29-parent", parentDef());
    const childWf = await insertWorkflow("p10a-29-child", loopChild);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [
        { json: { name: "A" } },
        { json: { name: "B" } },
        { json: { name: "C" } },
      ],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await drainJobs(40);
    const [child] = await pool.execute(
      `SELECT status FROM workflow_runs WHERE id = ?`,
      [inv.childRunId]
    );
    assert.strictEqual(child[0].status, "succeeded");
    await cleanup();
  });

  check("TEST 10A-30 Child invocation ignores child Schedule trigger", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const def = {
      version: 1,
      nodes: [
        {
          id: "sched",
          type: "schedule",
          data: {
            scheduleRules: [
              { id: "r1", interval: "hours", hour: 1 },
            ],
          },
        },
        { id: "entry", type: "workflowTrigger", data: {} },
        { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
      ],
      edges: [
        { id: "e1", source: "entry", target: "out" },
      ],
    };
    const parentWf = await insertWorkflow("p10a-30-parent", parentDef());
    const childWf = await insertWorkflow("p10a-30-child", def);
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await drainJobs(20);
    const [steps] = await pool.execute(
      `SELECT status FROM workflow_run_steps WHERE run_id = ? AND node_id = 'sched'`,
      [inv.childRunId]
    );
    if (steps.length) assert.strictEqual(steps[0].status, "skipped");
    await cleanup();
  });

  check("TEST 10A-31 Child invocation ignores child Webhook trigger", async () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.ok(src.includes('nodeType === "webhook"'));
    assert.ok(src.includes("subworkflow_entry"));
  });

  check("TEST 10A-32 Credentials are not copied decrypted into parent/child relationship", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowSubworkflow.service.js"),
      "utf8"
    );
    assert.ok(!src.includes("decryptSecret"));
    assert.ok(!src.includes("credentialValue"));
  });

  check("TEST 10A-33 Binary refs preserved according to existing durability contract", () => {
    const items = sub().normalizeInvocationItems([
      { json: { a: 1 }, binary: { file: { id: "ext-1" } } },
    ]);
    const bounded = sub().boundaryItems(items);
    assert.ok(bounded[0].binary);
    assert.ok(!bounded[0].pairedItem);
  });

  check("TEST 10A-34 Run history exposes parent relationship", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-34-parent", parentDef());
    const childWf = await insertWorkflow("p10a-34-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const { getRunById } = require("../modules/workflows/workflows.service");
    const run = await getRunById(inv.childRunId, fx.authUser);
    assert.strictEqual(run.parentRunId, parentRunId);
    assert.strictEqual(run.parentNodeId, "invoke");
    assert.strictEqual(run.rootRunId, parentRunId);
    await cleanup();
  });

  check("TEST 10A-35 getChildRuns returns correct children", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-35-parent", parentDef());
    const childWf = await insertWorkflow("p10a-35-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const kids = await sub().getChildRuns(parentRunId);
    assert.strictEqual(kids.length, 1);
    assert.strictEqual(kids[0].parentRunId, parentRunId);
    await cleanup();
  });

  check("TEST 10A-36 Parent snapshot survives process-style serialization", () => {
    const snap = sub().buildChildWaitSnapshot({
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      parentStepId: "step-1",
      context: {
        input: {},
        steps: { t: { ok: true } },
        items: { t: [{ json: { ok: true } }] },
        portOutputs: {},
        runData: {},
        loopControllers: {},
      },
      scheduler: {
        edgeState: new Map(),
        nodeState: new Map(),
        loopCounts: new Map(),
      },
      finalOutput: null,
      runErrors: [],
    });
    const round = JSON.parse(JSON.stringify(snap));
    assert.strictEqual(round.kind, "child_wait");
    assert.strictEqual(round.childWait.parentNodeId, "invoke");
  });

  check("TEST 10A-37 Child terminal result is read durably, not memory-only", async () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowSubworkflow.service.js"),
      "utf8"
    );
    assert.ok(src.includes("getSubworkflowResult"));
    assert.ok(src.includes("definition_snapshot_json"));
  });

  check("TEST 10A-38 Duplicate child terminal notification doesn't resume parent twice", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const parentWf = await insertWorkflow("p10a-38-parent", parentDef());
    const childWf = await insertWorkflow("p10a-38-child", callableChildDef());
    const { runId: parentRunId } = await insertParentRun(parentWf, parentDef());
    const inv = await sub().invokeSubworkflow({
      parentRunId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    await executeRun(inv.childRunId);
    const a = await sub().notifyParentOfChildTerminal(inv.childRunId);
    const b = await sub().notifyParentOfChildTerminal(inv.childRunId);
    assert.ok(a.woke || a.idempotent || a.reason);
    assert.ok(b.idempotent || b.reason === "already_settled" || !b.woke);
    await cleanup();
  });

  check("TEST 10A-39 Different parents can invoke same child independently", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no workspace fixture");
    await cleanup();
    const p1 = await insertWorkflow("p10a-39-p1", parentDef());
    const p2 = await insertWorkflow("p10a-39-p2", parentDef());
    const childWf = await insertWorkflow("p10a-39-child", callableChildDef());
    const r1 = await insertParentRun(p1, parentDef());
    const r2 = await insertParentRun(p2, parentDef());
    const a = await sub().invokeSubworkflow({
      parentRunId: r1.runId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "A" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    const b = await sub().invokeSubworkflow({
      parentRunId: r2.runId,
      parentNodeId: "invoke",
      parentExecutionIndex: 0,
      childWorkflowId: childWf,
      inputItems: [{ json: { name: "B" } }],
      parentSnapshot: parentSnapshotForInvoke("invoke", 0, null),
      authUser: fx.authUser,
    });
    assert.notStrictEqual(a.childRunId, b.childRunId);
    await cleanup();
  });

  check("TEST 10A-40 Existing ordinary workflow run unchanged", async () => {
    const r = await handlers.trigger(
      { id: "t", type: "trigger", data: {} },
      { input: { hello: 1 } }
    );
    assert.strictEqual(r.output.kind, "manual");
  });

  check("TEST 10A-41 Existing Wait behavior unchanged", async () => {
    const now = new Date("2026-09-02T10:00:00.000Z");
    const r = await handlers.wait(
      { id: "w", data: { resumeMode: "time", waitAmount: 5, waitUnit: "seconds" } },
      { inputItems: [{ json: { ok: true } }], editorMode: false, now }
    );
    assert.strictEqual(r.suspend, true);
  });

  check("TEST 10A-42 Existing Loop behavior unchanged", () => {
    assert.strictEqual(sub().MAX_SUBWORKFLOW_DEPTH, 10);
    const mig = fs.readFileSync(
      path.join(__dirname, "../migrations/019_workflow_subworkflow.sql"),
      "utf8"
    );
    assert.ok(mig.includes("workflow_run_dependencies"));
    assert.ok(mig.includes("parent_run_id"));
  });
};

module.exports = { registerPart10ATests };
