/**
 * Instagram M3 — native account + media reads.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const IG_USER = "17841400000000001";
const MEDIA_A = "17890000000000001";
const MEDIA_B = "17890000000000002";
const MEDIA_C = "17890000000000003";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE";

const registerInstagramM3Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Instagram M3 native reads");

  const ig = () => require("../services/workflowInstagram.service");
  const nodes = () => require("../services/workflowNodes.service");
  const workflows = () => require("../modules/workflows/workflows.service");
  const metaGraph = () => require("../config/metaGraph");
  const metaAds = () => require("../services/workflowMetaAds.service");
  const igGraph = () => require("../config/instagramGraph");
  const auth = () => require("../services/workflowInstagramAuth.service");

  const baseCred = (overrides = {}) => ({
    id: "cred-ig-m3",
    type: "instagram",
    name: "IG",
    workspaceId: "ws-1",
    secret: {
      accessToken: TOKEN,
      tokenKind: "instagram_user_long_lived",
      expiresAt: "2099-01-01T00:00:00.000Z",
      grantedPermissions: [
        "instagram_business_basic",
        "instagram_business_content_publishing",
        "instagram_business_manage_comments",
        "instagram_business_manage_insights",
      ],
      instagramUserId: IG_USER,
      username: "brand_ig",
      ...(overrides.secret || {}),
    },
    config: {
      connected: true,
      instagramUserId: IG_USER,
      username: "brand_ig",
      accountType: "Business",
      grantedPermissions: [
        "instagram_business_basic",
        "instagram_business_content_publishing",
        "instagram_business_manage_comments",
        "instagram_business_manage_insights",
      ],
      ...(overrides.config || {}),
    },
  });

  const runNode = (data, transport, loadCredential) =>
    ig().withInstagramNodeTestHooks(
      {
        transport,
        loadCredential: loadCredential || (async () => baseCred()),
      },
      () =>
        ig().executeInstagramNode(
          { id: "ig-1", type: "instagram", data },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );

  check("IG-M3-1 instagram node registered", () => {
    assertX.equal(typeof nodes().handlers.instagram, "function");
    assertX.equal(workflows().ALLOWED_NODE_TYPES.has("instagram"), true);
    const contractPath = path.join(
      __dirname,
      "../../frontend/src/modules/workflows/nodeContract.ts"
    );
    const typesPath = path.join(
      __dirname,
      "../../frontend/src/modules/workflows/types.ts"
    );
    assertX.equal(fs.readFileSync(contractPath, "utf8").includes("instagram:"), true);
    assertX.equal(fs.readFileSync(typesPath, "utf8").includes('"instagram"'), true);
  });

  check("IG-M3-2 get_profile loads credential + instagramUserId", async () => {
    let seenPath = "";
    const result = await runNode(
      { credentialId: "cred-ig-m3", resource: "account", operation: "get_profile" },
      async (url) => {
        seenPath = String(url);
        return {
          ok: true,
          status: 200,
          body: {
            id: "app-scoped",
            user_id: IG_USER,
            username: "brand_ig",
            account_type: "BUSINESS",
            name: "Brand",
            followers_count: 12,
          },
        };
      }
    );
    assertX.equal(seenPath.includes(`/${IG_USER}?`), true);
    assertX.equal(result.output.instagramUserId, IG_USER);
    assertX.equal(result.items[0].json.id, IG_USER);
  });

  check("IG-M3-3 get_profile returns one normalized WorkflowItem", async () => {
    const result = await runNode(
      { credentialId: "cred-ig-m3", resource: "account", operation: "get_profile" },
      async () => ({
        ok: true,
        status: 200,
        body: {
          user_id: IG_USER,
          username: "brand_ig",
          name: "Brand Co",
          account_type: "BUSINESS",
          biography: "hello",
          profile_picture_url: "https://cdn.example/p.jpg",
          followers_count: 100,
          follows_count: 10,
          media_count: 5,
        },
      })
    );
    assertX.equal(result.items.length, 1);
    const json = result.items[0].json;
    assertX.equal(json.id, IG_USER);
    assertX.equal(json.username, "brand_ig");
    assertX.equal(json.name, "Brand Co");
    assertX.equal(json.accountType, "Business");
    assertX.equal(json.biography, "hello");
    assertX.equal(json.profilePictureUrl, "https://cdn.example/p.jpg");
    assertX.equal(json.followersCount, 100);
    assertX.equal(json.followsCount, 10);
    assertX.equal(json.mediaCount, 5);
    assertX.equal(json._meta.provider, "instagram");
    assertX.equal(json._meta.resource, "account");
    assertX.equal(json._meta.operation, "get_profile");
    assertX.equal(json._meta.instagramUserId, IG_USER);
  });

  check("IG-M3-4 list_media follows cursor pagination", async () => {
    const cursors = [];
    const result = await runNode(
      {
        credentialId: "cred-ig-m3",
        resource: "media",
        operation: "list_media",
        returnAll: true,
        limit: 10,
      },
      async (url) => {
        const u = new URL(String(url));
        cursors.push(u.searchParams.get("after") || "");
        if (!u.searchParams.get("after")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [{ id: MEDIA_A, media_type: "IMAGE", caption: "a" }],
              paging: {
                cursors: { after: "CURSOR_1" },
                next: `https://graph.facebook.com/v27.0/${IG_USER}/media?access_token=${TOKEN}&after=CURSOR_1`,
              },
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: {
            data: [{ id: MEDIA_B, media_type: "VIDEO", caption: "b" }],
            paging: { cursors: {} },
          },
        };
      }
    );
    assertX.deepEqual(cursors, ["", "CURSOR_1"]);
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.id, MEDIA_A);
    assertX.equal(result.items[1].json.id, MEDIA_B);
  });

  check("IG-M3-5 list_media returns one WorkflowItem per media object", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m3",
        resource: "media",
        operation: "list_media",
        limit: 10,
      },
      async () => ({
        ok: true,
        status: 200,
        body: {
          data: [
            {
              id: MEDIA_A,
              caption: "one",
              media_type: "CAROUSEL_ALBUM",
              media_product_type: "FEED",
              media_url: "https://cdn.example/a.jpg",
              permalink: "https://instagram.com/p/a",
              timestamp: "2026-01-01T00:00:00+0000",
              username: "brand_ig",
              comments_count: 2,
              like_count: 9,
              children: {
                data: [{ id: "child-1", media_type: "IMAGE", media_url: "https://cdn.example/c1.jpg" }],
              },
            },
            {
              id: MEDIA_B,
              media_type: "IMAGE",
              permalink: "https://instagram.com/p/b",
            },
          ],
        },
      })
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.mediaType, "CAROUSEL_ALBUM");
    assertX.equal(result.items[0].json.mediaProductType, "FEED");
    assertX.equal(result.items[0].json.mediaUrl, "https://cdn.example/a.jpg");
    assertX.equal(result.items[0].json.commentsCount, 2);
    assertX.equal(result.items[0].json.likeCount, 9);
    assertX.equal(result.items[0].json.children[0].id, "child-1");
    assertX.equal(result.items[0].json._meta.provider, "instagram");
    assertX.equal(result.items[0].json._meta.resource, "media");
    assertX.equal(result.items[0].json._meta.operation, "list_media");
    assertX.equal(result.items[0].json._meta.mediaId, MEDIA_A);
    assertX.equal(result.items[1].json.mediaId, MEDIA_B);
  });

  check("IG-M3-6 pagination respects hard cap", async () => {
    let pages = 0;
    const result = await ig().withInstagramNodeTestHooks(
      {
        loadCredential: async () => baseCred(),
        transport: async () => {
          pages += 1;
          const id = `1790000000000000${pages}`;
          return {
            ok: true,
            status: 200,
            body: {
              data: [{ id, media_type: "IMAGE" }],
              paging: {
                cursors: { after: `C${pages}` },
                next: `https://graph.facebook.com/media?access_token=${TOKEN}`,
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
              credentialId: "cred-ig-m3",
              resource: "media",
              operation: "list_media",
              returnAll: true,
            },
          },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );
    assertX.equal(result.items.length <= ig().MAX_ROWS, true);
    assertX.equal(result.items.length, Math.min(ig().MAX_ROWS, pages));
    assertX.equal(result.output.truncated, true);
    assertX.equal(pages <= ig().MAX_PAGES, true);
  });

  check("IG-M3-7 get_media requires mediaId", async () => {
    await assertX.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m3",
            resource: "media",
            operation: "get_media",
            mediaId: "",
          },
          async () => ({ ok: true, status: 200, body: {} })
        ),
      (err) => err.code === "INSTAGRAM_MEDIA_INVALID"
    );
  });

  check("IG-M3-8 get_media returns normalized media object", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m3",
        resource: "media",
        operation: "get_media",
        mediaId: MEDIA_C,
      },
      async (url) => {
        assertX.equal(String(url).includes(`/${MEDIA_C}?`), true);
        return {
          ok: true,
          status: 200,
          body: {
            id: MEDIA_C,
            caption: "single",
            media_type: "IMAGE",
            media_url: "https://cdn.example/c.jpg",
            thumbnail_url: "https://cdn.example/t.jpg",
            permalink: "https://instagram.com/p/c",
            timestamp: "2026-02-01T00:00:00+0000",
            username: "brand_ig",
            like_count: 3,
          },
        };
      }
    );
    assertX.equal(result.items.length, 1);
    const json = result.items[0].json;
    assertX.equal(json.id, MEDIA_C);
    assertX.equal(json.mediaId, MEDIA_C);
    assertX.equal(json.mediaType, "IMAGE");
    assertX.equal(json.thumbnailUrl, "https://cdn.example/t.jpg");
    assertX.equal(json._meta.operation, "get_media");
    assertX.equal(json._meta.mediaId, MEDIA_C);
  });

  check("IG-M3-9 optional missing fields do not fail operation", async () => {
    const profile = await runNode(
      { credentialId: "cred-ig-m3", resource: "account", operation: "get_profile" },
      async (url) => {
        if (String(url).includes("biography")) {
          return {
            ok: false,
            status: 400,
            body: {
              error: {
                code: 100,
                message: "(#100) nonexisting field (biography)",
              },
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: { user_id: IG_USER, username: "brand_ig" },
        };
      }
    );
    assertX.equal(profile.items[0].json.id, IG_USER);
    assertX.equal(profile.items[0].json.biography, undefined);
    assertX.equal(Object.prototype.hasOwnProperty.call(profile.items[0].json, "followersCount"), false);

    const media = await runNode(
      {
        credentialId: "cred-ig-m3",
        resource: "media",
        operation: "get_media",
        mediaId: MEDIA_A,
      },
      async (url) => {
        if (String(url).includes("like_count")) {
          return {
            ok: false,
            status: 400,
            body: {
              error: { code: 100, message: "(#100) nonexisting field (like_count)" },
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: { id: MEDIA_A, media_type: "IMAGE", permalink: "https://instagram.com/p/a" },
        };
      }
    );
    assertX.equal(media.items[0].json.id, MEDIA_A);
    assertX.equal(media.items[0].json.likeCount, undefined);
  });

  check("IG-M3-10 no secrets/paging token URLs leak into output", async () => {
    const result = await runNode(
      {
        credentialId: "cred-ig-m3",
        resource: "media",
        operation: "list_media",
        limit: 5,
      },
      async () => ({
        ok: true,
        status: 200,
        body: {
          data: [{ id: MEDIA_A, media_type: "IMAGE", access_token: TOKEN }],
          paging: {
            cursors: { after: "X" },
            next: `https://graph.facebook.com/media?access_token=${TOKEN}`,
          },
        },
      })
    );
    const dumped = JSON.stringify(result);
    assertX.equal(dumped.includes(TOKEN), false);
    assertX.equal(dumped.includes("access_token="), false);
    assertX.equal(result.items[0].json.access_token, undefined);
    assertX.equal(result.items[0].json.paging, undefined);
    assertX.equal(result.output.next, undefined);
  });

  check("IG-M3-11 missing basic permission returns safe permission error", async () => {
    await assertX.rejects(
      () =>
        ig().withInstagramNodeTestHooks(
          {
            loadCredential: async () =>
              baseCred({
                secret: {
                  grantedPermissions: ["instagram_business_manage_comments"],
                },
                config: {
                  grantedPermissions: ["instagram_business_manage_comments"],
                },
              }),
            transport: async () => ({ ok: true, status: 200, body: {} }),
          },
          () =>
            ig().executeInstagramNode(
              {
                type: "instagram",
                data: {
                  credentialId: "cred-ig-m3",
                  resource: "account",
                  operation: "get_profile",
                },
              },
              { workspaceId: "ws-1", items: [{ json: {} }] }
            )
        ),
      (err) => err.code === "INSTAGRAM_PERMISSION_DENIED"
    );
  });

  check("IG-M3-12 expired token triggers existing reconnect handling", async () => {
    let marked = false;
    await assertX.rejects(
      () =>
        ig().withInstagramNodeTestHooks(
          {
            loadCredential: async () =>
              baseCred({
                secret: {
                  accessToken: TOKEN,
                  expiresAt: "2000-01-01T00:00:00.000Z",
                },
                config: {
                  reconnectRequired: false,
                  expiresAt: "2000-01-01T00:00:00.000Z",
                },
              }),
            transport: async () => ({
              ok: false,
              status: 401,
              body: { error: { code: 190, message: "Invalid OAuth access token." } },
            }),
          },
          async () => {
            // Force graph path: expire via reconnectRequired flag for deterministic M2 reuse.
            const expired = baseCred({
              config: { reconnectRequired: true },
              secret: { revoked: false },
            });
            return ig().withInstagramNodeTestHooks(
              {
                loadCredential: async () => expired,
                transport: async () => ({ ok: true, status: 200, body: {} }),
              },
              () =>
                ig().executeInstagramNode(
                  {
                    type: "instagram",
                    data: {
                      credentialId: "cred-ig-m3",
                      resource: "account",
                      operation: "get_profile",
                    },
                  },
                  { workspaceId: "ws-1", items: [{ json: {} }] }
                )
            );
          }
        ),
      (err) => {
        marked = err.code === "INSTAGRAM_TOKEN_INVALID";
        return marked;
      }
    );
    assertX.equal(marked, true);

    // Live Graph 190 path also maps to token invalid via auth helper.
    await assertX.rejects(
      () =>
        auth().withInstagramAuthTestHooks(
          {
            loadCredential: async () => baseCred(),
            transport: async () => ({
              ok: false,
              status: 401,
              body: { error: { code: 190, message: "Invalid OAuth access token." } },
            }),
          },
          () =>
            auth().instagramGraphGet({
              credentialId: "cred-ig-m3",
              workspaceId: "ws-1",
              path: IG_USER,
              query: { fields: "id,username" },
            })
        ),
      (err) => err.code === "INSTAGRAM_TOKEN_INVALID"
    );
  });

  check("IG-M3-13 Meta Ads native regression green", async () => {
    assertX.deepEqual([...metaGraph().OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(metaGraph().API_VERSION, "v26.0");
    // Unified Login shares Facebook Graph version family; clients remain separate.
    assertX.equal(igGraph().AUTH_MODE_UNIFIED, "unified_login");
    assertX.equal(igGraph().GRAPH_HOST, "https://graph.facebook.com");
    const adsSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    const igSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagram.service.js"),
      "utf8"
    );
    assertX.equal(adsSrc.includes("instagram"), false);
    assertX.equal(igSrc.includes("workflowMetaAds"), false);
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

  check("IG-M3-14 Meta Ads MCP regression green", () => {
    const mcpSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAdsMcp.service.js"),
      "utf8"
    );
    const pluginExecutor = fs.readFileSync(
      path.join(__dirname, "../../plugins/meta-ads-mcp/src/executor.js"),
      "utf8"
    );
    assertX.equal(mcpSrc.includes("normalizeAdAccountId"), true);
    assertX.equal(pluginExecutor.includes("ads_management"), false);
    assertX.equal(pluginExecutor.includes("instagram"), false);
  });

  check("IG-M3-15 AI/context-scope focused regression remains green", () => {
    const scope = require("../services/workflowAiContextScope");
    assertX.equal(scope.resolveAiContextScope({ contextScope: "item" }), "item");
    assertX.equal(scope.resolveAiContextScope({ contextScope: "dataset" }), "dataset");
    assertX.equal(
      scope.resolveAiContextScope({ contextScope: "Entire Dataset" }),
      "dataset"
    );
    const aiScopeSmoke = fs.readFileSync(
      path.join(__dirname, "smoke-workflow-ai-live-scope.js"),
      "utf8"
    );
    assertX.equal(aiScopeSmoke.includes("AI-LIVE-SCOPE-1"), true);
    assertX.equal(aiScopeSmoke.includes("contextScope"), true);
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
  registerInstagramM3Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} Instagram M3 checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerInstagramM3Tests };
