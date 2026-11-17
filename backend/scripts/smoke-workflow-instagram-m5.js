/**
 * Instagram M5 — content publishing.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const IG_USER = "17841400000000001";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE";
const HTTPS_IMG = "https://cdn.example.com/photo.jpg";
const HTTPS_VID = "https://cdn.example.com/reel.mp4";

const registerInstagramM5Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Instagram M5 publishing");

  const ig = () => require("../services/workflowInstagram.service");
  const pub = () => require("../services/workflowInstagramPublish.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const igGraph = () => require("../config/instagramGraph");
  const metaGraph = () => require("../config/metaGraph");
  const metaAds = () => require("../services/workflowMetaAds.service");
  const scope = () => require("../services/workflowAiContextScope");

  const memoryStore = new Map();
  const storeKey = (r) =>
    `${r.workspaceId}|${r.workflowId}|${r.nodeId}|${r.publishKey}`;

  const baseCred = (overrides = {}) => ({
    id: "cred-ig-m5",
    type: "instagram",
    name: "IG",
    workspaceId: "ws-1",
    secret: {
      accessToken: TOKEN,
      expiresAt: "2099-01-01T00:00:00.000Z",
      grantedPermissions: [
        "instagram_basic",
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
        "instagram_content_publish",
        "instagram_manage_insights",
      ],
      ...(overrides.config || {}),
    },
  });

  const publishHooks = (transport, extra = {}) => ({
    transport,
    sleep: async () => {},
    loadCredential: async () => baseCred(extra.credOverrides || {}),
    loadPublishRecord: async (q) => memoryStore.get(storeKey(q)) || null,
    savePublishRecord: async (record) => {
      memoryStore.set(storeKey(record), { ...record });
      return record;
    },
    ...extra,
  });

  const runPublish = (data, transport, extra = {}) =>
    pub().withInstagramPublishTestHooks(publishHooks(transport, extra), () =>
      ig().executeInstagramNode(
        {
          id: "ig-pub-1",
          type: "instagram",
          data: {
            credentialId: "cred-ig-m5",
            resource: "publish",
            pollIntervalMs: 1,
            maxPollAttempts: 5,
            ...data,
          },
        },
        {
          workspaceId: "ws-1",
          workflowId: "wf-1",
          nodeId: "ig-pub-1",
          runId: "run-1",
          items: [{ json: {} }],
        }
      )
    );

  check("IG-M5-1 publishing resource/operations registered", () => {
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assertX.equal(schema.includes('value: "publish"'), true);
    assertX.equal(schema.includes('value: "publish_image"'), true);
    assertX.equal(schema.includes('value: "publish_carousel"'), true);
    assertX.equal(schema.includes('value: "publish_reel"'), true);
    assertX.equal(schema.includes('value: "publish_story"'), true);
    assertX.equal(
      auth().INSTAGRAM_ALLOWED_METHODS.includes("POST"),
      true
    );
  });

  check("IG-M5-2 requires exact instagram_content_publish", async () => {
    assertX.equal(igGraph().SCOPE_PUBLISH, "instagram_content_publish");
    await assertX.rejects(
      () =>
        runPublish(
          { operation: "publish_image", imageUrl: HTTPS_IMG },
          async () => ({ ok: true, status: 200, body: { id: "x" } }),
          {
            credOverrides: {
              secret: {
                grantedPermissions: ["instagram_basic"],
              },
              config: {
                grantedPermissions: ["instagram_basic"],
              },
            },
          }
        ),
      (err) => err.code === "INSTAGRAM_PERMISSION_DENIED"
    );
  });

  check("IG-M5-3 Unified publish permission is configured (not business_*)", () => {
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_content_publish"),
      true
    );
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_business_content_publishing"),
      false
    );
    assertX.equal(
      igGraph().normalizeGrantedScope("instagram_business_content_publishing"),
      "instagram_content_publish"
    );
  });

  check("IG-M5-4 publish_image creates container then publishes", async () => {
    memoryStore.clear();
    const calls = [];
    const result = await runPublish(
      { operation: "publish_image", imageUrl: HTTPS_IMG, caption: "hi" },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        calls.push({ method, url: u, body: options.body || "" });
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          assertX.equal(String(options.body).includes("image_url="), true);
          return { ok: true, status: 200, body: { id: "container-1" } };
        }
        if (method === "GET" && u.includes("/container-1?")) {
          return {
            ok: true,
            status: 200,
            body: { id: "container-1", status_code: "FINISHED" },
          };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media_publish`)) {
          assertX.equal(String(options.body).includes("creation_id=container-1"), true);
          return { ok: true, status: 200, body: { id: "media-1" } };
        }
        if (u.includes("/media-1?")) {
          return {
            ok: true,
            status: 200,
            body: {
              id: "media-1",
              permalink: "https://instagram.com/p/x",
              timestamp: "2026-03-01T00:00:00+0000",
              media_type: "IMAGE",
            },
          };
        }
        if (u.includes("/content_publishing_limit")) {
          return {
            ok: true,
            status: 200,
            body: { data: [{ quota_usage: 1, config: { quota_total: 100 } }] },
          };
        }
        return { ok: false, status: 404, body: { error: { message: u } } };
      }
    );
    assertX.equal(result.items[0].json.mediaId, "media-1");
    assertX.equal(result.items[0].json.containerId, "container-1");
    assertX.equal(result.items[0].json.status, "published");
    assertX.equal(result.items[0].json._meta.resource, "publish");
    assertX.equal(result.items[0].json._meta.operation, "publish_image");
    assertX.equal(
      calls.some((c) => c.method === "POST" && c.url.includes("/media_publish")),
      true
    );
    assertX.equal(calls.every((c) => c.url.includes("graph.facebook.com")), true);
    assertX.equal(calls.every((c) => !c.url.includes("graph.instagram.com")), true);
  });

  check("IG-M5-5 reel waits for FINISHED before media_publish", async () => {
    memoryStore.clear();
    let statusChecks = 0;
    let published = false;
    const result = await runPublish(
      { operation: "publish_reel", videoUrl: HTTPS_VID, caption: "reel" },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        if (u.includes("/content_publishing_limit")) {
          return { ok: true, status: 200, body: { data: [{}] } };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          assertX.equal(String(options.body).includes("media_type=REELS"), true);
          return { ok: true, status: 200, body: { id: "reel-c" } };
        }
        if (method === "GET" && u.includes("/reel-c?")) {
          statusChecks += 1;
          if (statusChecks < 3) {
            return {
              ok: true,
              status: 200,
              body: { id: "reel-c", status_code: "IN_PROGRESS" },
            };
          }
          return {
            ok: true,
            status: 200,
            body: { id: "reel-c", status_code: "FINISHED" },
          };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media_publish`)) {
          assertX.equal(statusChecks >= 3, true);
          published = true;
          return { ok: true, status: 200, body: { id: "reel-media" } };
        }
        if (u.includes("/reel-media?")) {
          return { ok: true, status: 200, body: { id: "reel-media" } };
        }
        return { ok: false, status: 404, body: {} };
      }
    );
    assertX.equal(published, true);
    assertX.equal(result.items[0].json.mediaType, "REELS");
  });

  check("IG-M5-6 IN_PROGRESS bounded polling works", async () => {
    memoryStore.clear();
    let polls = 0;
    await assertX.rejects(
      () =>
        runPublish(
          {
            operation: "publish_image",
            imageUrl: HTTPS_IMG,
            maxPollAttempts: 3,
          },
          async (url, options = {}) => {
            const method = String(options.method || "GET").toUpperCase();
            const u = String(url);
            if (u.includes("/content_publishing_limit")) {
              return { ok: true, status: 200, body: { data: [{}] } };
            }
            if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
              return { ok: true, status: 200, body: { id: "slow-c" } };
            }
            if (u.includes("/slow-c?")) {
              polls += 1;
              return {
                ok: true,
                status: 200,
                body: { id: "slow-c", status_code: "IN_PROGRESS" },
              };
            }
            return { ok: false, status: 404, body: {} };
          }
        ),
      (err) => err.code === "INSTAGRAM_CONTAINER_TIMEOUT"
    );
    assertX.equal(polls, 3);
  });

  check("IG-M5-7 ERROR fails cleanly", async () => {
    memoryStore.clear();
    await assertX.rejects(
      () =>
        runPublish(
          { operation: "publish_image", imageUrl: HTTPS_IMG },
          async (url, options = {}) => {
            const method = String(options.method || "GET").toUpperCase();
            const u = String(url);
            if (u.includes("/content_publishing_limit")) {
              return { ok: true, status: 200, body: { data: [{}] } };
            }
            if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
              return { ok: true, status: 200, body: { id: "err-c" } };
            }
            if (u.includes("/err-c?")) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: "err-c",
                  status_code: "ERROR",
                  status: "Processing failed",
                },
              };
            }
            return { ok: false, status: 404, body: {} };
          }
        ),
      (err) => err.code === "INSTAGRAM_CONTAINER_ERROR"
    );
  });

  check("IG-M5-8 EXPIRED fails cleanly", async () => {
    memoryStore.clear();
    await assertX.rejects(
      () =>
        runPublish(
          { operation: "publish_image", imageUrl: HTTPS_IMG },
          async (url, options = {}) => {
            const method = String(options.method || "GET").toUpperCase();
            const u = String(url);
            if (u.includes("/content_publishing_limit")) {
              return { ok: true, status: 200, body: { data: [{}] } };
            }
            if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
              return { ok: true, status: 200, body: { id: "exp-c" } };
            }
            if (u.includes("/exp-c?")) {
              return {
                ok: true,
                status: 200,
                body: { id: "exp-c", status_code: "EXPIRED" },
              };
            }
            return { ok: false, status: 404, body: {} };
          }
        ),
      (err) => err.code === "INSTAGRAM_CONTAINER_EXPIRED"
    );
  });

  check("IG-M5-9 PUBLISHED does not republish duplicate", async () => {
    memoryStore.clear();
    let publishCalls = 0;
    const result = await runPublish(
      { operation: "publish_image", imageUrl: HTTPS_IMG },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        if (u.includes("/content_publishing_limit")) {
          return { ok: true, status: 200, body: { data: [{}] } };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          return { ok: true, status: 200, body: { id: "already-c" } };
        }
        if (u.includes("/already-c?")) {
          return {
            ok: true,
            status: 200,
            body: { id: "already-c", status_code: "PUBLISHED" },
          };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media_publish`)) {
          publishCalls += 1;
          return { ok: true, status: 200, body: { id: "should-not" } };
        }
        if (u.includes("/already-c?") || u.includes("fields=id%2Cpermalink")) {
          return { ok: true, status: 200, body: { id: "already-c" } };
        }
        return { ok: true, status: 200, body: { id: "already-c" } };
      }
    );
    assertX.equal(publishCalls, 0);
    assertX.equal(result.items[0].json.status, "published");
  });

  check("IG-M5-10 carousel creates children → parent → publish", async () => {
    memoryStore.clear();
    const created = [];
    const result = await runPublish(
      {
        operation: "publish_carousel",
        caption: "album",
        carouselItems: [
          { type: "IMAGE", mediaUrl: "https://cdn.example.com/1.jpg" },
          { type: "IMAGE", mediaUrl: "https://cdn.example.com/2.jpg" },
        ],
      },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        const body = String(options.body || "");
        if (u.includes("/content_publishing_limit")) {
          return { ok: true, status: 200, body: { data: [{}] } };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          if (body.includes("is_carousel_item")) {
            const id = `child-${created.length + 1}`;
            created.push(id);
            return { ok: true, status: 200, body: { id } };
          }
          if (body.includes("media_type=CAROUSEL")) {
            assertX.equal(body.includes("children=child-1%2Cchild-2") || body.includes("children=child-1,child-2"), true);
            return { ok: true, status: 200, body: { id: "parent-c" } };
          }
        }
        if (method === "GET" && /\/(child-\d|parent-c)\?/.test(u)) {
          return {
            ok: true,
            status: 200,
            body: { id: "x", status_code: "FINISHED" },
          };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media_publish`)) {
          return { ok: true, status: 200, body: { id: "carousel-media" } };
        }
        if (u.includes("/carousel-media?")) {
          return {
            ok: true,
            status: 200,
            body: { id: "carousel-media", media_type: "CAROUSEL_ALBUM" },
          };
        }
        return { ok: false, status: 404, body: { error: { message: u } } };
      }
    );
    assertX.deepEqual(created, ["child-1", "child-2"]);
    assertX.equal(result.items[0].json.mediaId, "carousel-media");
    assertX.deepEqual(result.items[0].json.childContainerIds, [
      "child-1",
      "child-2",
    ]);
  });

  check("IG-M5-11 carousel partial child failure prevents parent publish", async () => {
    memoryStore.clear();
    let parentCalls = 0;
    await assertX.rejects(
      () =>
        runPublish(
          {
            operation: "publish_carousel",
            carouselItems: [
              { type: "IMAGE", mediaUrl: "https://cdn.example.com/1.jpg" },
              { type: "IMAGE", mediaUrl: "https://cdn.example.com/2.jpg" },
            ],
          },
          async (url, options = {}) => {
            const method = String(options.method || "GET").toUpperCase();
            const u = String(url);
            const body = String(options.body || "");
            if (u.includes("/content_publishing_limit")) {
              return { ok: true, status: 200, body: { data: [{}] } };
            }
            if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
              if (body.includes("media_type=CAROUSEL")) {
                parentCalls += 1;
                return { ok: true, status: 200, body: { id: "parent" } };
              }
              if (body.includes("is_carousel_item")) {
                if (!body.includes("1.jpg") && body.includes("2.jpg")) {
                  return {
                    ok: false,
                    status: 400,
                    body: { error: { message: "child failed" } },
                  };
                }
                return { ok: true, status: 200, body: { id: "child-ok" } };
              }
            }
            if (u.includes("/child-ok?")) {
              return {
                ok: true,
                status: 200,
                body: { status_code: "FINISHED" },
              };
            }
            return { ok: false, status: 400, body: { error: { message: "fail" } } };
          }
        ),
      (err) => Boolean(err.code)
    );
    assertX.equal(parentCalls, 0);
  });

  check("IG-M5-12 story image/video contract validated", async () => {
    memoryStore.clear();
    const image = await runPublish(
      {
        operation: "publish_story",
        storyMediaType: "IMAGE",
        mediaUrl: HTTPS_IMG,
      },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        const body = String(options.body || "");
        if (u.includes("/content_publishing_limit")) {
          return { ok: true, status: 200, body: { data: [{}] } };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          assertX.equal(body.includes("media_type=STORIES"), true);
          assertX.equal(body.includes("image_url="), true);
          return { ok: true, status: 200, body: { id: "story-c" } };
        }
        if (u.includes("/story-c?")) {
          return { ok: true, status: 200, body: { status_code: "FINISHED" } };
        }
        if (method === "POST" && u.includes("media_publish")) {
          return { ok: true, status: 200, body: { id: "story-m" } };
        }
        return { ok: true, status: 200, body: { id: "story-m" } };
      }
    );
    assertX.equal(image.items[0].json.mediaType, "STORIES");

    memoryStore.clear();
    const video = await runPublish(
      {
        operation: "publish_story",
        storyMediaType: "VIDEO",
        mediaUrl: HTTPS_VID,
      },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        const body = String(options.body || "");
        if (u.includes("/content_publishing_limit")) {
          return { ok: true, status: 200, body: { data: [{}] } };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          assertX.equal(body.includes("video_url="), true);
          return { ok: true, status: 200, body: { id: "story-v" } };
        }
        if (u.includes("/story-v?")) {
          return { ok: true, status: 200, body: { status_code: "FINISHED" } };
        }
        if (method === "POST" && u.includes("media_publish")) {
          return { ok: true, status: 200, body: { id: "story-vm" } };
        }
        return { ok: true, status: 200, body: { id: "story-vm" } };
      }
    );
    assertX.equal(video.items[0].json.mediaId, "story-vm");
  });

  check("IG-M5-13 invalid/private/non-HTTPS media URL rejected", () => {
    assertX.throws(
      () => pub().assertInstagramPublicMediaUrl("http://cdn.example.com/a.jpg"),
      (err) => err.code === "INSTAGRAM_MEDIA_URL_INVALID"
    );
    assertX.throws(
      () => pub().assertInstagramPublicMediaUrl("https://localhost/a.jpg"),
      (err) => err.code === "INSTAGRAM_MEDIA_URL_INVALID"
    );
    assertX.throws(
      () => pub().assertInstagramPublicMediaUrl("https://192.168.0.5/a.jpg"),
      (err) => err.code === "INSTAGRAM_MEDIA_URL_INVALID"
    );
    assertX.throws(
      () => pub().assertInstagramPublicMediaUrl("file:///tmp/a.jpg"),
      (err) => err.code === "INSTAGRAM_MEDIA_URL_INVALID"
    );
    assertX.equal(
      pub().assertInstagramPublicMediaUrl(HTTPS_IMG),
      HTTPS_IMG
    );
  });

  check("IG-M5-14 publishing limit checked without hardcoded quota assumption", async () => {
    memoryStore.clear();
    await assertX.rejects(
      () =>
        runPublish(
          { operation: "publish_image", imageUrl: HTTPS_IMG },
          async (url) => {
            if (String(url).includes("/content_publishing_limit")) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: [{ quota_usage: 50, config: { quota_total: 50 } }],
                },
              };
            }
            return { ok: false, status: 500, body: {} };
          }
        ),
      (err) => err.code === "INSTAGRAM_PUBLISH_QUOTA_EXCEEDED"
    );
  });

  check("IG-M5-15 publishKey retry does not duplicate a successful post", async () => {
    memoryStore.clear();
    let publishCalls = 0;
    const transport = async (url, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      const u = String(url);
      if (u.includes("/content_publishing_limit")) {
        return { ok: true, status: 200, body: { data: [{}] } };
      }
      if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
        return { ok: true, status: 200, body: { id: "idem-c" } };
      }
      if (u.includes("/idem-c?")) {
        return { ok: true, status: 200, body: { status_code: "FINISHED" } };
      }
      if (method === "POST" && u.includes("media_publish")) {
        publishCalls += 1;
        return { ok: true, status: 200, body: { id: "idem-media" } };
      }
      return { ok: true, status: 200, body: { id: "idem-media", permalink: "https://instagram.com/p/i" } };
    };
    const first = await runPublish(
      {
        operation: "publish_image",
        imageUrl: HTTPS_IMG,
        publishKey: "post-1",
      },
      transport
    );
    assertX.equal(first.items[0].json.mediaId, "idem-media");
    assertX.equal(publishCalls, 1);
    const second = await runPublish(
      {
        operation: "publish_image",
        imageUrl: HTTPS_IMG,
        publishKey: "post-1",
      },
      transport
    );
    assertX.equal(publishCalls, 1);
    assertX.equal(second.output.idempotentReplay, true);
    assertX.equal(second.items[0].json.mediaId, "idem-media");
  });

  check("IG-M5-16 failed execution does not expose stale prior output", async () => {
    memoryStore.clear();
    // Seed a failed record that previously had a result (must not return it).
    memoryStore.set(`ws-1|wf-1|ig-pub-1|bad-key`, {
      id: "rec-1",
      workspaceId: "ws-1",
      workflowId: "wf-1",
      nodeId: "ig-pub-1",
      publishKey: "bad-key",
      credentialId: "cred-ig-m5",
      operation: "publish_image",
      status: "failed",
      containerId: "old-c",
      mediaId: "stale-media",
      result: {
        mediaId: "stale-media",
        status: "published",
        _meta: { provider: "instagram" },
      },
    });
    await assertX.rejects(
      () =>
        runPublish(
          {
            operation: "publish_image",
            imageUrl: HTTPS_IMG,
            publishKey: "bad-key",
          },
          async (url, options = {}) => {
            const method = String(options.method || "GET").toUpperCase();
            const u = String(url);
            if (u.includes("/content_publishing_limit")) {
              return { ok: true, status: 200, body: { data: [{}] } };
            }
            if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
              return { ok: true, status: 200, body: { id: "new-c" } };
            }
            if (u.includes("/new-c?")) {
              return {
                ok: true,
                status: 200,
                body: { status_code: "ERROR", status: "bad" },
              };
            }
            return { ok: false, status: 404, body: {} };
          }
        ),
      (err) => err.code === "INSTAGRAM_CONTAINER_ERROR"
    );
    const stored = memoryStore.get(`ws-1|wf-1|ig-pub-1|bad-key`);
    assertX.equal(stored.status, "failed");
    assertX.equal(stored.result, null);
  });

  check("IG-M5-17 expired auth uses M2 reconnect handling", async () => {
    memoryStore.clear();
    await assertX.rejects(
      () =>
        runPublish(
          { operation: "publish_image", imageUrl: HTTPS_IMG },
          async () => ({ ok: true, status: 200, body: {} }),
          {
            credOverrides: {
              config: { reconnectRequired: true },
            },
          }
        ),
      (err) => err.code === "INSTAGRAM_TOKEN_INVALID"
    );
  });

  check("IG-M5-18 no secrets appear in output/errors", async () => {
    memoryStore.clear();
    const result = await runPublish(
      { operation: "publish_image", imageUrl: HTTPS_IMG },
      async (url, options = {}) => {
        const method = String(options.method || "GET").toUpperCase();
        const u = String(url);
        if (u.includes("/content_publishing_limit")) {
          return { ok: true, status: 200, body: { data: [{}] } };
        }
        if (method === "POST" && u.endsWith(`/${IG_USER}/media`)) {
          return { ok: true, status: 200, body: { id: "sec-c" } };
        }
        if (u.includes("/sec-c?")) {
          return { ok: true, status: 200, body: { status_code: "FINISHED" } };
        }
        if (method === "POST" && u.includes("media_publish")) {
          return { ok: true, status: 200, body: { id: "sec-m" } };
        }
        return { ok: true, status: 200, body: { id: "sec-m" } };
      }
    );
    const dumped = JSON.stringify(result);
    assertX.equal(dumped.includes(TOKEN), false);
    assertX.equal(dumped.includes("access_token"), false);
  });

  check("IG-M5-19 M3 reads regression green", async () => {
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
              credentialId: "cred-ig-m5",
              resource: "account",
              operation: "get_profile",
            },
          },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );
    assertX.equal(profile.items[0].json.username, "brand_ig");
  });

  check("IG-M5-20 M4 insights regression green", async () => {
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
                values: [{ value: 3, end_time: "2026-03-01T00:00:00+0000" }],
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
              credentialId: "cred-ig-m5",
              resource: "insights",
              operation: "account_insights",
              insightsPreset: "overview",
              period: "day",
            },
          },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );
    assertX.equal(insights.items[0].json.metric, "views");
    assertX.equal(insights.items[0].json.value, 3);
  });

  check("IG-M5-21 Meta Ads GET-only/native/MCP regression green", async () => {
    assertX.deepEqual([...metaGraph().OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(metaGraph().API_VERSION, "v26.0");
    const adsSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assertX.equal(adsSrc.includes("instagram"), false);
    assertX.equal(
      adsSrc.includes('String(method || "GET").toUpperCase() !== "GET"'),
      true
    );
    await assertX.rejects(
      () =>
        metaAds().metaGraphRequest({
          accessToken: "x",
          path: "me",
          method: "POST",
        }),
      (err) => err.code === "META_PERMISSION_DENIED"
    );
    const igAuthSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagramAuth.service.js"),
      "utf8"
    );
    assertX.equal(
      /require\(["']\.\/workflowMetaAds\.service["']\)/.test(igAuthSrc),
      false
    );
    assertX.equal(igAuthSrc.includes("INSTAGRAM_ALLOWED_METHODS"), true);
  });

  check("IG-M5-22 AI dataset regression green", () => {
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
  registerInstagramM5Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} Instagram M5 checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerInstagramM5Tests };
