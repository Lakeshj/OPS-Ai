/**
 * M10.3.13 — Google Sheets OAuth redirect safety + LinkedIn-compatible write path.
 * Offline / mocked only — no live Google or Apify charges.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

const fixturePath = path.join(
  __dirname,
  "fixtures/linkedin-lead-m10311-25posts.json"
);

(async () => {
  console.log("\nM10.3.13 Google Sheets OAuth + LinkedIn output compatibility");

  await check("M10313-1 Local redirect not forced to production in development", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../config/index.js"),
      "utf8"
    );
    assert.match(src, /isLiveRuntime/);
    assert.match(src, /GOOGLE_OAUTH_FORCE_PUBLIC_REDIRECT/);
    assert.match(src, /never force a public redirect/);
  });

  await check("M10313-2 OAuth popup timeout + soft source fallback", () => {
    const popup = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/googleOAuthPopup.ts"
      ),
      "utf8"
    );
    assert.match(popup, /OAUTH_POPUP_TIMEOUT_MS/);
    assert.match(popup, /reason === "source"/);
    assert.match(popup, /redirect URI/);
  });

  await check("M10313-3 Sheets schema has Append or Update + column mapping", () => {
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assert.match(schema, /appendOrUpdateRows/);
    assert.match(schema, /columnMappings/);
    assert.match(schema, /matchColumn/);
  });

  const googleNodes = () =>
    require("../services/workflowGoogleNodes.service");

  await check("M10313-4 Nested path + array cells + formula neutralization", () => {
    const {
      toSheetCell,
      getPathValue,
      itemsToMatrix,
      parseColumnMappings,
    } = googleNodes();
    const lead = {
      sourcePostId: "urn:li:activity:1234567890123456789",
      content: "=HYPERLINK(\"http://evil\")",
      matchedKeywords: ["seo", "agency"],
      author: { name: "Oryntic Labs", headline: "Product", profileUrl: "https://x" },
      engagement: { likes: 12, comments: 4, reposts: 1 },
    };
    assert.equal(getPathValue(lead, "author.name"), "Oryntic Labs");
    assert.equal(getPathValue(lead, "engagement.likes"), 12);
    assert.equal(
      toSheetCell(lead.matchedKeywords),
      "seo, agency"
    );
    assert.equal(
      toSheetCell(lead.content, { valueInputMode: "USER_ENTERED" }),
      "'=HYPERLINK(\"http://evil\")"
    );
    assert.equal(
      toSheetCell(lead.sourcePostId, { valueInputMode: "RAW" }),
      "urn:li:activity:1234567890123456789"
    );

    const mappings = parseColumnMappings([
      { header: "Author Name", path: "author.name" },
      { header: "Post Content", path: "content" },
      { header: "Matched Keywords", path: "matchedKeywords" },
      { header: "Source Post ID", path: "sourcePostId" },
      { header: "Likes", path: "engagement.likes" },
    ]);
    const matrix = itemsToMatrix(
      [{ json: lead }],
      false,
      null,
      { columnMappings: mappings, valueInputMode: "USER_ENTERED" }
    );
    assert.equal(matrix.length, 1);
    assert.equal(matrix[0][0], "Oryntic Labs");
    assert.equal(matrix[0][1], "'=HYPERLINK(\"http://evil\")");
    assert.equal(matrix[0][2], "seo, agency");
    assert.equal(matrix[0][3], "urn:li:activity:1234567890123456789");
    assert.equal(matrix[0][4], 12);
  });

  await check("M10313-5 Empty input skips append (no blank rows)", async () => {
    const { withGoogleOAuthTestHooks } = require("../services/googleOAuth.service");
    const calls = [];
    await withGoogleOAuthTestHooks(
      {
        transport: async (url, opts) => {
          calls.push({ url, method: opts?.method });
          return { ok: true, status: 200, body: { updates: { updatedRange: "A2" } } };
        },
        credentialResolver: async () => ({
          id: "c1",
          workspaceId: "w1",
          type: "google_sheets",
          config: { connected: true },
          secret: {
            accessToken: "tok",
            refreshToken: "ref",
            expiryMs: Date.now() + 60_000,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
          },
        }),
      },
      async () => {
        const { runSheets } = googleNodes();
        const out = await runSheets(
          {
            data: {
              credentialId: "c1",
              operation: "appendRows",
              spreadsheetId: "ss1",
              sheetName: "Leads",
              range: "A:Z",
            },
          },
          { workspaceId: "w1", inputItems: [] },
          null,
          []
        );
        assert.equal(out.output.skippedEmpty, true);
        assert.equal(out.items.length, 0);
        assert.equal(calls.length, 0);
      }
    );
  });

  await check("M10313-6 Append or Update matches Source Post ID", async () => {
    const { withGoogleOAuthTestHooks } = require("../services/googleOAuth.service");
    const calls = [];
    await withGoogleOAuthTestHooks(
      {
        transport: async (url, opts) => {
          const method = String(opts?.method || "GET").toUpperCase();
          calls.push({ url: String(url), method, body: opts?.body });
          if (method === "GET") {
            return {
              ok: true,
              status: 200,
              body: {
                values: [
                  [
                    "Source Post ID",
                    "Author Name",
                    "Post Content",
                    "Manual Notes",
                  ],
                  [
                    "urn:li:activity:existing",
                    "Old Author",
                    "Old content",
                    "keep-me",
                  ],
                ],
              },
            };
          }
          return {
            ok: true,
            status: 200,
            body: {
              updates: { updatedRange: "Sheet1!A3:C3" },
              updatedCells: 3,
            },
          };
        },
        credentialResolver: async () => ({
          id: "c1",
          workspaceId: "w1",
          type: "google_sheets",
          config: { connected: true },
          secret: {
            accessToken: "tok",
            refreshToken: "ref",
            expiryMs: Date.now() + 60_000,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
          },
        }),
      },
      async () => {
        const { runSheets } = googleNodes();
        const mappings = [
          { header: "Source Post ID", path: "sourcePostId" },
          { header: "Author Name", path: "author.name" },
          { header: "Post Content", path: "content" },
        ];
        const out = await runSheets(
          {
            data: {
              credentialId: "c1",
              operation: "appendOrUpdateRows",
              spreadsheetId: "ss1",
              sheetName: "Leads",
              range: "A:Z",
              matchColumn: "Source Post ID",
              columnMappings: mappings,
              hasHeaderRow: true,
            },
          },
          { workspaceId: "w1" },
          null,
          [
            {
              json: {
                sourcePostId: "urn:li:activity:existing",
                content: "Updated content",
                author: { name: "Updated Author" },
              },
            },
            {
              json: {
                sourcePostId: "urn:li:activity:new",
                content: "Brand new post",
                author: { name: "New Author" },
              },
            },
          ]
        );
        assert.equal(out.output.updated, 1);
        assert.equal(out.output.appended, 1);
        const put = calls.find((c) => c.method === "PUT");
        const append = calls.find(
          (c) => c.method === "POST" && /:append/.test(c.url)
        );
        assert.ok(put, "existing row updated via PUT");
        assert.ok(append, "new row appended");
        const schema = fs.readFileSync(
          path.join(
            __dirname,
            "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
          ),
          "utf8"
        );
        assert.match(schema, /value: "appendRows"/);
        assert.match(schema, /value: "appendOrUpdateRows"/);
      }
    );
  });

  await check("M10313-7 LinkedIn fixture is one item per post (no wrapper concat)", () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const { mapApifyItems } = require("../services/linkedinLeadDiscovery/apify/mapResults");
    const { normalizeLeadItems } = require("../services/linkedinLeadDiscovery/normalize");
    const mapped = mapApifyItems(fixture.posts.slice(0, 3));
    const normalized = normalizeLeadItems(mapped, {
      provider: "apify",
      operation: "discover_by_category",
    });
    assert.equal(normalized.length, 3);
    for (const row of normalized) {
      assert.equal(row._meta.provider, "linkedin_lead_discovery");
      assert.ok(row.sourcePostId || row.content);
    }
    // Sheets write path uses inputItems only — document in service.
    const svc = fs.readFileSync(
      path.join(__dirname, "../services/workflowGoogleNodes.service.js"),
      "utf8"
    );
    assert.match(svc, /appendOrUpdateRows/);
    assert.doesNotMatch(svc, /linkedin_lead_discovery/);
  });

  await check("M10313-8 Isolation: GSC/GA4/Gmail products unchanged in GOOGLE_PRODUCTS", () => {
    const { GOOGLE_PRODUCTS } = require("../services/googleOAuth.service");
    assert.ok(GOOGLE_PRODUCTS.google_gsc);
    assert.ok(GOOGLE_PRODUCTS.google_ga4);
    assert.ok(GOOGLE_PRODUCTS.google_gmail);
    assert.ok(GOOGLE_PRODUCTS.google_sheets);
    assert.deepEqual(GOOGLE_PRODUCTS.google_sheets.scopes, [
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
  });

  console.log(`\nM10.3.13 checks passed: ${passed}`);
  console.log(process.exitCode ? "M10.3.13 FAIL" : "M10.3.13 PASS (offline)");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
