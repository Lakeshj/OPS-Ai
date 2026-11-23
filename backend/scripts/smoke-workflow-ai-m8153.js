/**
 * M8.15.3 — Editor Run Step must discover AI Agent tools from the workflow graph.
 *
 * Hypothesis under test: Run Step previously executed the Agent without retaining
 * auxiliary MCP/tool nodes in the binding graph (pruned MAIN path / missing context).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  executePartial,
  executeGraphInMemory,
  expandIdsWithAuxiliaryResources,
  buildGraph,
} = require("../services/workflowEngine.service");
const {
  resolveAgentResources,
} = require("../services/workflowAiResources.service");

const pruneViaExpand = (definition, ids) => {
  const kept = expandIdsWithAuxiliaryResources(definition, ids);
  return {
    version: 1,
    nodes: (definition.nodes || []).filter((n) => kept.has(n.id)),
    edges: (definition.edges || []).filter(
      (e) => kept.has(e.source) && kept.has(e.target)
    ),
  };
};

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const igAgentFixture = () => ({
  version: 1,
  nodes: [
    { id: "manual", type: "trigger", data: {} },
    {
      id: "ig-src",
      type: "instagram",
      data: {
        resource: "profile",
        operation: "get_profile",
        credentialId: "cred-ig-m8153",
        instagramUserId: "17841400000000000",
        label: "Instagram Native",
      },
    },
    {
      id: "ig-mcp",
      type: "instagramMcpTool",
      data: {
        toolId: "list_media",
        instagramSourceNodeId: "ig-src",
        label: "Instagram MCP",
      },
    },
    {
      id: "model",
      type: "aiModelProviderTest",
      data: { script: "echo", temperature: 0 },
    },
    {
      id: "agent",
      type: "aiAgent",
      data: {
        prompt:
          "Give me a summary of the 5 most recent Instagram posts. Include date, post type, likes and comments.",
        label: "AI Agent",
      },
    },
  ],
  edges: [
    // MAIN: trigger → agent only (Instagram MCP is NOT a MAIN upstream)
    { id: "e-main", source: "manual", target: "agent" },
    {
      id: "e-model",
      source: "model",
      target: "agent",
      sourceHandle: "model",
      targetHandle: "model",
    },
    {
      id: "e-tool",
      source: "ig-mcp",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
    },
  ],
});

async function main() {
  console.log("\nM8.15.3 Run Step AI Agent tool graph discovery");

  await check("M8153-1 expandIds keeps MCP + Instagram source for Agent seed", () => {
    const def = igAgentFixture();
    const kept = expandIdsWithAuxiliaryResources(def, new Set(["agent"]));
    assert.equal(kept.has("agent"), true);
    assert.equal(kept.has("ig-mcp"), true);
    assert.equal(kept.has("model"), true);
    assert.equal(kept.has("ig-src"), true);
  });

  await check("M8153-2 prune retains auxiliary tool graph", () => {
    const def = igAgentFixture();
    const pruned = pruneViaExpand(def, new Set(["manual", "agent"]));
    const ids = new Set(pruned.nodes.map((n) => n.id));
    assert.equal(ids.has("ig-mcp"), true);
    assert.equal(ids.has("ig-src"), true);
    assert.equal(ids.has("model"), true);
    assert.ok(
      pruned.edges.some(
        (e) =>
          e.source === "ig-mcp" &&
          e.target === "agent" &&
          e.targetHandle === "tools"
      )
    );
  });

  await check("M8153-3 resolveAgentResources finds Instagram MCP from graph", () => {
    const def = igAgentFixture();
    const resolved = resolveAgentResources({
      nodeId: "agent",
      definition: def,
    });
    assert.equal(resolved.diagnostics.toolEdgesFound, 1);
    assert.equal(resolved.diagnostics.toolNodesResolved, 1);
    assert.equal(resolved.toolDescriptors[0].name, "instagram_list_media");
    assert.equal(resolved.diagnostics.toolResolutionErrors.length, 0);
  });

  await check("M8153-4 Editor Run Step entrypoint (executePartial mode=step)", async () => {
    // Same path workflows.service.executeNodeStep → executePartial({ mode: "step" })
    const def = igAgentFixture();
    const partial = await executePartial({
      definition: def,
      input: {},
      targetNodeId: "agent",
      mode: "step",
      workspaceId: "ws-m8153",
      workflowId: "wf-m8153",
      userId: "user-m8153",
    });
    assert.equal(partial.targetNodeId, "agent");
    const result = partial.results.agent;
    assert.ok(result);
    assert.equal(result.status, "succeeded");
    const meta = result.output?.agentMeta?.[0];
    assert.ok(meta, "agentMeta missing on Run Step output");
    assert.equal(meta.workflowId, "wf-m8153");
    assert.equal(meta.nodeId, "agent");
    assert.equal(meta.toolEdgesFound, 1);
    assert.equal(meta.toolNodesResolved, 1);
    assert.ok((meta.toolsAvailable || []).length > 0);
    assert.ok(
      meta.toolsAvailable.some((t) => t.name === "instagram_list_media")
    );
    // Echo model: tools available but not requested (case B) — still proves discovery.
    assert.equal(meta.modelRequests, 1);
  });

  await check("M8153-5 Full in-memory execution shares the same tool discovery", async () => {
    const def = igAgentFixture();
    const mem = await executeGraphInMemory(def, {
      workspaceId: "ws-m8153",
      workflowId: "wf-m8153",
      userId: "user-m8153",
    });
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.equal(meta?.toolEdgesFound, 1);
    assert.equal(meta?.toolNodesResolved, 1);
    assert.ok(
      (meta?.toolsAvailable || []).some((t) => t.name === "instagram_list_media")
    );
  });

  await check("M8153-6 Missing toolId → edge found, node not resolved", () => {
    const def = igAgentFixture();
    def.nodes = def.nodes.map((n) =>
      n.id === "ig-mcp" ? { ...n, data: { instagramSourceNodeId: "ig-src" } } : n
    );
    const resolved = resolveAgentResources({
      nodeId: "agent",
      definition: def,
    });
    assert.equal(resolved.diagnostics.toolEdgesFound, 1);
    assert.equal(resolved.diagnostics.toolNodesResolved, 0);
    assert.ok(resolved.diagnostics.toolResolutionErrors.length >= 1);
  });

  await check("M8153-7 No tool edge → toolEdgesFound = 0", () => {
    const def = igAgentFixture();
    def.edges = def.edges.filter((e) => e.id !== "e-tool");
    const resolved = resolveAgentResources({
      nodeId: "agent",
      definition: def,
    });
    assert.equal(resolved.diagnostics.toolEdgesFound, 0);
    assert.equal(resolved.diagnostics.toolNodesResolved, 0);
  });

  await check("M8153-8 workflows.service wires workflowId into executePartial", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.service.js"),
      "utf8"
    );
    assert.match(src, /executePartial\(\{[\s\S]*workflowId/);
    assert.match(src, /workspaceId:\s*workflow\.workspaceId/);
  });

  await check("M8153-9 Engine keeps resourceDefinition on Run Step context", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowEngine.service.js"),
      "utf8"
    );
    assert.match(src, /resourceDefinition:\s*definition/);
    assert.match(src, /expandIdsWithAuxiliaryResources/);
  });

  await check("M8153-10 Auxiliary tool edge is not an execution ancestor", () => {
    const graph = buildGraph(igAgentFixture());
    const execIn = graph.executionIncoming.get("agent") || [];
    assert.equal(
      execIn.some((e) => e.source === "ig-mcp"),
      false
    );
    const allIn = graph.incoming.get("agent") || [];
    assert.equal(
      allIn.some((e) => e.source === "ig-mcp" && e.targetHandle === "tools"),
      true
    );
  });

  console.log(`\n${passed} M8.15.3 checks passed`);
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
