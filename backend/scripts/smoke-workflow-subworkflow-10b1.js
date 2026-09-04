/**
 * Part 10B.1 — Result node contract stabilization tests.
 */
const { v4: uuidv4 } = require("uuid");

const registerPart10B1Tests = ({ check, section, assert }) => {
  section("Part 10B.1 Result node contract stabilization");

  const sub = () => require("../services/workflowSubworkflow.service");
  const { pool } = require("../config/database");
  const { executeRun } = require("../services/workflowEngine.service");
  const { handlers } = require("../services/workflowNodes.service");
  const { processOnce } = require("../services/workflowWorker.service");
  const { resumeRun } = require("../modules/workflows/workflows.service");

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
      [id, fx.workspaceId, name, "part10b1", JSON.stringify(definition), fx.userId]
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

  const startDurableRun = async (workflowId, definition, input = {}) => {
    const fx = await ensureFixtures();
    const runId = uuidv4();
    const jobId = uuidv4();
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, root_run_id, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      [
        runId,
        workflowId,
        runId,
        JSON.stringify(input),
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

  const drainJobs = async (max = 40) => {
    for (let i = 0; i < max; i += 1) {
      const did = await processOnce();
      if (!did) break;
    }
  };

  const callableChild = (bodyNodes, bodyEdges) => ({
    version: 1,
    nodes: [
      { id: "entry", type: "workflowTrigger", data: {} },
      ...bodyNodes,
      { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
    ],
    edges: bodyEdges,
  });

  // —— Ordinary Result (pre-10B contract) ——

  check("TEST 10B.1-1 Ordinary Result behavior matches pre-10B contract", async () => {
    const r = await handlers.result(
      { id: "r1", data: { mapFrom: "{{input.message}}" } },
      {
        input: { message: "hello-ordinary" },
        steps: {},
        inputItems: [
          { json: { name: "Alice" } },
          { json: { name: "Bob" } },
        ],
      }
    );
    // Historical: scalar result only — no items passthrough on handler return
    assert.strictEqual(r.output.result, "hello-ordinary");
    assert.strictEqual(r.terminal, true);
    assert.strictEqual(r.items, undefined);
  });

  check("TEST 10B.1-2 Ordinary configured Result behavior unchanged", async () => {
    const r = await handlers.result(
      { id: "r1", data: { mapFrom: "{{steps.sheet-1.text}}" } },
      {
        input: {},
        steps: {
          "sheet-1": { text: "LOADER", isLlm: false },
          ai: { text: "AI ANSWER", isLlm: true },
        },
        inputItems: [{ json: { row: 1 } }],
      }
    );
    // LLM preference heuristic preserved
    assert.strictEqual(r.output.result, "AI ANSWER");
    assert.strictEqual(r.items, undefined);
  });

  check("TEST 10B.1-3 Callable Result returns one item", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = callableChild(
        [
          {
            id: "pass",
            type: "set",
            data: { mappings: [{ key: "processed", value: "true" }] },
          },
        ],
        [
          { id: "e1", source: "entry", target: "pass" },
          { id: "e2", source: "pass", target: "out" },
        ]
      );
      const childId = await insertWorkflow("c-10b1-3", childDef);
      const parentDef = {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: {} },
          {
            id: "seed",
            type: "set",
            data: { mappings: [{ key: "name", value: "Alice" }] },
          },
          { id: "ew", type: "executeWorkflow", data: { workflowId: childId } },
        ],
        edges: [
          { id: "e1", source: "t", target: "seed" },
          { id: "e2", source: "seed", target: "ew" },
        ],
      };
      const parentId = await insertWorkflow("p-10b1-3", parentDef);
      const { runId } = await startDurableRun(parentId, parentDef, {
        source: "manual",
      });
      await executeRun(runId);
      const kids = await sub().getChildRuns(runId);
      await executeRun(kids[0].id);
      const result = await sub().getSubworkflowResult(kids[0].id);
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].json.name, "Alice");
      assert.strictEqual(result.items[0].json.processed, "true");
      // Result step must expose callable return separately from mapFrom wrapper
      const [steps] = await pool.execute(
        `SELECT output_json FROM workflow_run_steps
         WHERE run_id = ? AND node_id = 'out' AND status = 'succeeded'`,
        [kids[0].id]
      );
      const out =
        typeof steps[0].output_json === "string"
          ? JSON.parse(steps[0].output_json)
          : steps[0].output_json;
      assert.ok(Object.prototype.hasOwnProperty.call(out, "result"));
      assert.ok(Array.isArray(out.__callableReturnItems));
      assert.strictEqual(out.__callableReturnItems.length, 1);
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-4 Callable Result returns multiple items", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = callableChild(
        [
          {
            id: "pass",
            type: "set",
            data: { mappings: [{ key: "processed", value: "true" }] },
          },
        ],
        [
          { id: "e1", source: "entry", target: "pass" },
          { id: "e2", source: "pass", target: "out" },
        ]
      );
      const childId = await insertWorkflow("c-10b1-4", childDef);
      const parentDef = {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: {} },
          {
            id: "seed",
            type: "code",
            data: {
              code: "return [{json:{name:'Alice'}},{json:{name:'Bob'}}];",
            },
          },
          { id: "ew", type: "executeWorkflow", data: { workflowId: childId } },
        ],
        edges: [
          { id: "e1", source: "t", target: "seed" },
          { id: "e2", source: "seed", target: "ew" },
        ],
      };
      const parentId = await insertWorkflow("p-10b1-4", parentDef);
      const { runId } = await startDurableRun(parentId, parentDef, {
        source: "manual",
      });
      await executeRun(runId);
      const kids = await sub().getChildRuns(runId);
      await executeRun(kids[0].id);
      const result = await sub().getSubworkflowResult(kids[0].id);
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result.items[0].json.name, "Alice");
      assert.strictEqual(result.items[1].json.name, "Bob");
      assert.strictEqual(result.items[0].json.processed, "true");
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-5 Callable Result returns zero items successfully", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = {
        version: 1,
        nodes: [
          { id: "entry", type: "workflowTrigger", data: {} },
          {
            id: "filt",
            type: "filter",
            data: {
              fieldName: "name",
              operator: "eq",
              right: "__none__",
            },
          },
          { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
        ],
        edges: [
          { id: "e1", source: "entry", target: "filt" },
          { id: "e2", source: "filt", target: "out" },
        ],
      };
      const childId = await insertWorkflow("c-10b1-5", childDef);
      const parentWf = await insertWorkflow("p-10b1-5", {
        version: 1,
        nodes: [{ id: "t", type: "trigger", data: {} }],
        edges: [],
      });
      const { runId: parentRunId } = await startDurableRun(
        parentWf,
        { version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [] },
        { source: "manual" }
      );
      await pool.execute(
        `UPDATE workflow_runs SET status = 'waiting', waiting_reason = 'child_run'
         WHERE id = ?`,
        [parentRunId]
      );
      const stepId = uuidv4();
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'running')`,
        [stepId, parentRunId]
      );
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childWorkflowId: childId,
        inputItems: [{ json: { name: "A" } }],
        authUser: fx.authUser,
      });
      await executeRun(inv.childRunId);
      const result = await sub().getSubworkflowResult(inv.childRunId);
      assert.strictEqual(result.status, "succeeded");
      assert.deepStrictEqual(result.items, []);
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-6 Child Result after Wait returns durable items", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = {
        version: 1,
        nodes: [
          { id: "entry", type: "workflowTrigger", data: {} },
          { id: "w", type: "wait", data: { resumeMode: "manual" } },
          {
            id: "pass",
            type: "set",
            data: { mappings: [{ key: "afterWait", value: "1" }] },
          },
          { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
        ],
        edges: [
          { id: "e1", source: "entry", target: "w" },
          { id: "e2", source: "w", target: "pass" },
          { id: "e3", source: "pass", target: "out" },
        ],
      };
      const childId = await insertWorkflow("c-10b1-6", childDef);
      const parentWf = await insertWorkflow("p-10b1-6", {
        version: 1,
        nodes: [{ id: "t", type: "trigger", data: {} }],
        edges: [],
      });
      const { runId: parentRunId } = await startDurableRun(
        parentWf,
        { version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [] },
        { source: "manual" }
      );
      await pool.execute(
        `UPDATE workflow_runs SET status = 'waiting', waiting_reason = 'child_run'
         WHERE id = ?`,
        [parentRunId]
      );
      const stepId = uuidv4();
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'running')`,
        [stepId, parentRunId]
      );
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childWorkflowId: childId,
        inputItems: [{ json: { name: "WaitAlice" } }],
        authUser: fx.authUser,
      });
      let st = await executeRun(inv.childRunId);
      assert.strictEqual(st.status, "waiting");
      await resumeRun(childId, inv.childRunId, fx.authUser);
      st = await executeRun(inv.childRunId);
      assert.strictEqual(st.status, "succeeded");
      const result = await sub().getSubworkflowResult(inv.childRunId);
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].json.name, "WaitAlice");
      assert.strictEqual(result.items[0].json.afterWait, "1");
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-7 Child Result after Loop returns Loop.done items", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = {
        version: 1,
        nodes: [
          { id: "entry", type: "workflowTrigger", data: {} },
          { id: "L", type: "loop", data: { batchSize: 2 } },
          {
            id: "body",
            type: "set",
            data: { mappings: [{ key: "ok", value: "1" }] },
          },
          { id: "out", type: "result", data: { mapFrom: "{{input}}" } },
        ],
        edges: [
          { id: "e0", source: "entry", target: "L", targetHandle: "items" },
          { id: "e1", source: "L", target: "body", sourceHandle: "batch" },
          { id: "e2", source: "body", target: "L", targetHandle: "continue" },
          { id: "e3", source: "L", target: "out", sourceHandle: "done" },
        ],
      };
      const childId = await insertWorkflow("c-10b1-7", childDef);
      const parentWf = await insertWorkflow("p-10b1-7", {
        version: 1,
        nodes: [{ id: "t", type: "trigger", data: {} }],
        edges: [],
      });
      const { runId: parentRunId } = await startDurableRun(
        parentWf,
        { version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [] },
        { source: "manual" }
      );
      await pool.execute(
        `UPDATE workflow_runs SET status = 'waiting', waiting_reason = 'child_run'
         WHERE id = ?`,
        [parentRunId]
      );
      const stepId = uuidv4();
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'running')`,
        [stepId, parentRunId]
      );
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childWorkflowId: childId,
        inputItems: [
          { json: { n: 1 } },
          { json: { n: 2 } },
          { json: { n: 3 } },
        ],
        authUser: fx.authUser,
      });
      await executeRun(inv.childRunId);
      const result = await sub().getSubworkflowResult(inv.childRunId);
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.items.length, 3);
      assert.ok(result.items.every((i) => i.json.ok === "1"));
      // Exactly one Result occurrence
      const [steps] = await pool.execute(
        `SELECT COUNT(*) AS c FROM workflow_run_steps
         WHERE run_id = ? AND node_id = 'out' AND status = 'succeeded'`,
        [inv.childRunId]
      );
      assert.strictEqual(Number(steps[0].c), 1);
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-8 Binary refs survive Result boundary", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = callableChild([], [
        { id: "e1", source: "entry", target: "out" },
      ]);
      const childId = await insertWorkflow("c-10b1-8", childDef);
      const parentWf = await insertWorkflow("p-10b1-8", {
        version: 1,
        nodes: [{ id: "t", type: "trigger", data: {} }],
        edges: [],
      });
      const { runId: parentRunId } = await startDurableRun(
        parentWf,
        { version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [] },
        { source: "manual" }
      );
      await pool.execute(
        `UPDATE workflow_runs SET status = 'waiting', waiting_reason = 'child_run'
         WHERE id = ?`,
        [parentRunId]
      );
      const stepId = uuidv4();
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'running')`,
        [stepId, parentRunId]
      );
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childWorkflowId: childId,
        inputItems: [
          {
            json: { name: "file" },
            binary: {
              data: {
                fileId: "ext-file-1",
                mimeType: "text/plain",
                fileName: "a.txt",
              },
            },
          },
        ],
        authUser: fx.authUser,
      });
      await executeRun(inv.childRunId);
      const result = await sub().getSubworkflowResult(inv.childRunId);
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].binary.data.fileId, "ext-file-1");
      assert.ok(!Buffer.isBuffer(result.items[0].binary?.data?.data));
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-9 getSubworkflowResult reads authoritative durable result", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = callableChild(
        [
          {
            id: "pass",
            type: "set",
            data: { mappings: [{ key: "x", value: "1" }] },
          },
        ],
        [
          { id: "e1", source: "entry", target: "pass" },
          { id: "e2", source: "pass", target: "out" },
        ]
      );
      const childId = await insertWorkflow("c-10b1-9", childDef);
      const parentWf = await insertWorkflow("p-10b1-9", {
        version: 1,
        nodes: [{ id: "t", type: "trigger", data: {} }],
        edges: [],
      });
      const { runId: parentRunId } = await startDurableRun(
        parentWf,
        { version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [] },
        { source: "manual" }
      );
      await pool.execute(
        `UPDATE workflow_runs SET status = 'waiting', waiting_reason = 'child_run'
         WHERE id = ?`,
        [parentRunId]
      );
      const stepId = uuidv4();
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'running')`,
        [stepId, parentRunId]
      );
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childWorkflowId: childId,
        inputItems: [{ json: { name: "Auth" } }],
        authUser: fx.authUser,
      });
      await executeRun(inv.childRunId);

      // Corrupt run-level cache — step row must still win
      await pool.execute(
        `UPDATE workflow_runs
         SET output_json = ?
         WHERE id = ?`,
        [
          JSON.stringify({
            result: "",
            __subworkflowItems: [{ json: { name: "STALE" } }],
          }),
          inv.childRunId,
        ]
      );

      const result = await sub().getSubworkflowResult(inv.childRunId);
      assert.strictEqual(result.status, "succeeded");
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].json.name, "Auth");
      assert.notStrictEqual(result.items[0].json.name, "STALE");
    } finally {
      await cleanup();
    }
  });

  check("TEST 10B.1-10 Ambiguous multiple Result occurrences rejected", async () => {
    const fx = await ensureFixtures();
    if (fx.skip) return assert.ok(true, "no fixture");
    await cleanup();
    try {
      const childDef = callableChild([], [
        { id: "e1", source: "entry", target: "out" },
      ]);
      const childId = await insertWorkflow("c-10b1-10", childDef);
      const parentWf = await insertWorkflow("p-10b1-10", {
        version: 1,
        nodes: [{ id: "t", type: "trigger", data: {} }],
        edges: [],
      });
      const { runId: parentRunId } = await startDurableRun(
        parentWf,
        { version: 1, nodes: [{ id: "t", type: "trigger" }], edges: [] },
        { source: "manual" }
      );
      await pool.execute(
        `UPDATE workflow_runs SET status = 'waiting', waiting_reason = 'child_run'
         WHERE id = ?`,
        [parentRunId]
      );
      const stepId = uuidv4();
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status)
         VALUES (?, ?, 'ew', 0, 'executeWorkflow', 'running')`,
        [stepId, parentRunId]
      );
      const inv = await sub().invokeSubworkflow({
        parentRunId,
        parentNodeId: "ew",
        parentExecutionIndex: 0,
        parentStepId: stepId,
        childWorkflowId: childId,
        inputItems: [{ json: { name: "A" } }],
        authUser: fx.authUser,
      });
      await executeRun(inv.childRunId);

      // Simulate a second Result occurrence (never silently pick latest)
      await pool.execute(
        `INSERT INTO workflow_run_steps
          (id, run_id, node_id, execution_index, node_type, status, output_json, finished_at)
         VALUES (?, ?, 'out', 1, 'result', 'succeeded', ?, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          inv.childRunId,
          JSON.stringify({
            result: "dup",
            __callableReturnItems: [{ json: { name: "LATEST" } }],
          }),
        ]
      );

      const result = await sub().getSubworkflowResult(inv.childRunId);
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.error.code, "SUBWORKFLOW_AMBIGUOUS_OUTPUT");
      assert.deepStrictEqual(result.items, []);
    } finally {
      await cleanup();
    }
  });
};

module.exports = { registerPart10B1Tests };
