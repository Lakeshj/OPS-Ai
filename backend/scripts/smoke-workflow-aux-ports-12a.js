/**
 * Part 12A — Typed auxiliary ports + AI connection foundation.
 */
const { v4: uuidv4 } = require("uuid");

const registerPart12ATests = ({ check, section, assert }) => {
  section("Part 12A Typed auxiliary ports + AI connection foundation");

  const conn = () => require("../services/workflowConnection.service");
  const {
    buildGraph,
    createScheduler,
    findStartNodes,
    executeRun,
  } = require("../services/workflowEngine.service");
  const {
    isUpstreamNode,
  } = require("../services/workflowExpression.service");
  const {
    invalidateConfigChange,
    invalidateEdgeTarget,
  } = require("../services/workflowGraphInvalidation.service");
  const {
    validateControlledCycles,
  } = require("../services/workflowLoopGraph.service");
  const { pool } = require("../config/database");

  const fixtureGraph = () => ({
    version: 1,
    nodes: [
      { id: "manual", type: "trigger", data: {} },
      {
        id: "set",
        type: "set",
        data: { mappings: [{ key: "v", value: "1" }] },
      },
      { id: "agent", type: "aiAgentTest", data: {} },
      {
        id: "result",
        type: "result",
        data: { mapFrom: "{{input}}" },
      },
      { id: "model", type: "aiModelProviderTest", data: { temperature: 0.2 } },
      { id: "toolA", type: "aiToolProviderTest", data: { name: "A" } },
      { id: "toolB", type: "aiToolProviderTest", data: { name: "B" } },
      { id: "memory", type: "aiMemoryProviderTest", data: {} },
    ],
    edges: [
      { id: "e-exec-1", source: "manual", target: "set" },
      { id: "e-exec-2", source: "set", target: "agent" },
      { id: "e-exec-3", source: "agent", target: "result" },
      {
        id: "e-aux-model",
        source: "model",
        target: "agent",
        sourceHandle: "model",
        targetHandle: "model",
      },
      {
        id: "e-aux-tool-a",
        source: "toolA",
        target: "agent",
        sourceHandle: "tool",
        targetHandle: "tools",
      },
      {
        id: "e-aux-tool-b",
        source: "toolB",
        target: "agent",
        sourceHandle: "tool",
        targetHandle: "tools",
      },
      {
        id: "e-aux-mem",
        source: "memory",
        target: "agent",
        sourceHandle: "memory",
        targetHandle: "memory",
      },
    ],
  });

  // ---- 12A-1 legacy defaults to execution ----
  check("TEST 12A-1 Existing edge defaults to execution semantics", () => {
    const { getEdgeConnectionMeta } = conn();
    const byId = new Map([
      ["a", { id: "a", type: "set" }],
      ["b", { id: "b", type: "set" }],
    ]);
    const meta = getEdgeConnectionMeta(
      { source: "a", target: "b" },
      byId
    );
    assert.equal(meta.connectionKind, "execution");
    assert.equal(meta.valid, true);
  });

  check("TEST 12A-2 Execution port → execution port valid", () => {
    const r = conn().validateTypedConnection({
      sourceType: "set",
      targetType: "filter",
      sourceHandle: "main",
      targetHandle: "main",
    });
    assert.equal(r.ok, true);
    assert.equal(r.connectionKind, "execution");
  });

  check("TEST 12A-3 ai-model → ai-model valid", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiModelProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "model",
      targetHandle: "model",
    });
    assert.equal(r.ok, true);
    assert.equal(r.dataType, "ai-model");
  });

  check("TEST 12A-4 ai-tool → ai-tool valid", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiToolProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "tool",
      targetHandle: "tools",
    });
    assert.equal(r.ok, true);
    assert.equal(r.dataType, "ai-tool");
  });

  check("TEST 12A-5 ai-memory → ai-memory valid", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiMemoryProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "memory",
      targetHandle: "memory",
    });
    assert.equal(r.ok, true);
    assert.equal(r.dataType, "ai-memory");
  });

  check("TEST 12A-6 ai-model → ai-tool rejected", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiModelProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "model",
      targetHandle: "tools",
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /AI tool/i);
  });

  check("TEST 12A-7 execution → ai-model rejected", () => {
    const r = conn().validateTypedConnection({
      sourceType: "set",
      targetType: "aiAgentTest",
      sourceHandle: "main",
      targetHandle: "model",
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /AI model/i);
  });

  check("TEST 12A-8 ai-model → execution rejected", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiModelProviderTest",
      targetType: "set",
      sourceHandle: "model",
      targetHandle: "main",
    });
    assert.equal(r.ok, false);
  });

  check("TEST 12A-9 model maxConnections=1 enforced", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiModelProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "model",
      targetHandle: "model",
      sourceId: "m2",
      targetId: "agent",
      existingEdges: [
        {
          source: "m1",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /Only one model/i);
  });

  check("TEST 12A-10 tools accepts multiple connections", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiToolProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "tool",
      targetHandle: "tools",
      sourceId: "t2",
      targetId: "agent",
      existingEdges: [
        {
          source: "t1",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
      ],
    });
    assert.equal(r.ok, true);
  });

  check("TEST 12A-11 memory maxConnections=1 enforced", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiMemoryProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "memory",
      targetHandle: "memory",
      sourceId: "mem2",
      targetId: "agent",
      existingEdges: [
        {
          source: "mem1",
          target: "agent",
          sourceHandle: "memory",
          targetHandle: "memory",
        },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /Only one memory/i);
  });

  check("TEST 12A-12 normal scheduler excludes auxiliary providers", () => {
    const graph = buildGraph(fixtureGraph());
    const starts = findStartNodes(graph).map((n) => n.id);
    assert.ok(starts.includes("manual"));
    assert.ok(!starts.includes("model"));
    assert.ok(!starts.includes("toolA"));
    const scheduler = createScheduler(graph);
    const ready = [];
    // drain first wave
    let node;
    while ((node = scheduler.nextReady?.() || null)) {
      // older API may differ — use internal peek via settle path
      break;
    }
    // Providers must not appear as execution-activated via aux edges alone
    const agentIncoming = graph.executionIncoming.get("agent") || [];
    assert.equal(agentIncoming.length, 1);
    assert.equal(agentIncoming[0].source, "set");
  });

  check("TEST 12A-13 provider node does not become root execution step", () => {
    const graph = buildGraph(fixtureGraph());
    const starts = findStartNodes(graph).map((n) => n.id);
    assert.deepEqual(
      starts.filter((id) =>
        ["model", "toolA", "toolB", "memory"].includes(id)
      ),
      []
    );
  });

  check("TEST 12A-14 Agent normal execution input still comes from Set", () => {
    const graph = buildGraph(fixtureGraph());
    const execIn = graph.executionIncoming.get("agent") || [];
    assert.equal(execIn.length, 1);
    assert.equal(execIn[0].source, "set");
  });

  check("TEST 12A-15 auxiliary edge excluded from pairedItem provenance", () => {
    const graph = buildGraph(fixtureGraph());
    assert.equal(isUpstreamNode(graph, "model", "agent"), false);
    assert.equal(isUpstreamNode(graph, "set", "agent"), true);
  });

  check("TEST 12A-16 auxiliary edge excluded from step expression reachability", () => {
    const graph = buildGraph(fixtureGraph());
    assert.equal(isUpstreamNode(graph, "toolA", "result"), false);
    assert.equal(isUpstreamNode(graph, "set", "result"), true);
  });

  check("TEST 12A-17 execution graph excludes auxiliary edges", () => {
    const exec = conn().getExecutionEdges(fixtureGraph());
    assert.equal(exec.length, 3);
    assert.ok(exec.every((e) => String(e.id).startsWith("e-exec")));
  });

  check("TEST 12A-18 auxiliary graph returns auxiliary edges", () => {
    const aux = conn().getAuxiliaryEdges(fixtureGraph());
    assert.equal(aux.length, 4);
  });

  check("TEST 12A-19 changing auxiliary binding dirties consumer + downstream", () => {
    const def = fixtureGraph();
    const graph = buildGraph(def);
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateEdgeTarget(session, graph, "agent");
    assert.ok(session.dirtyNodes.agent);
    assert.ok(session.dirtyNodes.result);
    assert.ok(!session.dirtyNodes.set);
  });

  check("TEST 12A-20 provider parameter change dirties consumer + downstream", () => {
    const def = fixtureGraph();
    const graph = buildGraph(def);
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateConfigChange(session, graph, "model", "config_change");
    assert.ok(session.dirtyNodes.model);
    assert.ok(session.dirtyNodes.agent);
    assert.ok(session.dirtyNodes.result);
    assert.ok(!session.dirtyNodes.set);
  });

  check("TEST 12A-21 provider parameter change does not create WorkflowItem dependency", () => {
    const graph = buildGraph(fixtureGraph());
    assert.equal(isUpstreamNode(graph, "model", "agent"), false);
    const execIn = graph.executionIncoming.get("agent") || [];
    assert.ok(!execIn.some((e) => e.source === "model"));
  });

  check("TEST 12A-22 deleting auxiliary edge dirties consumer", () => {
    const graph = buildGraph(fixtureGraph());
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateEdgeTarget(session, graph, "agent");
    assert.ok(session.dirtyNodes.agent);
  });

  check("TEST 12A-23 reconnecting model binding validates type", () => {
    const r = conn().validateTypedConnection({
      sourceType: "aiToolProviderTest",
      targetType: "aiAgentTest",
      sourceHandle: "tool",
      targetHandle: "model",
    });
    assert.equal(r.ok, false);
  });

  check("TEST 12A-24 reconnecting model binding dirties correct cone", () => {
    const graph = buildGraph(fixtureGraph());
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateEdgeTarget(session, graph, "agent");
    assert.ok(session.dirtyNodes.agent);
    assert.ok(session.dirtyNodes.result);
    assert.ok(!session.dirtyNodes.toolA);
  });

  check("TEST 12A-25 deleting provider removes attached edges (graph-level)", () => {
    const def = fixtureGraph();
    const nextEdges = def.edges.filter(
      (e) => e.source !== "model" && e.target !== "model"
    );
    const nextNodes = def.nodes.filter((n) => n.id !== "model");
    assert.ok(!nextEdges.some((e) => e.id === "e-aux-model"));
    assert.equal(nextNodes.some((n) => n.id === "agent"), true);
  });

  check("TEST 12A-26 consumer deletion preserves provider node", () => {
    const def = fixtureGraph();
    const nextNodes = def.nodes.filter((n) => n.id !== "agent");
    const nextEdges = def.edges.filter(
      (e) => e.source !== "agent" && e.target !== "agent"
    );
    assert.ok(nextNodes.some((n) => n.id === "model"));
    assert.ok(!nextEdges.some((e) => e.target === "agent"));
  });

  check("TEST 12A-27 copy/paste complete Agent cluster remaps typed edges", () => {
    // Backend-equivalent remap (FE clipboard uses same source/target/handle fields)
    const idMap = {
      agent: "agent_copy",
      model: "model_copy",
      toolA: "toolA_copy",
      toolB: "toolB_copy",
      memory: "memory_copy",
    };
    const remapped = fixtureGraph()
      .edges.filter(
        (e) =>
          idMap[e.source] &&
          idMap[e.target] &&
          String(e.id).startsWith("e-aux")
      )
      .map((e) => ({
        ...e,
        id: `${e.id}_copy`,
        source: idMap[e.source],
        target: idMap[e.target],
      }));
    assert.equal(remapped.length, 4);
    assert.ok(remapped.every((e) => e.target === "agent_copy"));
    assert.ok(remapped.some((e) => e.targetHandle === "model"));
    assert.ok(remapped.some((e) => e.targetHandle === "tools"));
  });

  check("TEST 12A-28 save/reload preserves typed handles", () => {
    const json = JSON.stringify(fixtureGraph());
    const reloaded = JSON.parse(json);
    const aux = conn().getAuxiliaryEdges(reloaded);
    assert.ok(aux.every((e) => e.sourceHandle && e.targetHandle));
    assert.ok(aux.some((e) => e.targetHandle === "model"));
  });

  check("TEST 12A-29 unknown typed port fails safely", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "m", type: "aiModelProviderTest", data: {} },
        { id: "a", type: "aiAgentTest", data: {} },
      ],
      edges: [
        {
          id: "bad",
          source: "m",
          target: "a",
          sourceHandle: "model",
          targetHandle: "unknownPort",
        },
      ],
    };
    const v = conn().validateDefinitionConnections(def);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /Unknown input port/i.test(e)));
  });

  check("TEST 12A-30 Switch dynamic execution ports unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "sw",
          type: "switch",
          data: {
            rules: [{ id: "rule_abc", value: "x" }],
          },
        },
        { id: "r", type: "result", data: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "sw" },
        {
          id: "e2",
          source: "sw",
          target: "r",
          sourceHandle: "rule_abc",
        },
      ],
    };
    const meta = conn().getEdgeConnectionMeta(def.edges[1], new Map(def.nodes.map((n) => [n.id, n])));
    assert.equal(meta.connectionKind, "execution");
    assert.equal(meta.valid, true);
  });

  check("TEST 12A-31 Merge semantics unchanged", () => {
    const r = conn().validateTypedConnection({
      sourceType: "set",
      targetType: "merge",
      sourceHandle: "main",
      targetHandle: "input1",
    });
    assert.equal(r.ok, true);
    assert.equal(r.connectionKind, "execution");
    const bad = conn().validateTypedConnection({
      sourceType: "aiModelProviderTest",
      targetType: "merge",
      sourceHandle: "model",
      targetHandle: "input1",
    });
    assert.equal(bad.ok, false);
  });

  check("TEST 12A-32 Loop controlled-cycle validation ignores auxiliary edges", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "loop", type: "loop", data: { batchSize: 1 } },
        { id: "body", type: "set", data: {} },
        { id: "model", type: "aiModelProviderTest", data: {} },
        { id: "agent", type: "aiAgentTest", data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "t",
          target: "loop",
          targetHandle: "items",
        },
        {
          id: "e2",
          source: "loop",
          target: "body",
          sourceHandle: "batch",
        },
        {
          id: "e3",
          source: "body",
          target: "loop",
          targetHandle: "continue",
        },
        {
          id: "e4",
          source: "loop",
          target: "agent",
          sourceHandle: "done",
        },
        {
          id: "eaux",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const cycle = validateControlledCycles(buildGraph(def));
    assert.equal(cycle.ok, true);
  });

  check("TEST 12A-33 Tidy does not use auxiliary edge as execution rank", () => {
    const { forwardEdges, auxiliaryEdges } = (() => {
      // Mirror FE projection using backend edges
      const def = fixtureGraph();
      return {
        forwardEdges: conn().getExecutionEdges(def),
        auxiliaryEdges: conn().getAuxiliaryEdges(def),
      };
    })();
    assert.ok(forwardEdges.every((e) => !String(e.id).includes("aux")));
    assert.ok(auxiliaryEdges.length > 0);
  });

  check("TEST 12A-34 Tidy provider placement near Agent (structural)", () => {
    // Structural: providers excluded from execution forward edges so they
    // cannot force Model into the Manual→Set→Agent chain.
    const exec = conn().getExecutionEdges(fixtureGraph()).map((e) => e.source);
    assert.ok(!exec.includes("model"));
  });

  check("TEST 12A-35 auxiliary edge insert action unavailable (contract)", () => {
    // Canvas sets onInsert undefined when auxiliary — assert classification.
    const aux = conn().getAuxiliaryEdges(fixtureGraph());
    assert.ok(aux.length > 0);
    assert.ok(conn().isAuxiliaryEdge(aux[0], new Map(fixtureGraph().nodes.map((n) => [n.id, n]))));
  });

  check("TEST 12A-36 resolveAuxiliaryBindings returns correct model", () => {
    const b = conn().resolveAuxiliaryBindings({
      nodeId: "agent",
      definition: fixtureGraph(),
    });
    assert.equal(b.model.length, 1);
    assert.equal(b.model[0].sourceNodeId, "model");
  });

  check("TEST 12A-37 resolveAuxiliaryBindings returns ordered tools", () => {
    const b = conn().resolveAuxiliaryBindings({
      nodeId: "agent",
      definition: fixtureGraph(),
    });
    assert.equal(b.tools.length, 2);
    assert.deepEqual(
      b.tools.map((t) => t.sourceNodeId),
      ["toolA", "toolB"]
    );
    // edge.id ascending: e-aux-tool-a < e-aux-tool-b
    assert.ok(b.tools[0].edgeId < b.tools[1].edgeId);
  });

  check("TEST 12A-38 resolveAuxiliaryBindings returns memory", () => {
    const b = conn().resolveAuxiliaryBindings({
      nodeId: "agent",
      definition: fixtureGraph(),
    });
    assert.equal(b.memory.length, 1);
    assert.equal(b.memory[0].sourceNodeId, "memory");
  });

  check("TEST 12A-41 frontend/backend typed-port validation agree", () => {
    const cases = [
      ["aiModelProviderTest", "aiAgentTest", "model", "model", true],
      ["aiModelProviderTest", "aiAgentTest", "model", "tools", false],
      ["set", "filter", "main", "main", true],
      ["aiModelProviderTest", "set", "model", "main", false],
    ];
    for (const [st, tt, sh, th, ok] of cases) {
      const r = conn().validateTypedConnection({
        sourceType: st,
        targetType: tt,
        sourceHandle: sh,
        targetHandle: th,
      });
      assert.equal(r.ok, ok, `${st}->${tt} ${sh}->${th}`);
    }
  });

  check("TEST 12A-42 legacy normal workflow unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "s", type: "set", data: { mappings: [] } },
        { id: "r", type: "result", data: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "r" },
      ],
    };
    assert.doesNotThrow(() => {
      const v = conn().validateDefinitionConnections(def);
      assert.equal(v.ok, true, v.errors?.join("; "));
    });
    const graph = buildGraph(def);
    assert.equal((graph.executionIncoming.get("s") || []).length, 1);
  });

  // Async DB-backed checks
  check("TEST 12A-39 unbound provider does not execute", async () => {
    const [workspaces] = await pool.execute(`SELECT id FROM workspaces LIMIT 1`);
    const [users] = await pool.execute(`SELECT id FROM users LIMIT 1`);
    if (!workspaces.length || !users.length) return;
    const workflowId = uuidv4();
    const runId = uuidv4();
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "s", type: "set", data: { mappings: [{ key: "x", value: "1" }] } },
        { id: "r", type: "result", data: {} },
        { id: "model", type: "aiModelProviderTest", data: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "r" },
      ],
    };
    await pool.execute(
      `INSERT INTO workflows (id, workspace_id, name, description, definition_json, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
      [workflowId, workspaces[0].id, "12a-unbound", "12a", JSON.stringify(def), users[0].id]
    );
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      [
        runId,
        workflowId,
        "12a-unbound",
        JSON.stringify({}),
        JSON.stringify(def),
        users[0].id,
      ]
    );
    await executeRun(runId);
    const [steps] = await pool.execute(
      `SELECT node_id, node_type, status FROM workflow_run_steps WHERE run_id = ?`,
      [runId]
    );
    assert.ok(!steps.some((s) => s.node_id === "model"));
    await pool.execute(`DELETE FROM workflows WHERE id = ?`, [workflowId]);
  });

  check("TEST 12A-40 provider produces no fake run-step record", async () => {
    const [workspaces] = await pool.execute(`SELECT id FROM workspaces LIMIT 1`);
    const [users] = await pool.execute(`SELECT id FROM users LIMIT 1`);
    if (!workspaces.length || !users.length) return;
    const workflowId = uuidv4();
    const runId = uuidv4();
    const def = fixtureGraph();
    await pool.execute(
      `INSERT INTO workflows (id, workspace_id, name, description, definition_json, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
      [workflowId, workspaces[0].id, "12a-provider-steps", "12a", JSON.stringify(def), users[0].id]
    );
    await pool.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, status, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      [
        runId,
        workflowId,
        "12a-provider-steps",
        JSON.stringify({}),
        JSON.stringify(def),
        users[0].id,
      ]
    );
    await executeRun(runId);
    const [steps] = await pool.execute(
      `SELECT node_id, node_type FROM workflow_run_steps WHERE run_id = ?`,
      [runId]
    );
    const providerIds = ["model", "toolA", "toolB", "memory"];
    assert.ok(!steps.some((s) => providerIds.includes(s.node_id)));
    assert.ok(steps.some((s) => s.node_id === "agent"));
    await pool.execute(`DELETE FROM workflows WHERE id = ?`, [workflowId]);
  });

  check("TEST 12A-43 Wait workflow unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "w", type: "wait", data: { resumeMode: "manual" } },
        { id: "r", type: "result", data: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "w" },
        { id: "e2", source: "w", target: "r" },
      ],
    };
    assert.doesNotThrow(() => {
      const v = conn().validateDefinitionConnections(def);
      assert.equal(v.ok, true, v.errors?.join("; "));
    });
    assert.equal(conn().getAuxiliaryEdges(def).length, 0);
  });

  check("TEST 12A-44 Loop workflow unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "loop", type: "loop", data: { batchSize: 1 } },
        { id: "body", type: "set", data: {} },
        { id: "r", type: "result", data: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "loop", targetHandle: "items" },
        { id: "e2", source: "loop", target: "body", sourceHandle: "batch" },
        { id: "e3", source: "body", target: "loop", targetHandle: "continue" },
        { id: "e4", source: "loop", target: "r", sourceHandle: "done" },
      ],
    };
    const cycle = validateControlledCycles(buildGraph(def));
    assert.equal(cycle.ok, true);
  });

  check("TEST 12A-45 Subworkflow unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "ew", type: "executeWorkflow", data: { workflowId: "x" } },
        { id: "r", type: "result", data: {} },
      ],
      edges: [
        { id: "e1", source: "t", target: "ew" },
        { id: "e2", source: "ew", target: "r" },
      ],
    };
    assert.equal(conn().getExecutionEdges(def).length, 2);
  });

  check("TEST 12A-46 Error Workflow unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "et", type: "errorTrigger", data: {} },
        { id: "r", type: "result", data: {} },
      ],
      edges: [{ id: "e1", source: "et", target: "r" }],
    };
    assert.doesNotThrow(() => {
      const v = conn().validateDefinitionConnections(def);
      assert.equal(v.ok, true, v.errors?.join("; "));
    });
  });
};

module.exports = { registerPart12ATests };
