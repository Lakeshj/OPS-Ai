/**
 * M10.3.7 — Credential deletion, duplicate conflict, connection state.
 * Live MySQL + ephemeral HTTP against real credential routes.
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
  console.log("\nM10.3.7 Credential deletion / duplicate / connection state");

  const { pool } = require("../config/database");
  const credentials = require("../modules/workflows/credentials.service");
  const {
    normalizeCredentialNameKey,
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

  await check("M1037-1 Resolve workspace + auth", async () => {
    const [wsRows] = await pool.execute(
      "SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 2"
    );
    const [userRows] = await pool.execute("SELECT id FROM users LIMIT 1");
    assert.ok(wsRows.length, "need a workspace");
    assert.ok(userRows.length, "need a user");
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
         OR name LIKE 'm1037-%'
         OR name LIKE 'socialchamps apify%'
       )`,
      [workspaceId]
    );
  });

  let connectionA = null;

  await check("M1037-2 Create connection A (Apify)", async () => {
    connectionA = track(
      await credentials.create(
        {
          workspaceId,
          name: "SocialChamps Apify",
          type: "apify",
          secret: { apiToken: "apify_m1037_token_a" },
        },
        authUser
      )
    );
    assert.equal(connectionA.name, "SocialChamps Apify");
    assert.equal(connectionA.type, "apify");
  });

  await check("M1037-3 Disconnect keeps vault credential listable", async () => {
    // Disconnect is FE-only (clear node ref). Vault row must remain.
    const list = await credentials.listByWorkspace(workspaceId, authUser);
    const found = list.find((c) => c.id === connectionA.id);
    assert.ok(found, "disconnected credential must remain in picker list");
    assert.equal(found.name, "SocialChamps Apify");
  });

  await check("M1037-4 Genuine duplicate name → actionable 409", async () => {
    await assert.rejects(
      () =>
        credentials.create(
          {
            workspaceId,
            name: "SocialChamps Apify",
            type: "apify",
            secret: { apiToken: "apify_m1037_dup" },
          },
          authUser
        ),
      (err) =>
        err.code === "CREDENTIAL_NAME_EXISTS" &&
        /already exists/i.test(err.message) &&
        /SocialChamps Apify/i.test(err.message) &&
        err.statusCode === 409
    );
    // Case-insensitive collision (MySQL utf8mb4_0900_ai_ci)
    await assert.rejects(
      () =>
        credentials.create(
          {
            workspaceId,
            name: "socialchamps apify",
            type: "apify",
            secret: { apiToken: "apify_m1037_case" },
          },
          authUser
        ),
      (err) => err.code === "CREDENTIAL_NAME_EXISTS"
    );
  });

  await check("M1037-5 Same-type duplicate still rejected; listable", async () => {
    // Cross-type same names are allowed after M10.3.8; same-type remains blocked.
    await assert.rejects(
      () =>
        credentials.create(
          {
            workspaceId,
            name: "SocialChamps Apify",
            type: "apify",
            secret: { apiToken: "apify_same_type_dup" },
          },
          authUser
        ),
      (err) =>
        err.code === "CREDENTIAL_NAME_EXISTS" &&
        /already exists/i.test(err.message)
    );
    const list = await credentials.listByWorkspace(workspaceId, authUser);
    assert.ok(list.some((c) => c.id === connectionA.id));
  });

  await check("M1037-6 Delete A → disappears from list", async () => {
    await credentials.remove(connectionA.id, authUser, { force: true });
    const idx = createdIds.indexOf(connectionA.id);
    if (idx >= 0) createdIds.splice(idx, 1);
    const list = await credentials.listByWorkspace(workspaceId, authUser);
    assert.equal(
      list.find((c) => c.id === connectionA.id),
      undefined
    );
    const gone = await credentials.getForWorkspace(
      connectionA.id,
      workspaceId
    );
    assert.equal(gone, null);
  });

  await check("M1037-7 Recreate A with same name succeeds", async () => {
    connectionA = track(
      await credentials.create(
        {
          workspaceId,
          name: "SocialChamps Apify",
          type: "apify",
          secret: { apiToken: "apify_m1037_token_recreate" },
        },
        authUser
      )
    );
    assert.equal(connectionA.name, "SocialChamps Apify");
    assert.equal(
      normalizeCredentialNameKey(connectionA.name),
      "socialchamps apify"
    );
  });

  await check("M1037-8 Parallel create race → friendly conflict, one wins", async () => {
    const name = `m1037-race-${Date.now()}`;
    const results = await Promise.allSettled([
      credentials.create(
        {
          workspaceId,
          name,
          type: "apify",
          secret: { apiToken: "race_a" },
        },
        authUser
      ),
      credentials.create(
        {
          workspaceId,
          name,
          type: "apify",
          secret: { apiToken: "race_b" },
        },
        authUser
      ),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1, "exactly one create should win");
    assert.equal(fail.length, 1);
    track(ok[0].value);
    assert.equal(fail[0].reason.code, "CREDENTIAL_NAME_EXISTS");
    assert.match(fail[0].reason.message, /already exists/i);
    assert.notEqual(fail[0].reason.code, "ER_DUP_ENTRY");
  });

  await check("M1037-9 In-use protection + force delete", async () => {
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
      id: `m1037-probe-${Date.now()}`,
      type: "linkedinLeadDiscovery",
      data: {
        dataProvider: "apify",
        apifyCredentialId: connectionA.id,
      },
    };
    await pool.execute(`UPDATE workflows SET definition_json = ? WHERE id = ?`, [
      JSON.stringify({ ...definition, nodes: [...nodes, probe] }),
      wf.id,
    ]);
    try {
      await assert.rejects(
        () => credentials.remove(connectionA.id, authUser, { force: false }),
        (err) => err.code === "CREDENTIAL_IN_USE" && err.statusCode === 409
      );
      await credentials.remove(connectionA.id, authUser, { force: true });
      const idx = createdIds.indexOf(connectionA.id);
      if (idx >= 0) createdIds.splice(idx, 1);
      connectionA = null;
    } finally {
      await pool.execute(
        `UPDATE workflows SET definition_json = ? WHERE id = ?`,
        [original, wf.id]
      );
    }
  });

  await check("M1037-10 Workspace isolation", async () => {
    if (!otherWorkspaceId) {
      console.log("       skip — only one workspace");
      return;
    }
    const a = track(
      await credentials.create(
        {
          workspaceId,
          name: "m1037-iso-shared-name",
          type: "apify",
          secret: { apiToken: "iso_a" },
        },
        authUser
      )
    );
    // Same name in another workspace must succeed (unique is per workspace).
    const b = track(
      await credentials.create(
        {
          workspaceId: otherWorkspaceId,
          name: "m1037-iso-shared-name",
          type: "apify",
          secret: { apiToken: "iso_b" },
        },
        authUser
      )
    );
    assert.equal(a.name, b.name);
    assert.notEqual(a.id, b.id);
    const listA = await credentials.listByWorkspace(workspaceId, authUser);
    assert.ok(listA.some((c) => c.id === a.id));
    assert.ok(!listA.some((c) => c.id === b.id));
  });

  await check("M1037-11 Perigon + Bearer same lifecycle", async () => {
    const perigonName = `m1037-perigon-${Date.now()}`;
    const bearerName = `m1037-bearer-${Date.now()}`;
    const p = track(
      await credentials.create(
        {
          workspaceId,
          name: perigonName,
          type: "perigon",
          secret: { apiKey: "perigon_m1037" },
        },
        authUser
      )
    );
    await assert.rejects(
      () =>
        credentials.create(
          {
            workspaceId,
            name: perigonName,
            type: "perigon",
            secret: { apiKey: "perigon_dup" },
          },
          authUser
        ),
      (err) => err.code === "CREDENTIAL_NAME_EXISTS"
    );
    await credentials.remove(p.id, authUser, { force: true });
    createdIds.splice(createdIds.indexOf(p.id), 1);
    const p2 = track(
      await credentials.create(
        {
          workspaceId,
          name: perigonName,
          type: "perigon",
          secret: { apiKey: "perigon_recreate" },
        },
        authUser
      )
    );
    assert.equal(p2.name, perigonName);

    const b = track(
      await credentials.create(
        {
          workspaceId,
          name: bearerName,
          type: "bearer",
          secret: { token: "bearer_m1037" },
        },
        authUser
      )
    );
    await credentials.remove(b.id, authUser, { force: true });
    createdIds.splice(createdIds.indexOf(b.id), 1);
    const b2 = track(
      await credentials.create(
        {
          workspaceId,
          name: bearerName,
          type: "bearer",
          secret: { token: "bearer_recreate" },
        },
        authUser
      )
    );
    assert.equal(b2.name, bearerName);
  });

  await check("M1037-12 HTTP create/delete/recreate + duplicate message", async () => {
    const api = await startEphemeralApi();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
    const name = `m1037-http-${Date.now()}`;
    try {
      const createRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            name,
            type: "apify",
            secret: { apiToken: "http_token_1" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const created = await createRes.json();
      assert.ok([200, 201].includes(createRes.status), `create status ${createRes.status}`);
      assert.equal(created.name, name);
      track(created);

      const dupRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            name,
            type: "apify",
            secret: { apiToken: "http_token_dup" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const dupBody = await dupRes.json();
      assert.equal(dupRes.status, 409);
      assert.equal(dupBody.code, "CREDENTIAL_NAME_EXISTS");
      assert.match(dupBody.error, /already exists/i);
      assert.match(dupBody.error, new RegExp(name, "i"));
      // Must not be the generic ER_DUP handler copy.
      assert.notEqual(dupBody.error, "Resource already exists");

      const listRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      const listBody = await listRes.json();
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listBody));
      assert.ok(listBody.some((c) => c.id === created.id));

      const delRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials/${created.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      assert.equal(delRes.status, 200);
      const idx = createdIds.indexOf(created.id);
      if (idx >= 0) createdIds.splice(idx, 1);

      const recreateRes = await fetch(
        `http://127.0.0.1:${api.port}/api/workflows/credentials`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            name,
            type: "apify",
            secret: { apiToken: "http_token_2" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const recreated = await recreateRes.json();
      assert.ok(
        [200, 201].includes(recreateRes.status),
        `recreate status ${recreateRes.status}`
      );
      assert.equal(recreated.name, name);
      track(recreated);
    } finally {
      await api.close();
    }
  });

  await check("M1037-13 FE disconnect/delete/save-lock + session isolation", () => {
    const picker = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/CredentialPicker.tsx"
      ),
      "utf8"
    );
    assert.match(picker, /disconnectSelected/);
    assert.match(picker, /removeSelected/);
    assert.match(picker, /savingLockRef/);
    assert.match(picker, /Prefer Disconnect/);
    assert.match(picker, /reload\(\)/);
    assert.match(picker, /CREDENTIAL_NAME_EXISTS|already exists/);
    assert.match(picker, /listLoaded/);

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

  await check("M1037-14 No soft-delete column reserving names", async () => {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'workflow_credentials'
         AND COLUMN_NAME IN ('deleted_at','is_deleted','active')`
    );
    assert.equal(cols.length, 0, "hard delete only — no soft-delete column");
    const [idx] = await pool.query(
      `SHOW INDEX FROM workflow_credentials
       WHERE Key_name IN (
         'uq_workflow_credentials_name',
         'uq_workflow_credentials_workspace_type_name'
       )`
    );
    assert.ok(idx.length >= 2, "unique name index must exist");
  });

  // Cleanup probe credentials
  for (const id of [...createdIds]) {
    try {
      await credentials.remove(id, authUser, { force: true });
    } catch {
      await pool.execute(`DELETE FROM workflow_credentials WHERE id = ?`, [id]);
    }
  }

  console.log(`\nM10.3.7 checks passed: ${passed}`);
  if (process.exitCode) {
    console.error("M10.3.7 FAIL");
  } else {
    console.log("M10.3.7 PASS");
  }
  await pool.end();
  process.exit(process.exitCode || 0);
})().catch(async (err) => {
  console.error(err);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch {}
  process.exit(1);
});
