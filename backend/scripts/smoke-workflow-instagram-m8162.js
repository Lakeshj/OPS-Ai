/**
 * M8.16.2 — Instagram MCP structural checkpoints (NO Meta / Graph calls).
 *
 * Mirrors the known-good mock_list_posts path from M8.16.1:
 *   tool edge → node resolve → capability publish → available to Agent
 *
 * Does not execute Instagram Graph. Does not modify Agent grounding / tool loop.
 */
const assert = require("node:assert/strict");

const {
  buildToolDescriptor,
  resolveAgentResources,
} = require("../services/workflowAiResources.service");
const {
  diagnoseInstagramMcpNode,
  diagnoseInstagramAgentGraph,
  expectedCapabilityName,
} = require("../services/workflowInstagramMcpDiagnostics.service");
const {
  expandIdsWithAuxiliaryResources,
} = require("../services/workflowEngine.service");

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

const igAgentFixture = ({
  toolId = "list_media",
  nativeResource = "comments",
  nativeOperation = "list_comments",
  credentialId = "cred-ig-struct",
  withToolEdge = true,
  withAgent = true,
} = {}) => {
  const nodes = [
    { id: "manual", type: "trigger", data: {} },
    {
      id: "ig-src",
      type: "instagram",
      data: {
        label: "Instagram Native",
        resource: nativeResource,
        operation: nativeOperation,
        credentialId,
        username: "opsai_live_demo",
        instagramUserId: "17841400000000000",
      },
    },
    {
      id: "ig-mcp",
      type: "instagramMcpTool",
      data: {
        label: "Instagram MCP",
        toolId,
        instagramSourceNodeId: "ig-src",
      },
    },
    {
      id: "model",
      type: "aiModelProviderTest",
      data: { script: "echo", temperature: 0 },
    },
  ];
  const edges = [];
  if (withAgent) {
    nodes.push({
      id: "agent",
      type: "aiAgent",
      data: {
        label: "AI Agent",
        prompt:
          "Give me a summary of the 5 most recent Instagram posts. Include date, post type, likes and comments.",
      },
    });
    edges.push({ id: "e-main", source: "manual", target: "agent" });
    edges.push({
      id: "e-model",
      source: "model",
      target: "agent",
      sourceHandle: "model",
      targetHandle: "model",
    });
    if (withToolEdge) {
      edges.push({
        id: "e-tool",
        source: "ig-mcp",
        target: "agent",
        sourceHandle: "tool",
        targetHandle: "tools",
      });
    }
  }
  return { version: 1, nodes, edges, settings: {} };
};

(async () => {
  console.log("\nM8.16.2 Instagram MCP structural diagnostics (no Meta)");

  await check("M8162-1 list_media publishes instagram_list_media", () => {
    const def = igAgentFixture({ toolId: "list_media" });
    const mcp = def.nodes.find((n) => n.id === "ig-mcp");
    const desc = buildToolDescriptor(mcp);
    assert.equal(desc.name, "instagram_list_media");
    assert.equal(desc.igToolId, "list_media");
    assert.match(desc.description || "", /recent media|posts/i);
    assert.ok(desc.whenToUse);
    console.log(
      "  capability:",
      JSON.stringify({
        nodeId: desc.nodeId,
        nodeType: "instagramMcpTool",
        toolId: desc.igToolId,
        toolName: desc.name,
        description: String(desc.description || "").slice(0, 120),
        whenToUse: String(desc.whenToUse || "").slice(0, 120),
      })
    );
  });

  await check("M8162-2 comments publishes instagram_comments (NOT list_media)", () => {
    const def = igAgentFixture({ toolId: "comments" });
    const mcp = def.nodes.find((n) => n.id === "ig-mcp");
    const desc = buildToolDescriptor(mcp);
    assert.equal(desc.name, "instagram_comments");
    assert.equal(desc.igToolId, "comments");
    assert.notEqual(desc.name, "instagram_list_media");
    assert.match(desc.description || "", /comment/i);
  });

  await check("M8162-3 Native list_comments does NOT overwrite MCP list_media", () => {
    const def = igAgentFixture({
      toolId: "list_media",
      nativeResource: "comments",
      nativeOperation: "list_comments",
    });
    const diag = diagnoseInstagramAgentGraph(def, "agent");
    assert.equal(diag.toolEdgesFound, 1);
    assert.equal(diag.toolNodesResolved, 1);
    assert.equal(diag.toolsAvailable[0].name, "instagram_list_media");
    const mcpDiag = diag.mcpDiagnostics[0];
    assert.equal(mcpDiag.nativeOperation, "list_comments");
    assert.equal(mcpDiag.publishedCapability, "instagram_list_media");
    assert.ok(
      !/list_comments/i.test(mcpDiag.publishedCapability),
      "published capability must not become list_comments"
    );
  });

  await check("M8162-4 Agent resolve: toolEdgesFound + toolNodesResolved", () => {
    const def = igAgentFixture({ toolId: "list_media" });
    const resolved = resolveAgentResources({
      nodeId: "agent",
      definition: def,
    });
    assert.ok(resolved.diagnostics.toolEdgesFound >= 1);
    assert.ok(resolved.diagnostics.toolNodesResolved >= 1);
    assert.equal(resolved.toolDescriptors[0].name, "instagram_list_media");
    console.log(
      "  resolve:",
      JSON.stringify({
        toolEdgesFound: resolved.diagnostics.toolEdgesFound,
        toolNodesResolved: resolved.diagnostics.toolNodesResolved,
        toolsAvailable: resolved.toolDescriptors.map((t) => t.name),
      })
    );
  });

  await check("M8162-5 Source binding structural validity", () => {
    const def = igAgentFixture({ toolId: "list_media" });
    const mcp = def.nodes.find((n) => n.id === "ig-mcp");
    const d = diagnoseInstagramMcpNode(mcp, def);
    assert.equal(d.sourceNodeResolved, true);
    assert.equal(d.sourceBindingValid, true);
    assert.equal(d.credentialConfigured, true);
    assert.equal(d.accountLabel, "opsai_live_demo");
    assert.equal(d.descriptorPublished, true);
  });

  await check("M8162-6 Missing credential flagged without Meta call", () => {
    const def = igAgentFixture({
      toolId: "list_media",
      credentialId: "",
    });
    // clear credential
    def.nodes = def.nodes.map((n) =>
      n.id === "ig-src"
        ? { ...n, data: { ...n.data, credentialId: null } }
        : n
    );
    const mcp = def.nodes.find((n) => n.id === "ig-mcp");
    const d = diagnoseInstagramMcpNode(mcp, def);
    assert.equal(d.descriptorPublished, true);
    assert.equal(d.publishedCapability, "instagram_list_media");
    assert.equal(d.credentialConfigured, false);
    assert.ok(
      d.errors.some((e) => e.code === "SOURCE_CREDENTIAL_MISSING")
    );
  });

  await check("M8162-7 No tool edge → toolEdgesFound = 0", () => {
    const def = igAgentFixture({ withToolEdge: false });
    const diag = diagnoseInstagramAgentGraph(def, "agent");
    assert.equal(diag.toolEdgesFound, 0);
    assert.equal(diag.toolNodesResolved, 0);
  });

  await check("M8162-8 MCP without Agent → NO_AI_AGENT", () => {
    const def = igAgentFixture({ withAgent: false });
    const diag = diagnoseInstagramAgentGraph(def);
    assert.equal(diag.agentNodeId, null);
    assert.ok(diag.resolutionErrors.some((e) => e.code === "NO_AI_AGENT"));
    assert.equal(diag.mcpDiagnostics[0].publishedCapability, "instagram_list_media");
  });

  await check("M8162-9 One-MCP-node-per-toolId architecture", () => {
    const def = igAgentFixture({ toolId: "comments" });
    const diag = diagnoseInstagramAgentGraph(def, "agent");
    assert.equal(diag.architecture.oneMcpNodePerToolId, true);
    assert.equal(diag.toolsAvailable[0].name, "instagram_comments");
    // Adding a second MCP node for list_media would be required for posts
    def.nodes.push({
      id: "ig-mcp-media",
      type: "instagramMcpTool",
      data: {
        toolId: "list_media",
        instagramSourceNodeId: "ig-src",
        label: "IG MCP Media",
      },
    });
    def.edges.push({
      id: "e-tool-2",
      source: "ig-mcp-media",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
    });
    const both = diagnoseInstagramAgentGraph(def, "agent");
    const names = both.toolsAvailable.map((t) => t.name).sort();
    assert.deepEqual(names, ["instagram_comments", "instagram_list_media"]);
  });

  await check("M8162-10 expandIds keeps MCP + Instagram source", () => {
    const def = igAgentFixture();
    const kept = expandIdsWithAuxiliaryResources(def, new Set(["agent"]));
    assert.equal(kept.has("ig-mcp"), true);
    assert.equal(kept.has("ig-src"), true);
    assert.equal(kept.has("model"), true);
  });

  await check("M8162-11 expectedCapabilityName helper", () => {
    assert.equal(expectedCapabilityName("list_media"), "instagram_list_media");
    assert.equal(expectedCapabilityName("comments"), "instagram_comments");
  });

  await check("M8162-12 Optional live DB probe (soft)", async () => {
    try {
      require("dotenv").config();
      const mysql = require("mysql2/promise");
      if (!process.env.DB_HOST) {
        console.log("  skip: no DB_HOST");
        return;
      }
      const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });
      const [rows] = await pool.query(`
        SELECT id, name, definition_json
        FROM workflows
        WHERE deleted_at IS NULL
          AND definition_json LIKE '%instagramMcpTool%'
        ORDER BY updated_at DESC
        LIMIT 5
      `);
      console.log(`  live workflows with Instagram MCP: ${rows.length}`);
      for (const r of rows) {
        let def = r.definition_json;
        if (typeof def === "string") def = JSON.parse(def);
        const diag = diagnoseInstagramAgentGraph(def);
        console.log(
          "  LIVE",
          JSON.stringify({
            workflowId: r.id,
            name: r.name,
            agentNodeId: diag.agentNodeId,
            toolEdgesFound: diag.toolEdgesFound,
            toolNodesResolved: diag.toolNodesResolved,
            toolsAvailable: diag.toolsAvailable.map((t) => t.name),
            mcp: diag.mcpDiagnostics.map((m) => ({
              toolId: m.toolId,
              published: m.publishedCapability,
              sourceOk: m.sourceBindingValid,
              cred: m.credentialConfigured,
              nativeOp: m.nativeOperation,
              errors: m.errors.map((e) => e.code),
            })),
          })
        );
      }
      await pool.end();
    } catch (err) {
      console.log("  live probe soft-fail:", err.message);
    }
  });

  console.log(`\n${passed} M8.16.2 structural checks passed`);
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
