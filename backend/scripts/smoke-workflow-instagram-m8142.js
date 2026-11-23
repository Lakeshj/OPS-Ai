/**
 * Instagram M8.14.2 — Run Step list_media defaults + bounded pagination.
 * Tests the same executeInstagramNode entrypoint used by Run Step (via handlers).
 * Run: node scripts/smoke-workflow-instagram-m8142.js
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");

const ig = require("../services/workflowInstagram.service");
const nodes = require("../services/workflowNodes.service");

const IG_USER = "17841400000000001";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE_M8142";

const baseCred = () => ({
  id: "cred-ig-m8142",
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

/** Simulate an account with 60 media across Graph pages of 25. */
const makeTransport = () => {
  const TOTAL = 60;
  return async (url) => {
    const u = new URL(String(url));
    const limit = Number(u.searchParams.get("limit") || 25);
    const after = u.searchParams.get("after") || "";
    let start = 0;
    if (after.startsWith("C")) {
      start = Number(after.slice(1)) || 0;
    }
    const slice = [];
    for (let i = start; i < Math.min(start + limit, TOTAL); i += 1) {
      slice.push({
        id: `1798${String(i).padStart(12, "0")}`,
        media_type: "IMAGE",
        caption: `Post ${i}`,
        timestamp: "2026-03-15T12:00:00+0000",
        like_count: i,
        comments_count: 0,
        permalink: `https://www.instagram.com/p/p${i}/`,
      });
    }
    const nextStart = start + slice.length;
    const hasMore = nextStart < TOTAL;
    return {
      ok: true,
      status: 200,
      body: {
        data: slice,
        paging: hasMore
          ? {
              cursors: { after: `C${nextStart}` },
              next: `https://graph.facebook.com/media?access_token=${TOKEN}&after=C${nextStart}`,
            }
          : { cursors: {} },
      },
    };
  };
};

const runViaHandler = (data, transport) =>
  ig.withInstagramNodeTestHooks(
    {
      transport,
      loadCredential: async () => baseCred(),
    },
    () =>
      nodes.handlers.instagram(
        { id: "ig-1", type: "instagram", data },
        { workspaceId: "ws-1", items: [{ json: {} }], inputItems: [{ json: {} }] }
      )
  );

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

(async () => {
  console.log("\nInstagram M8.14.2 Run Step list_media defaults");

  await check("IG-M8142-1 missing limit → 25", () => {
    const n = ig.normalizeListMediaExecutionParams({
      resource: "media",
      operation: "list_media",
    });
    assert.equal(n.limit, 25);
    assert.equal(n.returnAll, false);
  });

  await check("IG-M8142-2 missing returnAll → false (never true)", () => {
    const n = ig.normalizeListMediaExecutionParams({
      resource: "media",
      operation: "list_media",
      limit: 25,
    });
    assert.equal(n.returnAll, false);
    assert.equal(ig.isExplicitReturnAll(undefined), false);
    assert.equal(ig.isExplicitReturnAll(null), false);
    assert.equal(ig.isExplicitReturnAll("false"), false);
    assert.equal(ig.isExplicitReturnAll(1), false);
    assert.equal(ig.isExplicitReturnAll(true), true);
  });

  await check("IG-M8142-3 Run Step legacy node → 25 items + hasNext", async () => {
    const transport = makeTransport();
    // Legacy saved node: no limit / returnAll / after
    const result = await runViaHandler(
      {
        credentialId: "cred-ig-m8142",
        resource: "media",
        operation: "list_media",
      },
      transport
    );
    assert.equal(result.items.length, 25);
    assert.equal(result.output.rowCount, 25);
    assert.equal(result.output.returnAll, false);
    assert.equal(result.output.limit, 25);
    assert.equal(result.output.truncated, true);
    assert.equal(result.output.paging.hasNext, true);
    assert.ok(result.output.paging.cursors.after);
    assert.equal(result.output.after, result.output.paging.cursors.after);
    assert.equal(result.items[0].json._meta.paging.hasNext, true);
    assert.equal(String(JSON.stringify(result)).includes("access_token="), false);
  });

  await check("IG-M8142-4 afterCursor returns different next page", async () => {
    const transport = makeTransport();
    const page1 = await runViaHandler(
      {
        credentialId: "cred-ig-m8142",
        resource: "media",
        operation: "list_media",
      },
      transport
    );
    const cursor = page1.output.after;
    assert.ok(cursor);
    const page2 = await runViaHandler(
      {
        credentialId: "cred-ig-m8142",
        resource: "media",
        operation: "list_media",
        afterCursor: cursor,
      },
      transport
    );
    assert.equal(page2.items.length, 25);
    assert.notEqual(page2.items[0].json.id, page1.items[0].json.id);
    assert.equal(page2.output.paging.hasNext, true);
  });

  await check("IG-M8142-5 returnAll=true can exceed 25", async () => {
    const transport = makeTransport();
    const result = await runViaHandler(
      {
        credentialId: "cred-ig-m8142",
        resource: "media",
        operation: "list_media",
        returnAll: true,
      },
      transport
    );
    assert.ok(result.items.length > 25);
    assert.equal(result.items.length, 60);
    assert.equal(result.output.returnAll, true);
  });

  await check("IG-M8142-6 sanitize applies list_media defaults", () => {
    const sanitized = ig.sanitizeInstagramNodeData({
      credentialId: "cred-ig-m8142",
      resource: "media",
      operation: "list_media",
    });
    assert.equal(sanitized.limit, 25);
    assert.equal(sanitized.returnAll, false);
  });

  await check("IG-M8142-7 handlers.instagram is Run Step entrypoint", () => {
    assert.equal(typeof nodes.handlers.instagram, "function");
  });

  await check("IG-M8142-8 FE show-more for media list", () => {
    const preview = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/InstagramOutputPreview.tsx"
      ),
      "utf8"
    );
    assert.match(preview, /MEDIA_LIST_PREVIEW_ROWS = 10/);
    assert.match(preview, /Show \$\{hiddenCount\} more/);
    assert.match(preview, /Show less/);
  });

  console.log(`\nM8.14.2 backend checks: ${passed} passed`);
  if (process.exitCode) console.error("M8.14.2 FAIL");
  else console.log("M8.14.2 PASS (backend)");
})();
