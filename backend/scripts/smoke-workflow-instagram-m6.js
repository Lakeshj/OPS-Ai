/**
 * Instagram M6 — comments list + reply.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const IG_USER = "17841400000000001";
const MEDIA_ID = "17890000000000001";
const COMMENT_ID = "17880000000000001";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE";

const registerInstagramM6Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Instagram M6 comments");

  const ig = () => require("../services/workflowInstagram.service");
  const comments = () => require("../services/workflowInstagramComments.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const igGraph = () => require("../config/instagramGraph");
  const pub = () => require("../services/workflowInstagramPublish.service");
  const metaGraph = () => require("../config/metaGraph");
  const metaAds = () => require("../services/workflowMetaAds.service");
  const scope = () => require("../services/workflowAiContextScope");

  const baseCred = (overrides = {}) => ({
    id: "cred-ig-m6",
    type: "instagram",
    name: "IG",
    workspaceId: "ws-1",
    secret: {
      accessToken: TOKEN,
      expiresAt: "2099-01-01T00:00:00.000Z",
      grantedPermissions: [
        "instagram_basic",
        "instagram_manage_comments",
        "instagram_content_publish",
        "instagram_manage_insights",
      ],
      instagramUserId: IG_USER,
      ...(overrides.secret || {}),
    },
    config: {
      connected: true,
      instagramUserId: IG_USER,
      username: "brand_ig",
      grantedPermissions: [
        "instagram_basic",
        "instagram_manage_comments",
        "instagram_content_publish",
        "instagram_manage_insights",
      ],
      ...(overrides.config || {}),
    },
  });

  const runNode = (data, transport, credOverrides) =>
    comments().withInstagramCommentsTestHooks(
      {
        transport,
        loadCredential: async () => baseCred(credOverrides || {}),
      },
      () =>
        ig().executeInstagramNode(
          { id: "ig-1", type: "instagram", data },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );

  check("IG-M6-1 comments resource registered", () => {
    assertX.equal(igGraph().SCOPE_COMMENTS, "instagram_manage_comments");
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_manage_comments"),
      true
    );
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_business_manage_comments"),
      false
    );
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assertX.equal(schema.includes('value: "comments"'), true);
    assertX.equal(schema.includes('value: "list_comments"'), true);
    assertX.equal(schema.includes('value: "list_replies"'), true);
    assertX.equal(schema.includes('value: "reply_comment"'), true);
  });

  check("IG-M6-2 list_comments requires mediaId", async () => {
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m6",
            resource: "comments",
            operation: "list_comments",
            mediaId: "",
          },
          async () => ({ ok: true, status: 200, body: { data: [] } })
        ),
      (err) => err.code === "INSTAGRAM_MEDIA_INVALID"
    );
  });

  check("IG-M6-3 list_comments requires manage-comments permission", async () => {
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m6",
            resource: "comments",
            operation: "list_comments",
            mediaId: MEDIA_ID,
          },
          async () => ({ ok: true, status: 200, body: { data: [] } }),
          {
            secret: { grantedPermissions: ["instagram_basic"] },
            config: { grantedPermissions: ["instagram_basic"] },
          }
        ),
      (err) => err.code === "INSTAGRAM_PERMISSION_DENIED"
    );
  });

  check("IG-M6-4 list_comments returns one WorkflowItem per real comment", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m6",
        resource: "comments",
        operation: "list_comments",
        mediaId: MEDIA_ID,
        limit: 10,
      },
      async (url) => {
        assertX.equal(String(url).includes(`/${MEDIA_ID}/comments?`), true);
        assertX.equal(String(url).includes("graph.facebook.com"), true);
        return {
          ok: true,
          status: 200,
          body: {
            data: [
              {
                id: "c1",
                text: "hello",
                timestamp: "2026-03-01T00:00:00+0000",
                username: "user_a",
                like_count: 2,
                replies: { summary: { total_count: 1 } },
              },
              {
                id: "c2",
                text: "world",
                username: "user_b",
              },
            ],
          },
        };
      }
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.commentId, "c1");
    assertX.equal(result.items[0].json.text, "hello");
    assertX.equal(result.items[0].json.likeCount, 2);
    assertX.equal(result.items[0].json.repliesCount, 1);
    assertX.equal(result.items[0].json.mediaId, MEDIA_ID);
    assertX.equal(result.items[0].json._meta.provider, "instagram");
    assertX.equal(result.items[0].json._meta.resource, "comments");
    assertX.equal(result.items[0].json._meta.operation, "list_comments");
    assertX.equal(result.items[1].json.commentId, "c2");
  });

  check("IG-M6-5 list_comments pagination works", async () => {
    const cursors = [];
    const result = await runNode(
      {
        credentialId: "cred-ig-m6",
        resource: "comments",
        operation: "list_comments",
        mediaId: MEDIA_ID,
        returnAll: true,
      },
      async (url) => {
        const u = new URL(String(url));
        cursors.push(u.searchParams.get("after") || "");
        if (!u.searchParams.get("after")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [{ id: "p1", text: "one", username: "a" }],
              paging: {
                cursors: { after: "CUR1" },
                next: `https://graph.facebook.com/v27.0/${MEDIA_ID}/comments?access_token=${TOKEN}&after=CUR1`,
              },
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: {
            data: [{ id: "p2", text: "two", username: "b" }],
            paging: { cursors: {} },
          },
        };
      }
    );
    assertX.deepEqual(cursors, ["", "CUR1"]);
    assertX.equal(result.items.length, 2);
  });

  check("IG-M6-6 pagination cap/truncated behavior works", async () => {
    let pages = 0;
    const result = await comments().withInstagramCommentsTestHooks(
      {
        loadCredential: async () => baseCred(),
        transport: async () => {
          pages += 1;
          return {
            ok: true,
            status: 200,
            body: {
              data: [{ id: `c${pages}`, text: "x", username: "u" }],
              paging: {
                cursors: { after: `A${pages}` },
                next: `https://graph.facebook.com/comments?access_token=${TOKEN}`,
              },
            },
          };
        },
      },
      () =>
        ig().executeInstagramNode(
          {
            type: "instagram",
            data: {
              credentialId: "cred-ig-m6",
              resource: "comments",
              operation: "list_comments",
              mediaId: MEDIA_ID,
              returnAll: true,
            },
          },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );
    assertX.equal(result.items.length <= comments().MAX_ROWS, true);
    assertX.equal(result.output.truncated, true);
    assertX.equal(pages <= comments().MAX_PAGES, true);
  });

  check("IG-M6-7 list_replies requires commentId", async () => {
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m6",
            resource: "comments",
            operation: "list_replies",
            commentId: "",
          },
          async () => ({ ok: true, status: 200, body: { data: [] } })
        ),
      (err) => err.code === "INSTAGRAM_COMMENT_INVALID"
    );
  });

  check("IG-M6-8 reply parent relationship preserved", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m6",
        resource: "comments",
        operation: "list_replies",
        commentId: COMMENT_ID,
      },
      async (url) => {
        assertX.equal(String(url).includes(`/${COMMENT_ID}/replies?`), true);
        return {
          ok: true,
          status: 200,
          body: {
            data: [
              {
                id: "r1",
                text: "thanks",
                username: "brand_ig",
                timestamp: "2026-03-02T00:00:00+0000",
              },
            ],
          },
        };
      }
    );
    assertX.equal(result.items[0].json.commentId, "r1");
    assertX.equal(result.items[0].json.parentCommentId, COMMENT_ID);
    assertX.equal(result.items[0].json._meta.operation, "list_replies");
  });

  check("IG-M6-9 reply_comment requires commentId + non-empty message", async () => {
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m6",
            resource: "comments",
            operation: "reply_comment",
            commentId: COMMENT_ID,
            message: "   ",
          },
          async () => ({ ok: true, status: 200, body: { id: "x" } })
        ),
      (err) => err.code === "INSTAGRAM_COMMENT_MESSAGE_INVALID"
    );
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m6",
            resource: "comments",
            operation: "reply_comment",
            commentId: "",
            message: "hi",
          },
          async () => ({ ok: true, status: 200, body: { id: "x" } })
        ),
      (err) => err.code === "INSTAGRAM_COMMENT_INVALID"
    );
  });

  check("IG-M6-10 reply_comment uses Instagram POST client only", async () => {
    let postUrl = "";
    await runNode(
      {
        credentialId: "cred-ig-m6",
        resource: "comments",
        operation: "reply_comment",
        commentId: COMMENT_ID,
        message: "Thanks!",
      },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        if (method === "POST") {
          postUrl = String(url);
          assertX.equal(postUrl.includes("graph.facebook.com"), true);
          assertX.equal(postUrl.includes("graph.instagram.com"), false);
          assertX.equal(postUrl.endsWith(`/${COMMENT_ID}/replies`), true);
          assertX.equal(String(options.body).includes("message=Thanks%21") || String(options.body).includes("message=Thanks!"), true);
          return { ok: true, status: 200, body: { id: "reply-new" } };
        }
        return { ok: false, status: 404, body: {} };
      }
    );
    assertX.equal(postUrl.includes("graph.facebook.com"), true);
    assertX.equal(auth().INSTAGRAM_ALLOWED_METHODS.includes("POST"), true);
  });

  check("IG-M6-11 successful reply returns created comment/reply id only from real response", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m6",
        resource: "comments",
        operation: "reply_comment",
        commentId: COMMENT_ID,
        message: "Got it",
      },
      async (url, options = {}) => {
        if (String(options.method || "GET").toUpperCase() === "POST") {
          return { ok: true, status: 200, body: { id: "created-reply-9" } };
        }
        return { ok: false, status: 404, body: {} };
      }
    );
    assertX.equal(result.items[0].json.commentId, "created-reply-9");
    assertX.equal(result.items[0].json.parentCommentId, COMMENT_ID);
    assertX.equal(result.items[0].json.text, "Got it");
    assertX.equal(result.items[0].json.status, "replied");
    assertX.equal(result.items[0].json.username, undefined);
    assertX.equal(result.items[0].json.timestamp, undefined);
  });

  check("IG-M6-12 missing fields are not fabricated", () => {
    const json = comments().normalizeComment(
      { id: "only-id" },
      {
        operation: "list_comments",
        instagramUserId: IG_USER,
        mediaId: MEDIA_ID,
      }
    );
    assertX.equal(json.commentId, "only-id");
    assertX.equal(Object.prototype.hasOwnProperty.call(json, "likeCount"), false);
    assertX.equal(Object.prototype.hasOwnProperty.call(json, "username"), false);
    assertX.equal(Object.prototype.hasOwnProperty.call(json, "timestamp"), false);
    assertX.equal(json.likeCount, undefined);
  });

  check("IG-M6-13 failed/uncertain reply does not auto-duplicate POST", async () => {
    let posts = 0;
    await assertX.rejects(
      () =>
        comments().withInstagramCommentsTestHooks(
          {
            loadCredential: async () => baseCred(),
            transport: async (_url, options = {}) => {
              if (String(options.method || "GET").toUpperCase() === "POST") {
                posts += 1;
                return {
                  ok: false,
                  status: 500,
                  body: { error: { message: "temporary failure" } },
                };
              }
              return { ok: false, status: 404, body: {} };
            },
          },
          () =>
            ig().executeInstagramNode(
              {
                type: "instagram",
                data: {
                  credentialId: "cred-ig-m6",
                  resource: "comments",
                  operation: "reply_comment",
                  commentId: COMMENT_ID,
                  message: "retry?",
                },
              },
              { workspaceId: "ws-1", items: [{ json: {} }] }
            )
        ),
      (err) => Boolean(err.code)
    );
    assertX.equal(posts, 1);
  });

  check("IG-M6-14 expired token uses reconnect behavior", async () => {
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m6",
            resource: "comments",
            operation: "list_comments",
            mediaId: MEDIA_ID,
          },
          async () => ({ ok: true, status: 200, body: { data: [] } }),
          { config: { reconnectRequired: true } }
        ),
      (err) => err.code === "INSTAGRAM_TOKEN_INVALID"
    );
  });

  check("IG-M6-15 no secrets/paging token URLs leak", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m6",
        resource: "comments",
        operation: "list_comments",
        mediaId: MEDIA_ID,
        limit: 5,
      },
      async () => ({
        ok: true,
        status: 200,
        body: {
          data: [{ id: "c1", text: "hi", username: "a", access_token: TOKEN }],
          paging: {
            next: `https://graph.facebook.com/comments?access_token=${TOKEN}`,
          },
        },
      })
    );
    const dumped = JSON.stringify(result);
    assertX.equal(dumped.includes(TOKEN), false);
    assertX.equal(dumped.includes("access_token="), false);
    assertX.equal(result.items[0].json.access_token, undefined);
    assertX.equal(result.output.next, undefined);
  });

  check("IG-M6-16 M3 regression green", async () => {
    const profile = await ig().withInstagramNodeTestHooks(
      {
        loadCredential: async () => baseCred(),
        transport: async () => ({
          ok: true,
          status: 200,
          body: {
            user_id: IG_USER,
            username: "brand_ig",
            account_type: "BUSINESS",
          },
        }),
      },
      () =>
        ig().executeInstagramNode(
          {
            type: "instagram",
            data: {
              credentialId: "cred-ig-m6",
              resource: "account",
              operation: "get_profile",
            },
          },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );
    assertX.equal(profile.items[0].json.username, "brand_ig");
  });

  check("IG-M6-17 M4 regression green", async () => {
    const insights = await ig().withInstagramNodeTestHooks(
      {
        loadCredential: async () => baseCred(),
        transport: async () => ({
          ok: true,
          status: 200,
          body: {
            data: [
              {
                name: "views",
                period: "day",
                values: [{ value: 4, end_time: "2026-03-01T00:00:00+0000" }],
              },
            ],
          },
        }),
      },
      () =>
        ig().executeInstagramNode(
          {
            type: "instagram",
            data: {
              credentialId: "cred-ig-m6",
              resource: "insights",
              operation: "account_insights",
              insightsPreset: "overview",
              period: "day",
            },
          },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );
    assertX.equal(insights.items[0].json.value, 4);
  });

  check("IG-M6-18 M5 regression green", () => {
    assertX.equal(
      typeof pub().executePublishOperation,
      "function"
    );
    assertX.equal(
      pub().assertInstagramPublicMediaUrl("https://cdn.example.com/a.jpg"),
      "https://cdn.example.com/a.jpg"
    );
    assertX.throws(
      () => pub().assertInstagramPublicMediaUrl("http://cdn.example.com/a.jpg"),
      (err) => err.code === "INSTAGRAM_MEDIA_URL_INVALID"
    );
  });

  check("IG-M6-19 Meta Ads native/MCP regression green", async () => {
    assertX.deepEqual([...metaGraph().OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(metaGraph().API_VERSION, "v26.0");
    const adsSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assertX.equal(adsSrc.includes("instagram"), false);
    await assertX.rejects(
      () =>
        metaAds().metaGraphRequest({
          accessToken: "x",
          path: "me",
          method: "POST",
        }),
      (err) => err.code === "META_PERMISSION_DENIED"
    );
  });

  check("IG-M6-20 AI Entire Dataset regression green", () => {
    assertX.equal(scope().resolveAiContextScope({ contextScope: "dataset" }), "dataset");
    assertX.equal(scope().resolveAiContextScope({ contextScope: "item" }), "item");
  });
};

if (require.main === module) {
  const queue = [];
  let passed = 0;
  const check = (name, fn) => {
    queue.push(async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (err) {
        console.error(
          `FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`
        );
        process.exitCode = 1;
      }
    });
  };
  const section = (name) => queue.push(async () => console.log(`\n${name}`));
  registerInstagramM6Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} Instagram M6 checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerInstagramM6Tests };
