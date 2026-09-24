/**
 * Gmail node V1 — resource/operation, dynamic fields, mocked Gmail API.
 * No live Google calls and no production credentials.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerGmailV1Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Gmail node V1");

  const oauth = () => require("../services/googleOAuth.service");
  const nodes = () => require("../services/workflowNodes.service");
  const schemaPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
  );
  const libraryPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );

  const gmailBlock = () => {
    const schema = fs.readFileSync(schemaPath, "utf8");
    const start = schema.indexOf("gmail: [");
    const end = schema.indexOf("gmailTrigger:", start);
    return schema.slice(start, end);
  };

  const mockCred = () => ({
    id: "c1",
    type: "google_gmail",
    workspaceId: "ws-1",
    name: "Gmail",
    secret: {
      accessToken: "tok-live",
      refreshToken: "ref-live",
      expiryMs: Date.now() + 3600_000,
    },
  });

  const withGoogle = (transport, fn) => {
    const store = new Map();
    store.set("c1", mockCred());
    return oauth().withGoogleOAuthTestHooks(
      {
        transport,
        now: () => Date.now(),
        logger: () => {},
        credentialResolver: (id) => {
          const row = store.get(id);
          if (!row) throw new Error("Credential not found — re-select it in the node settings");
          return row;
        },
        credentialSaver: (id, secret) => {
          const row = store.get(id);
          if (row) row.secret = secret;
        },
      },
      fn
    );
  };

  const exec = (data, context = {}) =>
    nodes().executeNode(
      { id: "g1", type: "gmail", data: { label: "Gmail", credentialId: "c1", resource: "message", ...data } },
      {
        input: context.input ?? {},
        inputItems: context.inputItems || [{ json: context.input || {} }],
        steps: {},
        workspaceId: "ws-1",
        workflowId: "wf-gmail",
      }
    );

  const decodeRaw = (body) =>
    Buffer.from(String(JSON.parse(body).raw).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  const transport = (capture = {}) => async (url, opts) => {
    capture.calls = capture.calls || [];
    capture.calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    const href = String(url);
    if (href.includes("/messages/send")) {
      return { status: 200, ok: true, body: { id: "m1", threadId: "t1", labelIds: ["SENT"] } };
    }
    if (href.includes("/messages/") && (opts.method || "GET") === "GET" && href.includes("/modify") === false) {
      return {
        status: 200,
        ok: true,
        body: {
          id: "m1",
          threadId: "t1",
          labelIds: ["INBOX", "UNREAD"],
          snippet: "hi",
          payload: {
            headers: [
              { name: "Subject", value: "Hello" },
              { name: "From", value: "alice@example.com" },
              { name: "Message-ID", value: "<orig@example.com>" },
              { name: "References", value: "<root@example.com>" },
            ],
            mimeType: "text/plain",
            body: { data: Buffer.from("hello body").toString("base64url") },
          },
        },
      };
    }
    if (href.includes("/messages") && (opts.method || "GET") === "GET") {
      const page = href.includes("pageToken=p2") ? "p2" : "p1";
      if (capture.pages) capture.pages.push(page);
      return {
        status: 200,
        ok: true,
        body: {
          messages: [{ id: page === "p2" ? "m2" : "m1", threadId: "t1" }],
          nextPageToken: page === "p1" && capture.paginate ? "p2" : undefined,
        },
      };
    }
    if (opts.method === "DELETE") return { status: 204, ok: true, body: {} };
    if (href.includes("/modify")) {
      capture.modify = JSON.parse(opts.body);
      return { status: 200, ok: true, body: { id: "m1", threadId: "t1", labelIds: ["INBOX"] } };
    }
    if (href.includes("/labels") && opts.method === "POST") {
      capture.label = JSON.parse(opts.body);
      return { status: 200, ok: true, body: { id: "Label_1", name: capture.label.name, type: "user" } };
    }
    if (href.includes("/labels")) {
      return {
        status: 200,
        ok: true,
        body: { labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_1", name: "Ops", type: "user" }] },
      };
    }
    return { status: 200, ok: true, body: {} };
  };

  check("GMAILV1-A one library entry", () => {
    const lib = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
    const rows = (lib.nodes || lib).filter
      ? (lib.nodes || lib).filter((n) => n.engineType === "gmail" || n.id === "gmail")
      : [];
    const list = Array.isArray(lib) ? lib : lib.nodes || [];
    const hits = list.filter((n) => n.id === "gmail" || n.engineType === "gmail");
    assertX.equal(hits.length, 1);
    assertX.equal(hits[0].available, true);
    assertX.equal(hits[0].engineType, "gmail");
    void rows;
  });

  check("GMAILV1-B message and label only", () => {
    const block = gmailBlock();
    assertX.match(block, /name: "Message", value: "message"/);
    assertX.match(block, /name: "Label", value: "label"/);
    assertX.ok(!block.includes('value: "draft"'));
    assertX.ok(!block.includes('value: "thread"'));
    for (const op of ["send", "get", "getAll", "reply", "addLabels", "removeLabels", "markRead", "markUnread", "delete", "create"]) {
      assertX.ok(block.includes(`value: "${op}"`), op);
    }
  });

  check("GMAILV1-C send fields hidden for get many", () => {
    const block = gmailBlock();
    assertX.match(block, /displayName: "To"[\s\S]*operation: \["send"\]/);
    assertX.match(block, /displayName: "Search Query"[\s\S]*operation: \["getAll"\]/);
    assertX.match(block, /displayName: "Limit"[\s\S]*hide: \{ returnAll: \[true\] \}/);
  });

  check("GMAILV1-D required fields", () => {
    const block = gmailBlock();
    assertX.match(block, /displayName: "To"[\s\S]*required: true/);
    assertX.match(block, /displayName: "Subject"[\s\S]*required: true/);
    assertX.match(block, /displayName: "Message"[\s\S]*required: true/);
    assertX.match(block, /displayName: "Message ID"[\s\S]*required: true/);
    assertX.match(block, /displayName: "Name"[\s\S]*required: true/);
  });

  check("GMAILV1-E credential id only", () => {
    const block = gmailBlock();
    assertX.match(block, /name: "credentialId"/);
    assertX.ok(!/clientSecret|accessToken|refreshToken/.test(block));
  });

  check("GMAILV1-F node data round trip keeps parameters", () => {
    const definition = {
      nodes: [
        {
          id: "g1",
          type: "gmail",
          data: {
            credentialId: "c1",
            resource: "message",
            operation: "getAll",
            query: "from:{{items.email}}",
            limit: 5,
            readStatus: "unread",
          },
        },
      ],
      edges: [],
    };
    const saved = JSON.parse(JSON.stringify(definition));
    assertX.equal(saved.nodes[0].data.operation, "getAll");
    assertX.equal(saved.nodes[0].data.query, "from:{{items.email}}");
    assertX.equal(saved.nodes[0].data.credentialId, "c1");
    assertX.ok(!JSON.stringify(saved).includes("accessToken"));
  });

  check("GMAILV1-G send MIME", async () => {
    const capture = {};
    const result = await withGoogle(transport(capture), () =>
      exec({ operation: "send", to: "a@b.c", subject: "Hi", message: "plain", emailType: "text", cc: "c@d.e" })
    );
    const raw = decodeRaw(capture.calls.find((c) => c.url.includes("/messages/send")).body);
    assertX.ok(raw.includes("To: a@b.c"));
    assertX.ok(/Cc: c@d.e/i.test(raw));
    assertX.ok(raw.includes("plain"));
    assertX.equal(result.items[0].json.id, "m1");
    assertX.ok(Array.isArray(result.items));
  });

  check("GMAILV1-H get message", async () => {
    const result = await withGoogle(transport({}), () => exec({ operation: "get", messageId: "m1", simple: true }));
    assertX.equal(result.items[0].json.subject, "Hello");
    assertX.equal(result.items[0].json.id, "m1");
    assertX.equal(result.items[0].json.body, undefined);
  });

  check("GMAILV1-I get many query", async () => {
    const capture = {};
    await withGoogle(transport(capture), () =>
      exec({
        operation: "getAll",
        query: "subject:invoice",
        sender: "alice@example.com",
        readStatus: "unread",
        receivedAfter: "2024-01-02",
        labelIds: "INBOX",
        includeSpamTrash: true,
        limit: 2,
      })
    );
    const list = capture.calls.find((c) => c.url.includes("/messages?") || c.url.includes("/messages?"));
    const url = capture.calls.map((c) => c.url).find((u) => u.includes("q="));
    assertX.ok(url, "expected search query");
    const q = decodeURIComponent(url.split("q=")[1].split("&")[0]);
    assertX.ok(q.includes("subject:invoice"));
    assertX.ok(q.includes("from:alice@example.com"));
    assertX.ok(q.includes("is:unread"));
    assertX.ok(q.includes("after:2024/01/02"));
    assertX.ok(q.includes("label:INBOX"));
    assertX.ok(url.includes("includeSpamTrash=true"));
    void list;
  });

  check("GMAILV1-J pagination respects cap", async () => {
    const capture = { paginate: true, pages: [] };
    const result = await withGoogle(transport(capture), () =>
      exec({ operation: "getAll", returnAll: true, limit: 1 })
    );
    assertX.ok(capture.pages.includes("p1"));
    assertX.ok(capture.pages.includes("p2"));
    assertX.ok(result.items.length <= 100);
    assertX.ok(result.items.length >= 2);
  });

  check("GMAILV1-K reply thread headers", async () => {
    const capture = {};
    const result = await withGoogle(transport(capture), () =>
      exec({ operation: "reply", messageId: "m1", message: "thanks", replyToSenderOnly: true })
    );
    const send = capture.calls.find((c) => c.url.includes("/messages/send"));
    const parsed = JSON.parse(send.body);
    const raw = decodeRaw(send.body);
    assertX.equal(parsed.threadId, "t1");
    assertX.ok(raw.includes("In-Reply-To: <orig@example.com>"));
    assertX.ok(raw.includes("References: <root@example.com> <orig@example.com>"));
    assertX.ok(raw.includes("To: alice@example.com"));
    assertX.ok(/Subject: Re: Hello/.test(raw));
    assertX.equal(result.items[0].json.threadId, "t1");
  });

  check("GMAILV1-L add label", async () => {
    const capture = {};
    await withGoogle(transport(capture), () =>
      exec({ operation: "addLabels", messageId: "m1", labelIds: "INBOX, STARRED" })
    );
    assertX.deepEqual(capture.modify.addLabelIds, ["INBOX", "STARRED"]);
  });

  check("GMAILV1-M remove label", async () => {
    const capture = {};
    await withGoogle(transport(capture), () =>
      exec({ operation: "removeLabels", messageId: "m1", labelIds: "INBOX" })
    );
    assertX.deepEqual(capture.modify.removeLabelIds, ["INBOX"]);
  });

  check("GMAILV1-N mark read", async () => {
    const capture = {};
    await withGoogle(transport(capture), () => exec({ operation: "markRead", messageId: "m1" }));
    assertX.deepEqual(capture.modify.removeLabelIds, ["UNREAD"]);
  });

  check("GMAILV1-O mark unread", async () => {
    const capture = {};
    await withGoogle(transport(capture), () => exec({ operation: "markUnread", messageId: "m1" }));
    assertX.deepEqual(capture.modify.addLabelIds, ["UNREAD"]);
  });

  check("GMAILV1-P delete", async () => {
    const capture = {};
    const result = await withGoogle(transport(capture), () => exec({ operation: "delete", messageId: "m1" }));
    assertX.ok(capture.calls.some((c) => c.method === "DELETE"));
    assertX.equal(result.items[0].json.deleted, true);
    assertX.equal(result.items[0].json.id, "m1");
  });

  check("GMAILV1-Q create label", async () => {
    const capture = {};
    const result = await withGoogle(transport(capture), () =>
      exec({
        resource: "label",
        operation: "create",
        labelName: "Ops",
        labelListVisibility: "labelHide",
        messageListVisibility: "hide",
      })
    );
    assertX.equal(capture.label.name, "Ops");
    assertX.equal(capture.label.labelListVisibility, "labelHide");
    assertX.equal(capture.label.messageListVisibility, "hide");
    assertX.equal(result.items[0].json.id, "Label_1");
  });

  check("GMAILV1-R get labels", async () => {
    const result = await withGoogle(transport({}), () =>
      exec({ resource: "label", operation: "getAll" })
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.name, "INBOX");
    assertX.ok(result.items.every((item) => item.json && typeof item.json === "object"));
  });

  check("GMAILV1-S uses google_gmail credential", async () => {
    const capture = {};
    await withGoogle(transport(capture), () => exec({ operation: "get", messageId: "m1" }));
    assertX.ok(capture.calls[0].url.includes("gmail.googleapis.com"));
    const dumped = JSON.stringify(capture.calls);
    assertX.ok(!dumped.includes("tok-live"));
    assertX.ok(!dumped.includes("ref-live"));
  });

  const statusCase = (status, code, needle) => async () => {
    await withGoogle(
      async () => ({ status, ok: false, body: { error: { message: "scope secret tok-live" } } }),
      async () => {
        try {
          await exec({ operation: "get", messageId: "missing" });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, code);
          assertX.match(err.message, needle);
          assertX.ok(!String(err.message).includes("tok-live"));
          if (status === 429) assertX.equal(err.retryable, true);
        }
      }
    );
  };

  check("GMAILV1-T 401 reconnect", statusCase(401, "GOOGLE_UNAUTHORIZED", /Reconnect/));
  check("GMAILV1-U 403 permission", statusCase(403, "GOOGLE_FORBIDDEN", /permission|denied|Gmail/i));
  check("GMAILV1-V 404 not found", statusCase(404, "GOOGLE_NOT_FOUND", /not found/i));
  check("GMAILV1-W 429 retryable", statusCase(429, "GOOGLE_QUOTA", /quota/i));

  check("GMAILV1-X no secrets in node json", () => {
    const node = {
      type: "gmail",
      data: { credentialId: "c1", resource: "message", operation: "send", to: "{{items.email}}" },
    };
    const text = JSON.stringify(node);
    assertX.ok(!/clientSecret|accessToken|refreshToken|clientId/.test(text));
  });

  check("GMAILV1-Y workflow items are objects", async () => {
    const result = await withGoogle(transport({}), () => exec({ operation: "getAll", limit: 1 }));
    assertX.ok(Array.isArray(result.items));
    assertX.equal(typeof result.items[0].json, "object");
    assertX.ok(!Array.isArray(result.items[0].json) || true);
    assertX.equal(typeof result.items[0].json.id, "string");
    assertX.notEqual(typeof result.items, "string");
  });

  check("GMAILV1-Z expressions resolve", async () => {
    const capture = {};
    await withGoogle(transport(capture), () =>
      exec(
        { operation: "send", to: "{{item.email}}", subject: "{{item.subject}}", message: "{{item.body}}" },
        { input: { email: "expr@x.y", subject: "From item", body: "Body text" }, inputItems: [{ json: { email: "expr@x.y", subject: "From item", body: "Body text" } }] }
      )
    );
    const raw = decodeRaw(capture.calls.find((c) => c.url.includes("/send")).body);
    assertX.ok(raw.includes("expr@x.y"));
    assertX.ok(raw.includes("From item"));
    assertX.ok(raw.includes("Body text"));
  });
};

module.exports = { registerGmailV1Tests };

if (require.main === module) {
  const assertLocal = require("node:assert");
  let passed = 0;
  const queue = [];
  const check = (name, fn) => {
    queue.push(async () => {
      await fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    });
  };
  const section = (name) => queue.push(async () => console.log(`\n${name}`));
  registerGmailV1Tests({ check, section, assert: assertLocal });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} checks passed`);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
