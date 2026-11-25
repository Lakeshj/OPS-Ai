/**
 * M10.3.5 — Perigon credential DB ENUM fix + connection management.
 * Uses real MySQL + real HTTP credential endpoints against the running backend
 * when available; always exercises the service layer against the live DB.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

const API_BASE = `http://127.0.0.1:${config.port || 5013}/api`;

(async () => {
  console.log("\nM10.3.5 Perigon credential DB + connection management");

  const { pool } = require("../config/database");
  const credentials = require("../modules/workflows/credentials.service");
  const service = () =>
    require("../services/workflowLinkedInLeadDiscovery.service");

  let workspaceId = null;
  let userId = null;
  let authUser = null;
  let token = null;

  await check("M1035-1 Live DB name + ENUM contains apify and perigon", async () => {
    const [[db]] = await pool.query("SELECT DATABASE() AS db");
    console.log(`       database=${db.db} host=${config.db.host}`);
    assert.equal(db.db, config.db.database);
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
    );
    const typeDef = String(cols[0].Type || "");
    console.log(`       ENUM=${typeDef}`);
    assert.match(typeDef, /apify/);
    assert.match(typeDef, /perigon/);
    assert.match(typeDef, /instagram/);
    assert.match(typeDef, /facebook_page/);
    assert.match(typeDef, /meta_ads/);
    assert.match(typeDef, /bearer/);

    const [mig] = await pool.query(
      "SELECT name FROM schema_migrations WHERE name IN (?, ?) ORDER BY name",
      [
        "035_perigon_credential.sql",
        "036_perigon_apify_credential_type_repair.sql",
      ]
    );
    assert.equal(mig.length, 2);
  });

  await check("M1035-2 Resolve workspace/user for live tests", async () => {
    const [wsRows] = await pool.execute("SELECT id FROM workspaces LIMIT 1");
    const [userRows] = await pool.execute("SELECT id FROM users LIMIT 1");
    assert.ok(wsRows.length, "need a workspace");
    assert.ok(userRows.length, "need a user");
    workspaceId = wsRows[0].id;
    userId = userRows[0].id;
    authUser = { userId, role: "system" };
    token = jwt.sign(
      { userId, role: "system" },
      config.jwt.secret,
      { expiresIn: "1h" }
    );
  });

  let createdId = null;

  await check("M1035-3 Service create Perigon credential (encrypted)", async () => {
    const created = await credentials.create(
      {
        workspaceId,
        name: `perigon-m1035-${Date.now()}`,
        type: "perigon",
        secret: { apiKey: "perigon_http_test_key_not_real" },
        config: {},
      },
      authUser
    );
    createdId = created.id;
    assert.equal(created.type, "perigon");
    assert.equal(created.connected, false);
    const loaded = await credentials.getForWorkspace(createdId, workspaceId);
    assert.equal(loaded.secret.apiKey, "perigon_http_test_key_not_real");
    // Public format must not leak the key
    assert.ok(!JSON.stringify(created).includes("perigon_http_test_key_not_real"));
  });

  await check("M1035-4 HTTP POST /workflows/credentials creates perigon", async () => {
    // Prefer an ephemeral in-process Express mount of the real /api routes so this
    // test does not depend on a hung/reloading nodemon process. Still exercises
    // authenticateToken → validateCredential → credentials.create → MySQL ENUM.
    const express = require("express");
    const apiRoutes = require("../routes");
    const {
      errorHandler,
      notFoundHandler,
    } = require("../middleware/errorHandler");
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", apiRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/workflows/credentials`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            workspaceId,
            name: `perigon-http-${Date.now()}`,
            type: "perigon",
            secret: { apiKey: "perigon_live_http_key_not_real" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status}: ${body.message || body.error || JSON.stringify(body)}`
        );
      }
      assert.equal(body.type, "perigon");
      assert.equal(body.connected, false);
      assert.ok(body.id);
      assert.ok(
        !JSON.stringify(body).includes("perigon_live_http_key_not_real")
      );

      const loaded = await credentials.getForWorkspace(body.id, workspaceId);
      assert.equal(loaded.secret.apiKey, "perigon_live_http_key_not_real");

      // HTTP DELETE without force while unused
      const del = await fetch(
        `http://127.0.0.1:${port}/api/workflows/credentials/${body.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      assert.equal(del.status, 200);
      const gone = await credentials.getForWorkspace(body.id, workspaceId);
      assert.equal(gone, null);

      // Also probe the long-running backend briefly (best-effort).
      try {
        const probe = await fetch(`${API_BASE}/`, {
          signal: AbortSignal.timeout(2000),
        });
        console.log(
          `       live backend /api probe status=${probe.status} (informational)`
        );
      } catch (_) {
        console.log(
          "       live backend /api probe timed out (nodemon may be restarting; ephemeral HTTP test still passed)"
        );
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await check("M1035-5 Update Perigon credential name + rotate key", async () => {
    const updated = await credentials.update(
      createdId,
      {
        name: `perigon-m1035-renamed`,
        secret: { apiKey: "perigon_rotated_key_not_real" },
      },
      authUser
    );
    assert.equal(updated.name, "perigon-m1035-renamed");
    assert.equal(updated.connected, false);
    const loaded = await credentials.getForWorkspace(createdId, workspaceId);
    assert.equal(loaded.secret.apiKey, "perigon_rotated_key_not_real");
  });

  await check("M1035-6 Usage detects perigonCredentialId references", async () => {
    const [wfRows] = await pool.execute(
      `SELECT id, name, definition_json FROM workflows
       WHERE workspace_id = ? AND deleted_at IS NULL LIMIT 1`,
      [workspaceId]
    );
    if (!wfRows.length) {
      console.log("       skip — no workflow to patch");
      return;
    }
    const wf = wfRows[0];
    let definition =
      typeof wf.definition_json === "string"
        ? JSON.parse(wf.definition_json || "{}")
        : wf.definition_json || {};
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    const probeNode = {
      id: `m1035-probe-${Date.now()}`,
      type: "linkedinLeadDiscovery",
      data: {
        dataProvider: "opsai_native",
        nativeSource: "perigon",
        perigonCredentialId: createdId,
      },
    };
    const nextDef = { ...definition, nodes: [...nodes, probeNode] };
    await pool.execute(
      `UPDATE workflows SET definition_json = ? WHERE id = ?`,
      [JSON.stringify(nextDef), wf.id]
    );
    const usage = await credentials.listCredentialUsage(createdId, authUser);
    assert.ok(usage.workflowCount >= 1);

    await assert.rejects(
      () => credentials.remove(createdId, authUser, { force: false }),
      (err) => err.code === "CREDENTIAL_IN_USE"
    );

    // restore workflow definition
    await pool.execute(
      `UPDATE workflows SET definition_json = ? WHERE id = ?`,
      [
        typeof wf.definition_json === "string"
          ? wf.definition_json
          : JSON.stringify(wf.definition_json),
        wf.id,
      ]
    );
  });

  await check("M1035-7 Force delete cleans up credential", async () => {
    await credentials.remove(createdId, authUser, { force: true });
    const gone = await credentials.getForWorkspace(createdId, workspaceId);
    assert.equal(gone, null);
    createdId = null;
  });

  await check("M1035-8 Perigon source sanitize + routing gates", () => {
    const sanitized = service().sanitizeLinkedInLeadDiscoveryNodeData({
      dataProvider: "opsai_native",
      nativeSource: "perigon",
      perigonCredentialId: "p1",
      nativeFeedUrl: "https://should-clear.example",
      nativeFeedCredentialId: "bearer-1",
      apifyCredentialId: "a1",
    });
    assert.equal(sanitized.nativeSource, "perigon");
    assert.equal(sanitized.perigonCredentialId, "p1");
    assert.equal(sanitized.nativeFeedUrl, undefined);
    assert.equal(sanitized.apifyCredentialId, undefined);

    const catalog = service().getLinkedInLeadDiscoveryCatalog();
    assert.ok(catalog.nativeSources.some((s) => s.id === "perigon"));
    assert.equal(catalog.perigon?.supportsGetPostDetails, false);
  });

  await check("M1035-9 FE connection management wiring", () => {
    const picker = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/CredentialPicker.tsx"
      ),
      "utf8"
    );
    assert.match(picker, /disconnectSelected/);
    assert.match(picker, /Force delete anyway/);
    assert.match(picker, /getCredentialUsage/);
    assert.match(picker, /Leave secret fields blank/);
    assert.match(picker, /allowedTypes\[0\]/);

    const fields = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/LinkedInLeadDiscoveryFields.tsx"
      ),
      "utf8"
    );
    assert.match(fields, /allowedTypes=\{\["perigon"\]\}/);
    assert.match(fields, /testLinkedInPerigon/);
    assert.match(fields, /nativeSource === "perigon"/);

    const mig = fs.readFileSync(
      path.join(
        __dirname,
        "../migrations/036_perigon_apify_credential_type_repair.sql"
      ),
      "utf8"
    );
    assert.match(mig, /'perigon'/);
    assert.match(mig, /'apify'/);
  });

  await check("M1035-10 Workspace isolation on getForWorkspace", async () => {
    const created = await credentials.create(
      {
        workspaceId,
        name: `perigon-iso-${Date.now()}`,
        type: "perigon",
        secret: { apiKey: "iso_key" },
        config: {},
      },
      authUser
    );
    const other = await credentials.getForWorkspace(
      created.id,
      "00000000-0000-0000-0000-000000000000"
    );
    assert.equal(other, null);
    await credentials.remove(created.id, authUser, { force: true });
  });

  console.log(`\n${passed} M10.3.5 checks passed`);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
