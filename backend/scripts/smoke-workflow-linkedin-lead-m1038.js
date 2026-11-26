/**
 * M10.3.8 — Cross-type credential name uniqueness (workspace + type + name).
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

const startEphemeralApi = async () => {
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
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

(async () => {
  console.log("\nM10.3.8 Cross-type credential name uniqueness");

  const { pool } = require("../config/database");
  const credentials = require("../modules/workflows/credentials.service");
  const {
    allocateUniqueCredentialName,
  } = require("../services/credentialName.util");

  let workspaceId = null;
  let otherWorkspaceId = null;
  let authUser = null;
  let token = null;
  const createdIds = [];
  const track = (cred) => {
    if (cred?.id) createdIds.push(cred.id);
    return cred;
  };

  await check("M1038-1 Migration + unique index (workspace, type, name)", async () => {
    const [mig] = await pool.query(
      "SELECT name FROM schema_migrations WHERE name = ?",
      ["037_credential_name_unique_per_type.sql"]
    );
    assert.equal(mig.length, 1, "037 migration must be applied");

    const [oldIdx] = await pool.query(
      "SHOW INDEX FROM workflow_credentials WHERE Key_name = 'uq_workflow_credentials_name'"
    );
    assert.equal(oldIdx.length, 0, "old workspace+name unique must be dropped");

    const [newIdx] = await pool.query(
      "SHOW INDEX FROM workflow_credentials WHERE Key_name = 'uq_workflow_credentials_workspace_type_name'"
    );
    const cols = newIdx.map((r) => r.Column_name);
    assert.deepEqual(cols, ["workspace_id", "type", "name"]);
  });

  await check("M1038-2 Resolve workspace + auth", async () => {
    const [wsRows] = await pool.execute(
      "SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 2"
    );
    const [userRows] = await pool.execute("SELECT id FROM users LIMIT 1");
    assert.ok(wsRows.length);
    assert.ok(userRows.length);
    workspaceId = wsRows[0].id;
    otherWorkspaceId = wsRows[1]?.id || null;
    authUser = { userId: userRows[0].id, role: "system" };
    token = jwt.sign(
      { userId: userRows[0].id, role: "system" },
      config.jwt.secret,
      { expiresIn: "1h" }
    );
    await pool.execute(
      `DELETE FROM workflow_credentials
       WHERE workspace_id = ? AND (
         name LIKE 'SocialChamps Apify%'
         OR name LIKE 'm1038-%'
         OR LOWER(name) LIKE 'socialchamps apify%'
       )`,
      [workspaceId]
    );
  });

  let bearerId = null;
  let apifyId = null;

  await check("M1038-3 Bearer + Apify same display name both succeed", async () => {
    const bearer = track(
      await credentials.create(
        {
          workspaceId,
          name: "SocialChamps Apify",
          type: "bearer",
          secret: { token: "bearer_m1038" },
        },
        authUser
      )
    );
    bearerId = bearer.id;
    assert.equal(bearer.type, "bearer");
    assert.equal(bearer.name, "SocialChamps Apify");

    const apify = track(
      await credentials.create(
        {
          workspaceId,
          name: "SocialChamps Apify",
          type: "apify",
          secret: { apiToken: "apify_m1038" },
        },
        authUser
      )
    );
    apifyId = apify.id;
    assert.equal(apify.type, "apify");
    assert.equal(apify.name, "SocialChamps Apify");
    assert.notEqual(bearerId, apifyId);
  });

  await check("M1038-4 Respective pickers see only their type", async () => {
    const list = await credentials.listByWorkspace(workspaceId, authUser);
    const apifyListed = list.filter((c) => c.type === "apify");
    const bearerListed = list.filter((c) => c.type === "bearer");
    assert.ok(apifyListed.some((c) => c.id === apifyId));
    assert.ok(bearerListed.some((c) => c.id === bearerId));
    assert.ok(!apifyListed.some((c) => c.id === bearerId));
    assert.ok(!bearerListed.some((c) => c.id === apifyId));
  });

  await check("M1038-5 Same-type duplicate rejected (CI)", async () => {
    await assert.rejects(
      () =>
        credentials.create(
          {
            workspaceId,
            name: "SocialChamps Apify",
            type: "apify",
            secret: { apiToken: "dup" },
          },
          authUser
        ),
      (err) =>
        err.code === "CREDENTIAL_NAME_EXISTS" &&
        /already exists/i.test(err.message) &&
        /\(apify\)/i.test(err.message)
    );
    await assert.rejects(
      () =>
        credentials.create(
          {
            workspaceId,
            name: "socialchamps apify",
            type: "apify",
            secret: { apiToken: "case_dup" },
          },
          authUser
        ),
      (err) => err.code === "CREDENTIAL_NAME_EXISTS"
    );
  });

  await check("M1038-6 Delete Apify + recreate same name; bearer untouched", async () => {
    await credentials.remove(apifyId, authUser, { force: true });
    const idx = createdIds.indexOf(apifyId);
    if (idx >= 0) createdIds.splice(idx, 1);
    const bearerStill = await credentials.getForWorkspace(bearerId, workspaceId);
    assert.ok(bearerStill);
    assert.equal(bearerStill.type, "bearer");
    assert.equal(bearerStill.name, "SocialChamps Apify");

    const recreated = track(
      await credentials.create(
        {
          workspaceId,
          name: "SocialChamps Apify",
          type: "apify",
          secret: { apiToken: "apify_recreate" },
        },
        authUser
      )
    );
    apifyId = recreated.id;
    assert.equal(recreated.name, "SocialChamps Apify");
  });

  await check("M1038-7 Workflow ID references remain valid", async () => {
    const [wfRows] = await pool.execute(
      `SELECT id, definition_json FROM workflows
       WHERE workspace_id = ? AND deleted_at IS NULL LIMIT 1`,
      [workspaceId]
    );
    if (!wfRows.length) {
      console.log("       skip — no workflow");
      return;
    }
    const wf = wfRows[0];
    const original =
      typeof wf.definition_json === "string"
        ? wf.definition_json
        : JSON.stringify(wf.definition_json);
    let definition;
    try {
      definition = JSON.parse(original || "{}");
    } catch {
      definition = {};
    }
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    const probe = {
      id: `m1038-probe-${Date.now()}`,
      type: "linkedinLeadDiscovery",
      data: {
        dataProvider: "apify",
        apifyCredentialId: apifyId,
        nativeFeedCredentialId: bearerId,
      },
    };
    await pool.execute(`UPDATE workflows SET definition_json = ? WHERE id = ?`, [
      JSON.stringify({ ...definition, nodes: [...nodes, probe] }),
      wf.id,
    ]);
    try {
      const usageA = await credentials.listCredentialUsage(apifyId, authUser);
      const usageB = await credentials.listCredentialUsage(bearerId, authUser);
      assert.ok(usageA.workflowCount >= 1);
      assert.ok(usageB.workflowCount >= 1);
      const secretA = await credentials.getSecretForWorkspace(
        apifyId,
        workspaceId
      );
      const secretB = await credentials.getSecretForWorkspace(
        bearerId,
        workspaceId
      );
      assert.equal(secretA.type, "apify");
      assert.equal(secretB.type, "bearer");
      assert.equal(secretA.secret.apiToken, "apify_recreate");
      assert.equal(secretB.secret.token, "bearer_m1038");
    } finally {
      await pool.execute(
        `UPDATE workflows SET definition_json = ? WHERE id = ?`,
        [original, wf.id]
      );
    }
  });

  await check("M1038-8 Google/OAuth allocate remains type-scoped", async () => {
    const n1 = await allocateUniqueCredentialName(
      workspaceId,
      "SocialChamps Apify",
      { type: "google_gsc" }
    );
    assert.equal(n1, "SocialChamps Apify");
    const n2 = await allocateUniqueCredentialName(
      workspaceId,
      "SocialChamps Apify",
      { type: "apify" }
    );
    assert.equal(n2, "SocialChamps Apify (2)");
  });

  await check("M1038-9 HTTP create cross-type + same-type 409", async () => {
    const api = await startEphemeralApi();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
    const name = `m1038-http-${Date.now()}`;
    try {
      const bearerRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            name,
            type: "bearer",
            secret: { token: "http_bearer" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const bearerBody = await bearerRes.json();
      assert.ok([200, 201].includes(bearerRes.status));
      track(bearerBody);

      const apifyRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            name,
            type: "apify",
            secret: { apiToken: "http_apify" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const apifyBody = await apifyRes.json();
      assert.ok([200, 201].includes(apifyRes.status), JSON.stringify(apifyBody));
      assert.equal(apifyBody.name, name);
      assert.equal(apifyBody.type, "apify");
      track(apifyBody);

      const dupRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            name,
            type: "apify",
            secret: { apiToken: "http_dup" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const dupBody = await dupRes.json();
      assert.equal(dupRes.status, 409);
      assert.equal(dupBody.code, "CREDENTIAL_NAME_EXISTS");
      assert.notEqual(dupBody.error, "Resource already exists");
    } finally {
      await api.close();
    }
  });

  await check("M1038-10 Workspace isolation preserved", async () => {
    if (!otherWorkspaceId) {
      console.log("       skip — one workspace");
      return;
    }
    const a = track(
      await credentials.create(
        {
          workspaceId,
          name: "m1038-iso",
          type: "apify",
          secret: { apiToken: "iso_a" },
        },
        authUser
      )
    );
    const b = track(
      await credentials.create(
        {
          workspaceId: otherWorkspaceId,
          name: "m1038-iso",
          type: "apify",
          secret: { apiToken: "iso_b" },
        },
        authUser
      )
    );
    assert.notEqual(a.id, b.id);
  });

  await check("M1038-11 FE manage-other + locks + session isolation", () => {
    const picker = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/CredentialPicker.tsx"
      ),
      "utf8"
    );
    assert.match(picker, /otherWorkspaceApiKeys/);
    assert.match(picker, /Manage.*other workspace/s);
    assert.match(picker, /savingLockRef/);
    assert.match(picker, /beginEditCredential/);
    assert.match(picker, /removeCredential/);
    assert.match(picker, /disconnectSelected/);

    const util = fs.readFileSync(
      path.join(__dirname, "../services/credentialName.util.js"),
      "utf8"
    );
    assert.match(util, /workspace_id, type, name|AND type = \?/);

    const apiClient = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/shared/apiClient.ts"
      ),
      "utf8"
    );
    assert.match(apiClient, /CREDENTIAL_NAME_EXISTS/);
    assert.match(apiClient, /opsAiSessionFailure/);
  });

  await check("M1038-12 Lookups remain ID-based (no name resolution)", () => {
    const service = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/credentials.service.js"),
      "utf8"
    );
    assert.match(service, /getSecretForWorkspace = async \(credentialId/);
    assert.match(service, /getForWorkspace = async \(credentialId/);
    assert.doesNotMatch(
      service,
      /WHERE workspace_id = \? AND name = \? AND type/
    );
  });

  for (const id of [...createdIds]) {
    try {
      await credentials.remove(id, authUser, { force: true });
    } catch {
      await pool.execute(`DELETE FROM workflow_credentials WHERE id = ?`, [id]);
    }
  }

  console.log(`\nM10.3.8 checks passed: ${passed}`);
  if (process.exitCode) {
    console.error("M10.3.8 FAIL");
  } else {
    console.log("M10.3.8 PASS");
  }
  try {
    await pool.end();
  } catch {
    // ignore pool shutdown races on Windows
  }
})().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch {}
});
