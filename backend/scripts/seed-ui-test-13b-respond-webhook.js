/**
 * Seed UI Test 13B — Respond to Webhook (sync response mode).
 *
 * Graph:
 *   Webhook (responseMode=respondNode)
 *     → Set Fields (pass through customerId)
 *     → Respond to Webhook (201 JSON + expression body)
 *
 * Manual QA:
 *   1. Open workflow, activate if needed
 *   2. POST webhook URL with JSON: { "customerId": "cust_42" }
 *   3. Expect HTTP 201 body:
 *        { "success": true, "customerId": "cust_42" }
 *      not the immediate 201 run-ack shape
 *
 * Usage: node scripts/seed-ui-test-13b-respond-webhook.js
 */
require("dotenv").config();
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

const WORKSPACE_ID =
  process.env.SEED_WORKSPACE_ID || "1a470f32-6f02-40a4-ac83-0b5cdafc50d0";
const USER_EMAIL =
  process.env.SEED_USER_EMAIL || "lakesh.jat@socialchamps.com";

const definition = {
  version: 1,
  nodes: [
    {
      id: "webhook",
      type: "webhook",
      position: { x: 40, y: 180 },
      data: {
        label: "Webhook",
        nodeType: "webhook",
        method: "POST",
        responseMode: "respondNode",
        available: true,
        libraryId: "webhook",
        libraryCategory: "Triggers",
      },
    },
    {
      id: "set",
      type: "set",
      position: { x: 320, y: 180 },
      data: {
        label: "Echo fields",
        nodeType: "set",
        mappings: [
          { key: "customerId", value: "{{input.customerId}}" },
          { key: "received", value: "true" },
        ],
      },
    },
    {
      id: "respond",
      type: "respondToWebhook",
      position: { x: 600, y: 180 },
      data: {
        label: "Respond to Webhook",
        nodeType: "respondToWebhook",
        statusCode: 201,
        responseType: "json",
        body: '{\n  "success": true,\n  "customerId": "{{item.customerId}}"\n}',
        responseHeaders: [
          { key: "X-OpsAi-Respond", value: "13b" },
        ],
        available: true,
        libraryId: "respond-to-webhook",
        libraryCategory: "Core",
        libraryProvider: "OpsAi",
      },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "webhook",
      target: "set",
      sourceHandle: "main",
      type: "workflow",
    },
    {
      id: "e2",
      source: "set",
      target: "respond",
      sourceHandle: "main",
      type: "workflow",
    },
  ],
};

(async () => {
  const [users] = await pool.execute(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [USER_EMAIL]
  );
  let userId = users[0]?.id;
  if (!userId) {
    const [fallback] = await pool.execute(`SELECT id FROM users LIMIT 1`);
    userId = fallback[0]?.id;
  }
  if (!userId) throw new Error("No users found");

  const [ws] = await pool.execute(
    `SELECT id, name FROM workspaces WHERE id = ?`,
    [WORKSPACE_ID]
  );
  if (!ws.length) throw new Error(`Workspace not found: ${WORKSPACE_ID}`);

  const id = uuidv4();
  const name = "UI Test 13B — Respond to Webhook";
  const description =
    "Webhook Response mode = Using Respond to Webhook. POST { customerId } → expect HTTP 201 custom JSON (not run-ack).";

  await pool.execute(
    `INSERT INTO workflows
      (id, workspace_id, name, description, definition_json, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [id, WORKSPACE_ID, name, description, JSON.stringify(definition), userId]
  );

  // Also fix the user's open "Webhook Trigger" draft/active if present:
  // it had Respond node but responseMode was still default immediate.
  const existingId = "ffbdd5d3-e264-45b3-b65e-cd36807053af";
  const [existing] = await pool.execute(
    `SELECT id, definition_json FROM workflows WHERE id = ? AND deleted_at IS NULL`,
    [existingId]
  );
  if (existing.length) {
    const prev =
      typeof existing[0].definition_json === "string"
        ? JSON.parse(existing[0].definition_json)
        : existing[0].definition_json;
    const nodes = (prev.nodes || []).map((n) => {
      const t = n.type || n.data?.nodeType;
      if (t === "webhook") {
        return {
          ...n,
          data: {
            ...(n.data || {}),
            method: n.data?.method || "POST",
            responseMode: "respondNode",
          },
        };
      }
      if (t === "respondToWebhook") {
        return {
          ...n,
          data: {
            ...(n.data || {}),
            statusCode: n.data?.statusCode ?? 200,
            responseType: n.data?.responseType || "json",
            body:
              n.data?.body ||
              '{\n  "success": true,\n  "echo": "{{input}}"\n}',
            responseHeaders: Array.isArray(n.data?.responseHeaders)
              ? n.data.responseHeaders
              : [],
          },
        };
      }
      return n;
    });
    await pool.execute(
      `UPDATE workflows
       SET name = ?, description = ?, definition_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        "UI Test 13B — Webhook Respond (open)",
        "Response mode set to Using Respond to Webhook. Hit production webhook URL with JSON body.",
        JSON.stringify({ ...prev, nodes }),
        existingId,
      ]
    );
  }

  const fe =
    process.env.FRONTEND_ORIGIN ||
    process.env.APP_ORIGIN ||
    "http://localhost:3001";

  console.log("\nCreated UI Test 13B:");
  console.log(`  name:       ${name}`);
  console.log(`  workspace:  ${ws[0].name}`);
  console.log(`  workflowId: ${id}`);
  console.log(`  open:       ${fe}/workflows/${id}`);
  if (existing.length) {
    console.log(`\nUpdated existing open workflow:`);
    console.log(`  workflowId: ${existingId}`);
    console.log(`  open:       ${fe}/workflows/${existingId}`);
    console.log(`  change:     webhook.responseMode → respondNode`);
  }
  console.log("\nExpected after Activate + POST webhook:");
  console.log('  body { "customerId": "cust_42" }');
  console.log('  → HTTP 201 { "success": true, "customerId": "cust_42" }');
  console.log("  header X-OpsAi-Respond: 13b\n");

  await pool.end();
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
