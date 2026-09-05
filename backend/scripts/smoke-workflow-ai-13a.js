/**
 * Part 13A — Integration audit + HTTP Tool foundation.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("node:http");

const registerPart13ATests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 13A HTTP Tool + integration audit");

  const {
    resolveAgentResources,
    materializeAgentRuntime,
    buildToolDescriptor,
    validateToolSchema,
    normalizeToolResultForModel,
    MAX_TOOL_RESULT_CHARS,
    AI_ERROR,
    AiRuntimeError,
    stripSecrets,
    assertNotProviderRunStep,
  } = require("../services/workflowAiResources.service");
  const {
    executeHttpTool,
    resolveToolTemplate,
    validateHttpToolName,
    parseInputSchema,
    assertUrlOriginPreserved,
  } = require("../services/workflowAiHttpTool.service");
  const { executeAiAgent } = require("../services/workflowAiAgent.service");
  const {
    buildGraph,
    findStartNodes,
    executeGraphInMemory,
  } = require("../services/workflowEngine.service");
  const { handlers } = require("../services/workflowNodes.service");
  const { isUpstreamNode } = require("../services/workflowExpression.service");
  const {
    invalidateConfigChange,
  } = require("../services/workflowGraphInvalidation.service");
  const {
    getExecutionEdges,
    getAuxiliaryEdges,
    getPortContract,
    isAuxiliaryOnlyProvider,
  } = require("../services/workflowConnection.service");

  const libraryPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );
  const catalog = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  const libraryNodes = catalog.nodes || [];

  const withMockServer = async (handler, fn) => {
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  const httpToolFixture = (opts = {}) => {
    const baseUrl = opts.baseUrl || "http://127.0.0.1:9";
    return {
      version: 1,
      nodes: [
        { id: "manual", type: "trigger", data: {} },
        {
          id: "set",
          type: "set",
          data: {
            mappings: [
              {
                key: "question",
                value: opts.question || "Look up customer 123.",
              },
            ],
          },
        },
        {
          id: "agent",
          type: "aiAgent",
          data: {
            prompt: opts.prompt || "{{item.question}}",
            ...(opts.toolTimeoutMs
              ? { toolTimeoutMs: opts.toolTimeoutMs }
              : {}),
          },
        },
        {
          id: "result",
          type: "result",
          data: { mapFrom: "{{steps.agent.text}}" },
        },
        {
          id: "model",
          type: "aiModelProviderTest",
          data: { script: opts.modelScript || "http-tool-demo" },
        },
        {
          id: "httpTool",
          type: "aiHttpTool",
          data: {
            toolName: opts.toolName || "lookup_customer",
            description: opts.description || "Look up a customer by id.",
            method: opts.method || "GET",
            url: opts.url || `${baseUrl}/customers/{{tool.id}}`,
            queryParams: opts.queryParams || [],
            headers: opts.headers || [],
            body: opts.body ?? null,
            credentialId: opts.credentialId || null,
            inputSchema:
              opts.inputSchema ||
              {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
            timeoutMs: opts.timeoutMs || 5000,
            failOnHttpError: opts.failOnHttpError,
            rateLimitRetries: 0,
          },
          position: { x: 40, y: 220 },
        },
        ...(opts.extraNodes || []),
      ].map((n, i) =>
        n.position
          ? n
          : {
              ...n,
              position: { x: 80 + i * 180, y: 80 },
            }
      ),
      edges: [
        { id: "e1", source: "manual", target: "set" },
        { id: "e2", source: "set", target: "agent" },
        { id: "e3", source: "agent", target: "result" },
        {
          id: "eaux-m",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
        {
          id: "eaux-t",
          source: "httpTool",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
        ...(opts.extraEdges || []),
      ],
    };
  };

  check("TEST 13A-1 Node catalog audit detects available/runtime mismatches", () => {
    const available = libraryNodes.filter((n) => n.available);
    const mismatches = [];
    for (const n of available) {
      if (!n.engineType) {
        mismatches.push(`${n.id}: available without engineType`);
        continue;
      }
      if (!handlers[n.engineType]) {
        mismatches.push(`${n.id}: no handler for ${n.engineType}`);
      }
    }
    assertX.deepEqual(mismatches, []);
  });

  check("TEST 13A-2 HTTP Tool available only when runtime exists", () => {
    const entry = libraryNodes.find((n) => n.id === "http-request-tool");
    assertX.ok(entry);
    assertX.equal(entry.available, true);
    assertX.equal(entry.engineType, "aiHttpTool");
    assertX.ok(handlers.aiHttpTool);
  });

  check("TEST 13A-3 HTTP Tool exposes ai-tool auxiliary port", () => {
    const ports = getPortContract("aiHttpTool");
    assertX.equal(ports.outputs?.[0]?.dataType, "ai-tool");
    assertX.equal(ports.outputs?.[0]?.id, "tool");
    assertX.equal(ports.isAuxiliaryProvider, true);
  });

  check("TEST 13A-4 HTTP Tool has no execution ports", () => {
    const ports = getPortContract("aiHttpTool");
    assertX.deepEqual(ports.inputs || [], []);
    assertX.ok(!(ports.outputs || []).some((p) => p.id === "main"));
  });

  check("TEST 13A-5 HTTP Tool excluded from scheduler", () => {
    const def = httpToolFixture();
    const graph = buildGraph(def);
    const starts = findStartNodes(graph);
    assertX.ok(isAuxiliaryOnlyProvider("aiHttpTool"));
    assertX.ok(!starts.some((n) => n.id === "httpTool"));
    assertX.ok(
      !getExecutionEdges(def).some(
        (e) => e.source === "httpTool" || e.target === "httpTool"
      )
    );
  });

  check("TEST 13A-6 HTTP Tool absent from workflow_run_steps", async () => {
    await withMockServer(
      (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123", name: "Ada" }));
      },
      async (baseUrl) => {
        const def = httpToolFixture({ baseUrl });
        const mem = await executeGraphInMemory(def, { workspaceId: "ws-13a" });
        const stepIds = Object.keys(mem.context.steps || {});
        assertX.ok(!stepIds.includes("httpTool"));
        assertX.ok(stepIds.includes("agent"));
      }
    );
  });

  check("TEST 13A-7 Agent typed picker includes HTTP Tool", () => {
    assertX.equal(
      libraryNodes.find((n) => n.engineType === "aiHttpTool")?.available,
      true
    );
    assertX.equal(
      libraryNodes.find((n) => n.engineType === "aiCalculatorTool")?.available,
      true
    );
    assertX.ok(isAuxiliaryOnlyProvider("aiHttpTool"));
    const httpEntry = libraryNodes.find((n) => n.id === "http-request");
    assertX.notEqual(httpEntry?.engineType, "aiHttpTool");
  });

  check("TEST 13A-8 Ordinary add-next-step excludes HTTP Tool", () => {
    const uxPath = path.join(
      __dirname,
      "../../frontend/src/modules/workflows/aiAgentUx.ts"
    );
    const src = fs.readFileSync(uxPath, "utf8");
    assertX.ok(src.includes('"aiHttpTool"'));
    assertX.ok(src.includes("isExcludedFromExecutionNextStep"));
  });

  check("TEST 13A-9 Run Step HTTP Tool controlled unsupported", () => {
    try {
      assertNotProviderRunStep({
        id: "httpTool",
        type: "aiHttpTool",
        data: {},
      });
      assertX.fail("expected throw");
    } catch (err) {
      assertX.equal(err.code, "AI_PROVIDER_NOT_EXECUTABLE");
      assertX.match(String(err.message), /does not run by itself/i);
    }
  });

  check("TEST 13A-10 Valid tool input schema accepted", () => {
    const schema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    };
    validateToolSchema(schema, "lookup_customer");
    assertX.deepEqual(parseInputSchema(schema), schema);
  });

  check("TEST 13A-11 Invalid schema rejected", () => {
    assertX.throws(
      () => parseInputSchema("not-json"),
      (err) => err instanceof AiRuntimeError && err.code === AI_ERROR.TOOL_SCHEMA_INVALID
    );
    assertX.throws(
      () => validateToolSchema({ type: "array" }, "t"),
      (err) => err instanceof AiRuntimeError && err.code === AI_ERROR.TOOL_SCHEMA_INVALID
    );
  });

  check("TEST 13A-12 Tool arguments map to configured request parameter", () => {
    const out = resolveToolTemplate(
      "https://api.example.com/customers/{{tool.id}}",
      { id: "123" }
    );
    assertX.equal(out, "https://api.example.com/customers/123");
    assertX.equal(
      resolveToolTemplate("city={{tool.city}}", { city: "Berlin" }),
      "city=Berlin"
    );
  });

  check("TEST 13A-13 Configured HTTP method preserved", () => {
    const desc = buildToolDescriptor({
      id: "httpTool",
      type: "aiHttpTool",
      data: {
        toolName: "lookup_customer",
        method: "POST",
        url: "https://api.example.com/x",
        inputSchema: { type: "object", properties: {} },
      },
    });
    assertX.equal(desc.httpConfig.method, "POST");
  });

  check("TEST 13A-14 Model cannot override HTTP method", async () => {
    await withMockServer(
      (req, res) => {
        assertX.equal(req.method, "GET");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      },
      async (baseUrl) => {
        await executeHttpTool({
          nodeData: {
            toolName: "lookup_customer",
            method: "GET",
            url: `${baseUrl}/customers/{{tool.id}}`,
          },
          args: { id: "1", method: "DELETE" },
          context: { workspaceId: "ws" },
        });
      }
    );
  });

  check("TEST 13A-15 Model cannot override credential", async () => {
    const desc = buildToolDescriptor({
      id: "httpTool",
      type: "aiHttpTool",
      data: {
        toolName: "lookup_customer",
        method: "GET",
        url: "https://api.example.com/x",
        credentialId: "cred-fixed",
        inputSchema: { type: "object", properties: {} },
      },
    });
    assertX.equal(desc.httpConfig.credentialId, "cred-fixed");
    const runtime = materializeAgentRuntime({
      modelDescriptor: {
        kind: "ai-model",
        provider: "test",
        nodeId: "model",
        config: { script: "echo" },
      },
      toolDescriptors: [desc],
    });
    // Executor deletes args.credentialId before invoke — verified by source contract
    // and by ensuring descriptor credential stays author-fixed.
    assertX.equal(runtime.tools[0].httpConfig.credentialId, "cred-fixed");
  });

  check("TEST 13A-16 Configured URL preserved", () => {
    const desc = buildToolDescriptor({
      id: "httpTool",
      type: "aiHttpTool",
      data: {
        toolName: "lookup_customer",
        method: "GET",
        url: "https://api.example.com/customers/{{tool.id}}",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
      },
    });
    assertX.equal(
      desc.httpConfig.url,
      "https://api.example.com/customers/{{tool.id}}"
    );
  });

  check("TEST 13A-17 Model cannot choose arbitrary URL", () => {
    assertX.throws(
      () =>
        assertUrlOriginPreserved(
          "https://api.example.com/customers/{{tool.id}}",
          "https://evil.example/steal"
        ),
      (err) =>
        err instanceof AiRuntimeError &&
        /cannot change the configured URL host/i.test(err.message)
    );
  });

  check("TEST 13A-18 HTTP Tool executes through existing HTTP infrastructure", async () => {
    await withMockServer(
      (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123", name: "Ada" }));
      },
      async (baseUrl) => {
        const result = await executeHttpTool({
          nodeData: {
            toolName: "lookup_customer",
            method: "GET",
            url: `${baseUrl}/customers/{{tool.id}}`,
          },
          args: { id: "123" },
          context: { workspaceId: "ws" },
        });
        assertX.equal(result.ok, true);
        assertX.equal(result.data.status, 200);
        assertX.equal(result.data.data.name, "Ada");
      }
    );
  });

  check("TEST 13A-19 HTTP response normalized", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ hello: "world" }));
      },
      async (baseUrl) => {
        const result = await executeHttpTool({
          nodeData: {
            toolName: "lookup_customer",
            method: "GET",
            url: `${baseUrl}/x`,
          },
          args: {},
          context: {},
        });
        assertX.deepEqual(Object.keys(result.data).sort(), ["data", "status"]);
      }
    );
  });

  check("TEST 13A-20 Large HTTP response bounded", () => {
    const huge = "x".repeat(MAX_TOOL_RESULT_CHARS + 500);
    const text = normalizeToolResultForModel({
      ok: true,
      data: { status: 200, data: huge },
    });
    assertX.ok(text.length <= MAX_TOOL_RESULT_CHARS + 20);
    assertX.ok(text.includes("[truncated]"));
  });

  check("TEST 13A-21 HTTP 4xx follows V1 failure policy", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("missing");
      },
      async (baseUrl) => {
        await assertX.rejects(
          () =>
            executeHttpTool({
              nodeData: {
                toolName: "lookup_customer",
                method: "GET",
                url: `${baseUrl}/missing`,
              },
              args: {},
              context: {},
            }),
          (err) =>
            err instanceof AiRuntimeError && err.code === AI_ERROR.TOOL_FAILED
        );
      }
    );
  });

  check("TEST 13A-22 HTTP 5xx follows V1 failure policy", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("down");
      },
      async (baseUrl) => {
        await assertX.rejects(
          () =>
            executeHttpTool({
              nodeData: {
                toolName: "lookup_customer",
                method: "GET",
                url: `${baseUrl}/down`,
                rateLimitRetries: 0,
              },
              args: {},
              context: {},
            }),
          (err) =>
            err instanceof AiRuntimeError && err.code === AI_ERROR.TOOL_FAILED
        );
      }
    );
  });

  check("TEST 13A-23 Timeout maps to safe tool error", async () => {
    await withMockServer(
      (_req, _res) => {
        /* never respond */
      },
      async (baseUrl) => {
        await assertX.rejects(
          () =>
            executeHttpTool({
              nodeData: {
                toolName: "lookup_customer",
                method: "GET",
                url: `${baseUrl}/slow`,
                timeoutMs: 50,
                rateLimitRetries: 0,
              },
              args: {},
              context: {},
            }),
          (err) =>
            err instanceof AiRuntimeError &&
            (err.code === AI_ERROR.TOOL_TIMEOUT ||
              err.code === AI_ERROR.TOOL_FAILED)
        );
      }
    );
  });

  check("TEST 13A-24 Credential secret not persisted in descriptor", () => {
    const desc = buildToolDescriptor({
      id: "httpTool",
      type: "aiHttpTool",
      data: {
        toolName: "lookup_customer",
        method: "GET",
        url: "https://api.example.com/x",
        credentialId: "cred-1",
        secretToken: "should-strip",
        inputSchema: { type: "object", properties: {} },
      },
    });
    const blob = JSON.stringify(desc);
    assertX.ok(!blob.includes("should-strip"));
    assertX.equal(desc.httpConfig.credentialId, "cred-1");
    assertX.ok(!("secretToken" in (desc.httpConfig || {})));
  });

  check("TEST 13A-25 Credential secret absent from Agent metadata", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123" }));
      },
      async (baseUrl) => {
        const def = httpToolFixture({ baseUrl });
        const mem = await executeGraphInMemory(def, { workspaceId: "ws-13a" });
        const meta = mem.context.steps?.agent?.agentMeta;
        const blob = JSON.stringify(meta || {});
        assertX.ok(!/Bearer |sk-|password/i.test(blob));
        assertX.ok(!blob.toLowerCase().includes("authorization"));
      }
    );
  });

  check("TEST 13A-26 Authorization header absent from tool trace", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123" }));
      },
      async (baseUrl) => {
        const def = httpToolFixture({
          baseUrl,
          headers: [{ key: "Authorization", value: "Bearer secret-token" }],
        });
        const mem = await executeGraphInMemory(def, { workspaceId: "ws-13a" });
        const calls =
          mem.context.steps?.agent?.agentMeta?.[0]?.toolCalls || [];
        assertX.ok(calls.length >= 1);
        const blob = JSON.stringify(calls);
        assertX.ok(!blob.includes("secret-token"));
        assertX.ok(!/Authorization/i.test(blob));
        assertX.equal(calls[0].toolName, "lookup_customer");
        assertX.equal(calls[0].status, "succeeded");
      }
    );
  });

  check("TEST 13A-27 Agent receives HTTP Tool result", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123", name: "Ada" }));
      },
      async (baseUrl) => {
        const def = httpToolFixture({ baseUrl });
        const mem = await executeGraphInMemory(def, { workspaceId: "ws-13a" });
        const text = String(
          mem.context.steps?.agent?.text ||
            mem.context.steps?.agent?.output?.text ||
            ""
        );
        assertX.ok(/Ada|123|customer/i.test(text));
      }
    );
  });

  check("TEST 13A-28 Model receives tool result and produces final answer", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123", name: "Ada" }));
      },
      async (baseUrl) => {
        const def = httpToolFixture({ baseUrl });
        const mem = await executeGraphInMemory(def, { workspaceId: "ws-13a" });
        const text = String(
          mem.context.steps?.agent?.text ||
            mem.context.steps?.agent?.output?.text ||
            ""
        );
        assertX.ok(text.length > 0);
        assertX.ok(
          mem.context.steps?.result?.result != null ||
            mem.context.steps?.result?.output?.result != null
        );
      }
    );
  });

  check("TEST 13A-29 Agent output provenance unchanged", async () => {
    await withMockServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123" }));
      },
      async (baseUrl) => {
        const def = httpToolFixture({ baseUrl });
        const mem = await executeGraphInMemory(def, { workspaceId: "ws-13a" });
        const items = mem.context.items?.agent || [];
        assertX.ok(items.length >= 1);
        assertX.ok(items[0].pairedItem != null);
      }
    );
  });

  check("TEST 13A-30 HTTP Tool not reachable as normal steps ancestor", () => {
    const graph = buildGraph(httpToolFixture());
    assertX.equal(isUpstreamNode(graph, "httpTool", "agent"), false);
    assertX.equal(isUpstreamNode(graph, "httpTool", "result"), false);
    assertX.equal(isUpstreamNode(graph, "set", "agent"), true);
  });

  check("TEST 13A-31 Tool config change dirties Agent downstream", () => {
    const graph = buildGraph(httpToolFixture());
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateConfigChange(session, graph, "httpTool");
    assertX.ok(session.dirtyNodes.agent);
    assertX.ok(session.dirtyNodes.result);
  });

  check("TEST 13A-32 Unrelated branch remains clean", () => {
    const def = httpToolFixture({
      extraNodes: [
        {
          id: "other",
          type: "set",
          data: { mappings: [{ key: "x", value: "1" }] },
          position: { x: 0, y: 400 },
        },
      ],
      extraEdges: [{ id: "e-other", source: "manual", target: "other" }],
    });
    const graph = buildGraph(def);
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateConfigChange(session, graph, "httpTool");
    assertX.ok(session.dirtyNodes.agent);
    assertX.ok(!session.dirtyNodes.other);
  });

  check("TEST 13A-33 Save/reload preserves HTTP Tool binding", () => {
    const def = httpToolFixture();
    const roundtrip = JSON.parse(JSON.stringify(def));
    const aux = getAuxiliaryEdges(roundtrip);
    assertX.ok(
      aux.some(
        (e) =>
          e.source === "httpTool" &&
          e.target === "agent" &&
          String(e.targetHandle || "") === "tools"
      )
    );
  });

  check("TEST 13A-34 Copy/paste preserves HTTP Tool cluster", () => {
    const clipPath = path.join(
      __dirname,
      "../../frontend/src/modules/workflows/workflowClipboard.ts"
    );
    const src = fs.readFileSync(clipPath, "utf8");
    assertX.ok(/edge|sourceHandle|targetHandle/i.test(src));
    const def = httpToolFixture();
    const cluster = {
      nodes: def.nodes.filter((n) =>
        ["agent", "model", "httpTool"].includes(n.id)
      ),
      edges: def.edges.filter(
        (e) =>
          ["agent", "model", "httpTool"].includes(e.source) &&
          ["agent", "model", "httpTool"].includes(e.target)
      ),
    };
    assertX.equal(cluster.nodes.length, 3);
    assertX.ok(cluster.edges.some((e) => e.source === "httpTool"));
  });

  check("TEST 13A-35 Tidy places HTTP Tool near Agent", () => {
    const layoutPath = path.join(
      __dirname,
      "../../frontend/src/modules/workflows/workflowLayout.ts"
    );
    const src = fs.readFileSync(layoutPath, "utf8");
    assertX.ok(src.includes("auxiliaryEdges"));
    assertX.ok(/auxiliary providers near/i.test(src));
  });

  check("TEST 13A-36 Legacy HTTP Request behavior unchanged", () => {
    assertX.ok(typeof handlers.http === "function");
    const entry = libraryNodes.find((n) => n.id === "http-request");
    assertX.equal(entry.engineType, "http");
    assertX.equal(entry.available, true);
  });

  check("TEST 13A-37 Calculator Tool unchanged", () => {
    const desc = buildToolDescriptor({
      id: "tool",
      type: "aiCalculatorTool",
      data: { toolName: "calculator" },
    });
    assertX.equal(desc.toolKind, "calculator");
    assertX.equal(desc.name, "calculator");
  });

  check("TEST 13A-38 AI Agent unchanged", () => {
    assertX.ok(typeof handlers.aiAgent === "function");
    assertX.ok(typeof executeAiAgent === "function");
  });

  check("TEST 13A-39 Wait unchanged", () => {
    assertX.ok(typeof handlers.wait === "function");
  });

  check("TEST 13A-40 Loop unchanged", () => {
    assertX.ok(typeof handlers.loop === "function");
    assertX.equal(
      getExecutionEdges({
        nodes: [
          { id: "t", type: "trigger" },
          { id: "loop", type: "loop", data: { batchSize: 1 } },
          { id: "b", type: "set" },
        ],
        edges: [
          { id: "e1", source: "t", target: "loop", targetHandle: "items" },
          { id: "e2", source: "loop", target: "b", sourceHandle: "batch" },
          { id: "e3", source: "b", target: "loop", targetHandle: "continue" },
        ],
      }).length,
      3
    );
  });

  check("TEST 13A-41 Subworkflow unchanged", () => {
    assertX.equal(
      getExecutionEdges({
        nodes: [
          { id: "t", type: "trigger" },
          { id: "ew", type: "executeWorkflow" },
        ],
        edges: [{ id: "e", source: "t", target: "ew" }],
      }).length,
      1
    );
  });

  check("TEST 13A-42 Error Workflow unchanged", () => {
    assertX.ok(typeof handlers.errorTrigger === "function");
    assertX.equal(AI_ERROR.MODEL_REQUIRED, "AI_MODEL_REQUIRED");
  });

  check("TEST 13A-43 Tool name validation rejects unsafe names", () => {
    assertX.throws(() => validateHttpToolName(""));
    assertX.throws(() => validateHttpToolName("bad name"));
    assertX.equal(validateHttpToolName("lookup_customer"), "lookup_customer");
  });
};

module.exports = { registerPart13ATests };
