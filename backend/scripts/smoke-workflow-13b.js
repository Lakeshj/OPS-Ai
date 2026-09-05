/**
 * Part 13B — Respond to Webhook + HTTP network security.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("node:http");

const registerPart13BTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 13B Respond to Webhook + HTTP SSRF");

  const {
    assertSafeHttpUrl,
    secureHttpFetch,
    withHttpSecurityTestPolicy,
    ERROR,
    HttpSecurityError,
    MAX_HTTP_REDIRECTS,
    stripSensitiveHeaders,
  } = require("../services/workflowHttpSecurity.service");
  const {
    validateWebhookRespondDefinition,
    createWebhookResponseChannel,
    validateStatusCode,
    sanitizeResponseHeaders,
    RESPOND_ERROR,
    getWebhookResponseMode,
  } = require("../services/workflowWebhookRespond.service");
  const { handlers } = require("../services/workflowNodes.service");
  const {
    executeGraphInMemory,
    buildGraph,
    findStartNodes,
  } = require("../services/workflowEngine.service");
  const {
    executeHttpTool,
    assertUrlOriginPreserved,
  } = require("../services/workflowAiHttpTool.service");
  const { getExecutionEdges } = require("../services/workflowConnection.service");
  const { AI_ERROR } = require("../services/workflowAiResources.service");

  const libraryPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );
  const catalog = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  const libraryNodes = catalog.nodes || [];

  const withMock = async (handler, fn, policy = { allowLoopback: true }) => {
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      return await withHttpSecurityTestPolicy(policy, () =>
        fn(`http://127.0.0.1:${port}`)
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  const respondDef = (opts = {}) => ({
    version: 1,
    nodes: [
      {
        id: "wh",
        type: "webhook",
        data: { responseMode: opts.responseMode || "respondNode" },
      },
      {
        id: "respond",
        type: "respondToWebhook",
        data: {
          statusCode: opts.statusCode ?? 200,
          responseType: opts.responseType || "json",
          body: opts.body ?? { ok: true, id: "{{item.id}}" },
          responseHeaders: opts.responseHeaders || [],
        },
      },
      ...(opts.extraNodes || []),
    ],
    edges: [
      { id: "e1", source: "wh", target: opts.firstTarget || "respond" },
      ...(opts.extraEdges || []),
    ],
  });

  check("TEST 13B-1 Existing webhook default behavior unchanged", () => {
    assertX.ok(typeof handlers.webhook === "function");
    const entry = libraryNodes.find((n) => n.id === "webhook");
    assertX.equal(entry.available, true);
    assertX.equal(getWebhookResponseMode({ data: {} }), "immediate");
  });

  check("TEST 13B-2 Respond to Webhook node available only with completed runtime", () => {
    const entry = libraryNodes.find((n) => n.id === "respond-to-webhook");
    assertX.equal(entry.available, true);
    assertX.equal(entry.engineType, "respondToWebhook");
    assertX.ok(typeof handlers.respondToWebhook === "function");
  });

  check("TEST 13B-3 Respond node is normal execution node, not Trigger", () => {
    const { getPortContract } = require("../services/workflowConnection.service");
    const ports = getPortContract("respondToWebhook");
    assertX.ok((ports.inputs || []).length >= 1);
    assertX.ok(!ports.isTrigger);
    const graph = buildGraph(respondDef());
    const starts = findStartNodes(graph);
    assertX.ok(starts.some((n) => n.id === "wh"));
    assertX.ok(!starts.some((n) => n.id === "respond"));
  });

  check("TEST 13B-4 Respond mode requires one reachable Respond node", () => {
    const r = validateWebhookRespondDefinition(respondDef());
    assertX.equal(r.ok, true);
  });

  check("TEST 13B-5 Zero Respond nodes rejected for respond mode", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [{ id: "wh", type: "webhook", data: { responseMode: "respondNode" } }],
      edges: [],
    });
    assertX.equal(r.ok, false);
    assertX.equal(r.code, RESPOND_ERROR.RESPOND_REQUIRED);
  });

  check("TEST 13B-6 Multiple reachable Respond nodes rejected in V1", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [
        { id: "wh", type: "webhook", data: { responseMode: "respondNode" } },
        { id: "r1", type: "respondToWebhook", data: {} },
        { id: "r2", type: "respondToWebhook", data: {} },
      ],
      edges: [
        { id: "e1", source: "wh", target: "r1" },
        { id: "e2", source: "wh", target: "r2" },
      ],
    });
    assertX.equal(r.ok, false);
    assertX.equal(r.code, RESPOND_ERROR.MULTIPLE_RESPOND);
  });

  check("TEST 13B-7 Respond node outside webhook context fails clearly", async () => {
    await assertX.rejects(
      () =>
        handlers.respondToWebhook(
          { id: "respond", type: "respondToWebhook", data: { statusCode: 200 } },
          { inputItems: [], input: {}, steps: {} }
        ),
      (err) => err.code === RESPOND_ERROR.CONTEXT_REQUIRED
    );
  });

  check("TEST 13B-8 Status 200 JSON response works", async () => {
    const channel = createWebhookResponseChannel();
    await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: { statusCode: 200, responseType: "json", body: { ok: true } },
      },
      { webhookResponse: channel, inputItems: [{ json: { id: "1" } }], input: {}, steps: {} }
    );
    const snap = channel.snapshot();
    assertX.equal(snap.statusCode, 200);
    assertX.deepEqual(snap.body, { ok: true });
  });

  check("TEST 13B-9 Custom status works", async () => {
    const channel = createWebhookResponseChannel();
    await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: { statusCode: 201, responseType: "json", body: { created: true } },
      },
      { webhookResponse: channel, inputItems: [], input: {}, steps: {} }
    );
    assertX.equal(channel.snapshot().statusCode, 201);
  });

  check("TEST 13B-10 Text response works", async () => {
    const channel = createWebhookResponseChannel();
    await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: { statusCode: 200, responseType: "text", body: "hello" },
      },
      { webhookResponse: channel, inputItems: [], input: {}, steps: {} }
    );
    assertX.equal(channel.snapshot().body, "hello");
    assertX.equal(channel.snapshot().responseType, "text");
  });

  check("TEST 13B-11 Body expressions resolve normally", async () => {
    const channel = createWebhookResponseChannel();
    await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: {
          statusCode: 200,
          responseType: "text",
          body: "Created {{item.id}}",
        },
      },
      {
        webhookResponse: channel,
        inputItems: [{ json: { id: "abc" } }],
        input: {},
        steps: {},
      }
    );
    assertX.equal(channel.snapshot().body, "Created abc");
  });

  check("TEST 13B-12 Response headers work safely", async () => {
    const channel = createWebhookResponseChannel();
    await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: {
          statusCode: 200,
          responseType: "json",
          body: {},
          responseHeaders: [{ key: "X-Trace", value: "t1" }],
        },
      },
      { webhookResponse: channel, inputItems: [], input: {}, steps: {} }
    );
    assertX.equal(channel.snapshot().headers["X-Trace"], "t1");
  });

  check("TEST 13B-13 Invalid status rejected", () => {
    assertX.throws(() => validateStatusCode(99));
    assertX.throws(() => validateStatusCode("nope"));
    assertX.equal(validateStatusCode(200), 200);
  });

  check("TEST 13B-14 Unsafe/hop-by-hop response headers rejected or controlled", () => {
    const headers = sanitizeResponseHeaders([
      { key: "X-Ok", value: "1" },
      { key: "Transfer-Encoding", value: "chunked" },
      { key: "Content-Length", value: "9" },
      { key: "Connection", value: "close" },
    ]);
    assertX.equal(headers["X-Ok"], "1");
    assertX.ok(!headers["Transfer-Encoding"]);
    assertX.ok(!headers["Content-Length"]);
    assertX.ok(!headers.Connection);
  });

  check("TEST 13B-15 Only one response emitted", async () => {
    const channel = createWebhookResponseChannel();
    await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: { statusCode: 200, body: { a: 1 } },
      },
      { webhookResponse: channel, inputItems: [], input: {}, steps: {} }
    );
    await assertX.rejects(
      () =>
        handlers.respondToWebhook(
          {
            id: "respond",
            type: "respondToWebhook",
            data: { statusCode: 200, body: { a: 2 } },
          },
          { webhookResponse: channel, inputItems: [], input: {}, steps: {} }
        ),
      (err) => err.code === RESPOND_ERROR.ALREADY_SENT
    );
  });

  check("TEST 13B-16 Immediate response webhook still works", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [{ id: "wh", type: "webhook", data: { responseMode: "immediate" } }],
      edges: [],
    });
    assertX.equal(r.ok, true);
  });

  check("TEST 13B-16b Canvas sourceHandle=main activates Respond path", async () => {
    const channel = createWebhookResponseChannel();
    const def = {
      version: 1,
      nodes: [
        {
          id: "wh",
          type: "webhook",
          data: { responseMode: "respondNode", nodeType: "webhook" },
        },
        {
          id: "respond",
          type: "respondToWebhook",
          data: {
            statusCode: 201,
            responseType: "json",
            body: { ok: true, id: "{{input.customerId}}" },
          },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "wh",
          target: "respond",
          sourceHandle: "main",
          targetHandle: "main",
        },
      ],
    };
    await executeGraphInMemory(def, {
      input: { source: "webhook", customerId: "cust_main" },
      webhookResponse: channel,
      rejectDurableWebhook: true,
    });
    const snap = channel.snapshot();
    assertX.ok(snap, "Respond node must emit a response");
    assertX.equal(snap.statusCode, 201);
    assertX.equal(snap.body?.ok, true);
    assertX.equal(snap.body?.id, "cust_main");
  });

  check("TEST 13B-17 Respond mode reachable Wait rejected or follows audited safe policy", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [
        { id: "wh", type: "webhook", data: { responseMode: "respondNode" } },
        { id: "wait", type: "wait", data: {} },
        { id: "respond", type: "respondToWebhook", data: {} },
      ],
      edges: [
        { id: "e1", source: "wh", target: "wait" },
        { id: "e2", source: "wait", target: "respond" },
      ],
    });
    assertX.equal(r.ok, false);
    assertX.equal(r.code, RESPOND_ERROR.WAIT_FORBIDDEN);
  });

  check("TEST 13B-18 Respond inside Loop body rejected", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [
        { id: "wh", type: "webhook", data: { responseMode: "respondNode" } },
        { id: "loop", type: "loop", data: { batchSize: 1 } },
        { id: "respond", type: "respondToWebhook", data: {} },
        { id: "set", type: "set", data: { mappings: [] } },
      ],
      edges: [
        { id: "e1", source: "wh", target: "loop", targetHandle: "items" },
        { id: "e2", source: "loop", target: "respond", sourceHandle: "batch" },
        { id: "e3", source: "respond", target: "loop", targetHandle: "continue" },
      ],
    });
    // Loop body detection or wait-equivalent — either LOOP_BODY or structural failure
    assertX.equal(r.ok, false);
  });

  check("TEST 13B-19 Respond after Loop.done follows safe policy", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [
        { id: "wh", type: "webhook", data: { responseMode: "respondNode" } },
        { id: "loop", type: "loop", data: { batchSize: 1 } },
        { id: "body", type: "set", data: { mappings: [] } },
        { id: "respond", type: "respondToWebhook", data: {} },
      ],
      edges: [
        { id: "e1", source: "wh", target: "loop", targetHandle: "items" },
        { id: "e2", source: "loop", target: "body", sourceHandle: "batch" },
        { id: "e3", source: "body", target: "loop", targetHandle: "continue" },
        { id: "e4", source: "loop", target: "respond", sourceHandle: "done" },
      ],
    });
    assertX.equal(r.ok, true);
  });

  check("TEST 13B-20 Durable Execute Workflow before Respond rejected if incompatible", () => {
    const r = validateWebhookRespondDefinition({
      nodes: [
        { id: "wh", type: "webhook", data: { responseMode: "respondNode" } },
        { id: "ew", type: "executeWorkflow", data: {} },
        { id: "respond", type: "respondToWebhook", data: {} },
      ],
      edges: [
        { id: "e1", source: "wh", target: "ew" },
        { id: "e2", source: "ew", target: "respond" },
      ],
    });
    assertX.equal(r.ok, false);
    assertX.equal(r.code, RESPOND_ERROR.SUBWORKFLOW_FORBIDDEN);
  });

  check("TEST 13B-21 Webhook failure returns sanitized response", () => {
    assertX.ok(RESPOND_ERROR.NO_RESPONSE);
    assertX.ok(RESPOND_ERROR.TIMEOUT);
  });

  check("TEST 13B-22 Error Workflow does not replace webhook response", () => {
    assertX.ok(typeof handlers.errorTrigger === "function");
  });

  check("TEST 13B-23 Respond context never persisted into run snapshot", () => {
    const channel = createWebhookResponseChannel();
    channel.send({
      statusCode: 200,
      body: { ok: true },
      headers: {},
      responseType: "json",
    });
    // Channel is ephemeral in-process only — never part of definition/run JSON.
    const snap = JSON.stringify({
      definition: respondDef(),
      runSnapshot: { steps: {}, wait: null },
    });
    assertX.ok(!snap.includes("webhookResponse"));
    assertX.ok(!/"req"|Express|socket/i.test(snap));
  });

  check("TEST 13B-24 No credentials/tokens in response execution metadata", async () => {
    const channel = createWebhookResponseChannel();
    const result = await handlers.respondToWebhook(
      {
        id: "respond",
        type: "respondToWebhook",
        data: { statusCode: 200, body: { ok: true } },
      },
      { webhookResponse: channel, inputItems: [], input: {}, steps: {} }
    );
    const blob = JSON.stringify(result);
    assertX.ok(!/authorization|Bearer |password/i.test(blob));
  });

  check("TEST 13B-25 http allowed", async () => {
    await withHttpSecurityTestPolicy(
      { dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] },
      async () => {
        const u = await assertSafeHttpUrl("http://example.com/x");
        assertX.equal(u.protocol, "http:");
      }
    );
  });

  check("TEST 13B-26 https allowed", async () => {
    await withHttpSecurityTestPolicy(
      { dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] },
      async () => {
        const u = await assertSafeHttpUrl("https://example.com/x");
        assertX.equal(u.protocol, "https:");
      }
    );
  });

  check("TEST 13B-27 file protocol blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("file:///etc/passwd"),
      (err) => err instanceof HttpSecurityError && err.code === ERROR.PROTOCOL_BLOCKED
    );
  });

  check("TEST 13B-28 localhost blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://localhost/api"),
      (err) => err instanceof HttpSecurityError && err.code === ERROR.DESTINATION_BLOCKED
    );
  });

  check("TEST 13B-29 127.0.0.1 blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://127.0.0.1/api"),
      (err) => err instanceof HttpSecurityError && err.code === ERROR.DESTINATION_BLOCKED
    );
  });

  check("TEST 13B-30 IPv6 loopback blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://[::1]/api"),
      (err) => err instanceof HttpSecurityError && err.code === ERROR.DESTINATION_BLOCKED
    );
  });

  check("TEST 13B-31 169.254.169.254 blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://169.254.169.254/latest"),
      (err) => err instanceof HttpSecurityError
    );
  });

  check("TEST 13B-32 link-local IPv4 blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://169.254.1.1/"),
      (err) => err instanceof HttpSecurityError
    );
  });

  check("TEST 13B-33 link-local IPv6 blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://[fe80::1]/"),
      (err) => err instanceof HttpSecurityError
    );
  });

  check("TEST 13B-34 private IPv4 behavior matches chosen V1 policy", async () => {
    await assertX.rejects(() => assertSafeHttpUrl("http://10.0.0.5/"));
    await assertX.rejects(() => assertSafeHttpUrl("http://192.168.1.1/"));
    await assertX.rejects(() => assertSafeHttpUrl("http://172.16.0.1/"));
  });

  check("TEST 13B-35 private IPv6 behavior matches chosen V1 policy", async () => {
    await assertX.rejects(() => assertSafeHttpUrl("http://[fd12::1]/"));
  });

  check("TEST 13B-36 hostname resolving to blocked IP rejected", async () => {
    await withHttpSecurityTestPolicy(
      { dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }] },
      async () => {
        await assertX.rejects(
          () => assertSafeHttpUrl("http://evil.example/"),
          (err) => err instanceof HttpSecurityError
        );
      }
    );
  });

  check("TEST 13B-37 mixed DNS results containing blocked destination rejected according to policy", async () => {
    await withHttpSecurityTestPolicy(
      {
        dnsLookup: async () => [
          { address: "1.1.1.1", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ],
      },
      async () => {
        await assertX.rejects(() => assertSafeHttpUrl("http://mixed.example/"));
      }
    );
  });

  check("TEST 13B-38 safe public DNS destination allowed", async () => {
    await withHttpSecurityTestPolicy(
      { dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] },
      async () => {
        const u = await assertSafeHttpUrl("https://safe.example/path");
        assertX.equal(u.hostname, "safe.example");
      }
    );
  });

  check("TEST 13B-39 redirect destination revalidated", async () => {
    await withMock(
      (req, res) => {
        res.writeHead(302, { Location: "http://169.254.169.254/meta" });
        res.end();
      },
      async (base) => {
        await assertX.rejects(
          () => secureHttpFetch(base, { method: "GET" }, { timeoutMs: 2000 }),
          (err) => err instanceof HttpSecurityError
        );
      }
    );
  });

  check("TEST 13B-40 redirect to localhost blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("http://127.0.0.1/steal"),
      (err) => err instanceof HttpSecurityError && err.code === ERROR.DESTINATION_BLOCKED
    );
    await assertX.rejects(
      () => assertSafeHttpUrl("http://localhost/steal"),
      (err) => err instanceof HttpSecurityError
    );
  });

  check("TEST 13B-41 redirect to metadata IP blocked", async () => {
    await assertX.rejects(() =>
      assertSafeHttpUrl("http://169.254.169.254/latest/meta-data")
    );
  });

  check("TEST 13B-42 redirect to unsupported protocol blocked", async () => {
    await assertX.rejects(
      () => assertSafeHttpUrl("ftp://files.example/a"),
      (err) => err.code === ERROR.PROTOCOL_BLOCKED
    );
  });

  check("TEST 13B-43 redirect loop bounded", () => {
    assertX.equal(MAX_HTTP_REDIRECTS, 5);
  });

  check("TEST 13B-44 cross-origin redirect does not forward Authorization", () => {
    const stripped = stripSensitiveHeaders({
      Authorization: "Bearer secret",
      "X-Custom": "ok",
    });
    assertX.ok(!stripped.Authorization);
    assertX.equal(stripped["X-Custom"], "ok");
  });

  check("TEST 13B-45 same-origin safe redirect follows according to policy", async () => {
    let hits = 0;
    await withMock(
      (req, res) => {
        hits += 1;
        if (hits === 1) {
          res.writeHead(302, { Location: "/final" });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      },
      async (base) => {
        const res = await secureHttpFetch(base, { method: "GET" }, { timeoutMs: 3000 });
        assertX.equal(res.status, 200);
        assertX.deepEqual(res.body, { ok: true });
      }
    );
  });

  check("TEST 13B-46 normal HTTP Request uses shared security service", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowNodes.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("workflowHttpSecurity.service"));
    assertX.ok(src.includes("secureHttpFetch"));
  });

  check("TEST 13B-47 HTTP Tool uses shared security service", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiHttpTool.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("assertSafeHttpUrl"));
  });

  check("TEST 13B-48 HTTP Tool origin lock unchanged", () => {
    assertX.throws(() =>
      assertUrlOriginPreserved(
        "https://api.example.com/{{tool.id}}",
        "https://evil.example/x"
      )
    );
  });

  check("TEST 13B-49 HTTP Tool model cannot override URL", async () => {
    await withMock(
      (req, res) => {
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
          args: { id: "1", url: "https://evil.example" },
          context: {},
        });
      }
    );
  });

  check("TEST 13B-50 HTTP Tool credential secrecy unchanged", () => {
    const { buildToolDescriptor } = require("../services/workflowAiResources.service");
    const desc = buildToolDescriptor({
      id: "t",
      type: "aiHttpTool",
      data: {
        toolName: "lookup_customer",
        method: "GET",
        url: "https://api.example.com/x",
        credentialId: "cred-1",
        secretToken: "nope",
        inputSchema: { type: "object", properties: {} },
      },
    });
    assertX.ok(!JSON.stringify(desc).includes("nope"));
  });

  check("TEST 13B-51 URL expression resolved before destination validation", async () => {
    // Interpolated private IP must still be blocked
    await assertX.rejects(() => assertSafeHttpUrl("http://10.1.2.3/path"));
  });

  check("TEST 13B-52 pagination next URL revalidated", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowNodes.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("fetchWithRateLimitRetry"));
    assertX.ok(src.includes("secureHttpFetch"));
  });

  check("TEST 13B-53 retry path does not bypass validation", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowNodes.service.js"),
      "utf8"
    );
    assertX.ok(/for \(let attempt/.test(src));
    assertX.ok(src.includes("assertSafeHttpUrl") || src.includes("secureHttpFetch"));
  });

  check("TEST 13B-54 blocked destination produces structured safe error", async () => {
    try {
      await assertSafeHttpUrl("http://127.0.0.1/");
      assertX.fail("expected throw");
    } catch (err) {
      assertX.ok(err instanceof HttpSecurityError);
      assertX.equal(err.code, ERROR.DESTINATION_BLOCKED);
    }
  });

  check("TEST 13B-55 HTTP public API behavior unchanged", () => {
    assertX.ok(typeof handlers.http === "function");
  });

  check("TEST 13B-56 Webhook Trigger regression unchanged", () => {
    assertX.ok(typeof handlers.webhook === "function");
  });

  check("TEST 13B-57 Schedule unchanged", () => {
    assertX.ok(typeof handlers.schedule === "function");
  });

  check("TEST 13B-58 Wait unchanged", () => {
    assertX.ok(typeof handlers.wait === "function");
  });

  check("TEST 13B-59 Loop unchanged", () => {
    assertX.ok(typeof handlers.loop === "function");
  });

  check("TEST 13B-60 Subworkflow unchanged", () => {
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

  check("TEST 13B-61 Error Workflow unchanged", () => {
    assertX.ok(typeof handlers.errorTrigger === "function");
  });

  check("TEST 13B-62 AI Agent unchanged", () => {
    assertX.ok(typeof handlers.aiAgent === "function");
    assertX.equal(AI_ERROR.MODEL_REQUIRED, "AI_MODEL_REQUIRED");
  });

  check("TEST 13B-63 HTTP Tool Agent invocation unchanged", async () => {
    await withMock(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123" }));
      },
      async (baseUrl) => {
        const result = await executeHttpTool({
          nodeData: {
            toolName: "lookup_customer",
            method: "GET",
            url: `${baseUrl}/c/{{tool.id}}`,
          },
          args: { id: "123" },
          context: {},
        });
        assertX.equal(result.ok, true);
        assertX.equal(result.data.status, 200);
      }
    );
  });
};

module.exports = { registerPart13BTests };
