/**
 * Instagram M8.14 — Media List pagination UX (default limit 25, after cursor).
 * Run: node scripts/smoke-workflow-instagram-m814.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ig = require("../services/workflowInstagram.service");
const picker = require("../services/workflowInstagramPicker.service");

const IG_USER = "17841400000000001";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE";

const baseCred = () => ({
  id: "cred-ig-m814",
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
  },
});

const runNode = (data, transport) =>
  ig.withInstagramNodeTestHooks(
    {
      transport,
      loadCredential: async () => baseCred(),
    },
    () =>
      ig.executeInstagramNode(
        { id: "ig-1", type: "instagram", data },
        { workspaceId: "ws-1", items: [{ json: {} }] }
      )
  );

let passed = 0;
const check = (name, fn) => {
  const run = async () => {
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
  return run();
};

(async () => {
  console.log("\nInstagram M8.14 Media pagination");

  await check("IG-M814-1 DEFAULT_LIMIT is 25", () => {
    assert.equal(ig.DEFAULT_LIMIT, 25);
    assert.equal(ig.MAX_LIMIT, 100);
  });

  await check("IG-M814-2 default list_media returns at most 25", async () => {
    let seenLimit = null;
    let pages = 0;
    const result = await runNode(
      {
        credentialId: "cred-ig-m814",
        resource: "media",
        operation: "list_media",
        // no limit / returnAll → defaults
      },
      async (url) => {
        pages += 1;
        const u = new URL(String(url));
        seenLimit = u.searchParams.get("limit");
        const start = (pages - 1) * 25;
        const data = Array.from({ length: 25 }, (_, i) => ({
          id: `17900000000000${String(start + i).padStart(3, "0")}`,
          media_type: "IMAGE",
        }));
        return {
          ok: true,
          status: 200,
          body: {
            data,
            paging: {
              cursors: { after: `CURSOR_P${pages}` },
              next: `https://graph.facebook.com/media?access_token=${TOKEN}`,
            },
          },
        };
      }
    );
    assert.equal(seenLimit, "25");
    assert.equal(pages, 1);
    assert.equal(result.items.length, 25);
    assert.equal(result.output.truncated, true);
    assert.equal(result.output.paging.hasNext, true);
    assert.equal(result.output.paging.cursors.after, "CURSOR_P1");
    assert.equal(result.output.after, "CURSOR_P1");
    assert.equal(result.items[0].json.paging, undefined);
    assert.equal(result.items[0].json._meta.paging.hasNext, true);
    assert.equal(result.items[0].json._meta.paging.cursors.after, "CURSOR_P1");
    assert.equal(String(JSON.stringify(result)).includes("access_token="), false);
  });

  await check("IG-M814-3 returnAll false does not exhaust pages", async () => {
    let pages = 0;
    const result = await runNode(
      {
        credentialId: "cred-ig-m814",
        resource: "media",
        operation: "list_media",
        returnAll: false,
        limit: 25,
      },
      async () => {
        pages += 1;
        return {
          ok: true,
          status: 200,
          body: {
            data: Array.from({ length: 25 }, (_, i) => ({
              id: `17910000000000${String(i).padStart(3, "0")}`,
              media_type: "IMAGE",
            })),
            paging: {
              cursors: { after: "MORE" },
              next: `https://graph.facebook.com/media?access_token=${TOKEN}`,
            },
          },
        };
      }
    );
    assert.equal(pages, 1);
    assert.equal(result.items.length, 25);
    assert.equal(result.output.paging.cursors.after, "MORE");
  });

  await check("IG-M814-4 after cursor is forwarded to Graph", async () => {
    let seenAfter = null;
    const result = await runNode(
      {
        credentialId: "cred-ig-m814",
        resource: "media",
        operation: "list_media",
        returnAll: false,
        limit: 10,
        after: "PREV_CURSOR",
      },
      async (url) => {
        const u = new URL(String(url));
        seenAfter = u.searchParams.get("after");
        return {
          ok: true,
          status: 200,
          body: {
            data: [{ id: "17920000000000001", media_type: "IMAGE" }],
            paging: { cursors: { after: "NEXT_CURSOR" }, next: "https://x" },
          },
        };
      }
    );
    assert.equal(seenAfter, "PREV_CURSOR");
    assert.equal(result.items.length, 1);
    assert.equal(result.output.after, "NEXT_CURSOR");
  });

  await check("IG-M814-5 rejects URL after cursor", async () => {
    await assert.rejects(
      () =>
        runNode(
          {
            credentialId: "cred-ig-m814",
            resource: "media",
            operation: "list_media",
            after: `https://graph.facebook.com/media?access_token=${TOKEN}`,
          },
          async () => ({ ok: true, status: 200, body: { data: [] } })
        ),
      (err) => err.code === "INSTAGRAM_PAGING_CURSOR_INVALID"
    );
  });

  await check("IG-M814-6 rowLimits caps non-returnAll at MAX_LIMIT", () => {
    const limits = ig.rowLimits({ limit: 999, returnAll: false });
    assert.equal(limits.maxRows, 100);
    assert.equal(limits.returnAll, false);
    const defaults = ig.rowLimits({ returnAll: false });
    assert.equal(defaults.maxRows, 25);
  });

  await check("IG-M814-7 picker stays bounded at 25", async () => {
    let seenLimit = null;
    await ig.withInstagramNodeTestHooks(
      {
        loadCredential: async () => baseCred(),
        transport: async (url) => {
          const u = new URL(String(url));
          seenLimit = u.searchParams.get("limit");
          return {
            ok: true,
            status: 200,
            body: {
              data: [{ id: "17930000000000001", media_type: "IMAGE", caption: "x" }],
              paging: { cursors: { after: "P" }, next: "https://x" },
            },
          };
        },
      },
      async () => {
        const result = await picker.listMediaOptions({
          credentialId: "cred-ig-m814",
          workspaceId: "ws-1",
        });
        assert.equal(result.options.length, 1);
        assert.equal(result.truncated, true);
      }
    );
    assert.equal(seenLimit, "25");
  });

  await check("IG-M814-8 schema defaults", () => {
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assert.match(schema, /name: "returnAll"/);
    assert.match(schema, /default: false/);
    assert.match(schema, /name: "limit"/);
    assert.match(schema, /default: 25/);
    assert.match(schema, /name: "after"/);
    assert.match(schema, /displayName: "After cursor"/);
    assert.match(schema, /max: 100/);
  });

  console.log(`\nM8.14 backend checks: ${passed} passed`);
  if (process.exitCode) console.error("M8.14 FAIL");
  else console.log("M8.14 PASS (backend)");
})();
