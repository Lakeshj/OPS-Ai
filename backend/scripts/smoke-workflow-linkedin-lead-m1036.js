/**
 * M10.3.6 — External provider auth must not log out of OpsAi.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../config");

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
  console.log("\nM10.3.6 External provider auth / OpsAi session isolation");

  const apifyProvider = () =>
    require("../services/linkedinLeadDiscovery/apifyProvider");
  const apifyClientMod = () =>
    require("../services/linkedinLeadDiscovery/apify/client");
  const perigon = () => require("../services/linkedinLeadDiscovery/perigon");
  const errorHandlerMod = () => require("../middleware/errorHandler");

  await check("M1036-1 Apify client maps upstream 401 → AppError HTTP 400", async () => {
    const client = apifyClientMod().createApifyClient({
      token: "bad",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "Unauthorized" }),
        headers: { get: () => null },
      }),
    });
    await assert.rejects(
      () => client.getMe(),
      (err) =>
        err.code === "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID" &&
        err.statusCode === 400
    );
  });

  await check("M1036-2 Apify getUsageStatus awaits rejection (no throw escape)", async () => {
    const client = {
      getMe: async () => {
        const AppError = require("../utils/AppError");
        throw new AppError(
          "Apify credentials are invalid or revoked.",
          400,
          "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID"
        );
      },
      getLimits: async () => ({ body: {} }),
    };
    const status = await apifyProvider().getUsageStatus({
      credential: { id: "c1", secret: { apiToken: "x" } },
      apifyClient: client,
    });
    assert.equal(status.available, false);
    assert.equal(status.connected, false);
    assert.equal(status.code, "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID");
  });

  await check("M1036-3 Usage HTTP endpoint returns 200 on invalid Apify", async () => {
    const { pool } = require("../config/database");
    const credentials = require("../modules/workflows/credentials.service");
    const [wsRows] = await pool.execute("SELECT id FROM workspaces LIMIT 1");
    const [userRows] = await pool.execute("SELECT id FROM users LIMIT 1");
    assert.ok(wsRows.length && userRows.length);
    const workspaceId = wsRows[0].id;
    const userId = userRows[0].id;
    const authUser = { userId, role: "system" };
    const created = await credentials.create(
      {
        workspaceId,
        name: `apify-m1036-${Date.now()}`,
        type: "apify",
        secret: { apiToken: "apify_api_invalid_for_m1036" },
        config: {},
      },
      authUser
    );

    // Patch provider usage to simulate Apify upstream 401 without network.
    const svc = require("../services/workflowLinkedInLeadDiscovery.service");
    const original = svc.getProviderUsageStatus;
    svc.getProviderUsageStatus = async () => {
      // Simulate the fixed soft path
      return {
        available: false,
        connected: false,
        code: "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID",
        reason: "Apify credentials are invalid or revoked.",
        free: null,
        paid: null,
      };
    };

    const apiRoutes = require("../routes");
    const {
      errorHandler,
      notFoundHandler,
    } = require("../middleware/errorHandler");
    const app = express();
    app.use(express.json());
    app.use("/api", apiRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    const token = jwt.sign(
      { userId, role: "system" },
      config.jwt.secret,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/workflows/linkedin-lead-discovery/usage?provider=apify&credentialId=${encodeURIComponent(created.id)}&workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.available, false);
      assert.equal(body.code, "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID");
      assert.notEqual(res.status, 401);
    } finally {
      svc.getProviderUsageStatus = original;
      await new Promise((resolve) => server.close(resolve));
      await credentials.remove(created.id, authUser, { force: true });
    }
  });

  await check("M1036-4 errorHandler remaps operational provider 401 → 400", () => {
    const { errorHandler } = errorHandlerMod();
    const AppError = require("../utils/AppError");
    const err = new AppError(
      "Apify credentials are invalid",
      401,
      "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID"
    );
    let status = null;
    let body = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    errorHandler(err, { method: "GET", originalUrl: "/test" }, res, () => {});
    assert.equal(status, 400);
    assert.equal(body.code, "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID");
  });

  await check("M1036-5 OpsAi UNAUTHORIZED 401 remains 401", () => {
    const { errorHandler } = errorHandlerMod();
    const AppError = require("../utils/AppError");
    const err = new AppError(
      "Invalid or expired token",
      401,
      "UNAUTHORIZED"
    );
    let status = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    };
    errorHandler(err, { method: "GET", originalUrl: "/test" }, res, () => {});
    assert.equal(status, 401);
  });

  await check("M1036-6 Perigon invalid key uses HTTP 400", () => {
    const err = perigon().errors.classifyHttpError(401, {
      message: "Invalid API key",
    });
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, "LINKEDIN_LEAD_PERIGON_KEY_INVALID");
  });

  await check("M1036-7 Frontend interceptor isolates provider codes", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/shared/apiClient.ts"),
      "utf8"
    );
    assert.match(src, /opsAiSessionFailure/);
    assert.match(src, /LINKEDIN_LEAD_/);
    assert.match(src, /skipUnauthorizedHandler/);
    const api = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/api.ts"),
      "utf8"
    );
    assert.match(api, /linkedin-lead-discovery\/usage[\s\S]*skipUnauthorizedHandler:\s*true/);
    const fields = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/LinkedInLeadDiscoveryFields.tsx"
      ),
      "utf8"
    );
    assert.match(fields, /Debounce mount\/restore/);
    assert.match(fields, /LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID/);
  });

  await check("M1036-8 getUsageStatus awaits fetchUsageStatus", () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        "../services/linkedinLeadDiscovery/apifyProvider.js"
      ),
      "utf8"
    );
    assert.match(src, /return await fetchUsageStatus\(/);
    // Ensure the usage path cannot bare-return the promise (comment mentions the
    // anti-pattern; assert the executable line is await-only).
    const usageFn = src.slice(src.indexOf("const getUsageStatus"));
    const end = usageFn.indexOf("\nconst prepareEntitlement");
    const body = end > 0 ? usageFn.slice(0, end) : usageFn;
    assert.match(body, /return await fetchUsageStatus\(/);
    assert.equal(
      (body.match(/^\s*return fetchUsageStatus\(/m) || []).length,
      0
    );
  });

  console.log(`\n${passed} M10.3.6 checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {}
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
