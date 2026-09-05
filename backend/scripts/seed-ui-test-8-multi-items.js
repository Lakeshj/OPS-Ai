/**
 * Seed UI Test 8 — Multiple Items (Agent per-item isolation).
 *
 * Input items:
 *   { question: "What is 10 + 5?" }
 *   { question: "What is 20 + 7?" }
 *   { question: "What is 100 + 25?" }
 *
 * Expected after Execute:
 *   - Agent OUTPUT has 3 items
 *   - Answers correspond 1:1 (≈15, ≈27, ≈125)
 *   - No cross-item conversation leakage
 *   - Occurrence / item selection works per row
 *
 * Usage: node scripts/seed-ui-test-8-multi-items.js
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
      id: "manual",
      type: "trigger",
      position: { x: 40, y: 220 },
      data: { label: "Manual Trigger", nodeType: "trigger" },
    },
    {
      id: "set",
      type: "code",
      position: { x: 300, y: 220 },
      data: {
        label: "Three questions",
        nodeType: "code",
        mode: "all",
        timeoutMs: 2000,
        code: `return [
  { question: "What is 10 + 5?" },
  { question: "What is 20 + 7?" },
  { question: "What is 100 + 25?" }
];`,
      },
    },
    {
      id: "agent",
      type: "aiAgent",
      position: { x: 580, y: 220 },
      data: {
        label: "Basic AI Agent",
        nodeType: "aiAgent",
        prompt: "{{item.question}}",
        systemInstruction:
          "Use the calculator tool for arithmetic. Reply with only the numeric answer when possible.",
        needsNaming: false,
      },
    },
    {
      id: "result",
      type: "result",
      position: { x: 860, y: 220 },
      data: {
        label: "Result",
        nodeType: "result",
        mapFrom: "{{steps.agent.text}}",
      },
    },
    {
      id: "model",
      type: "aiChatModel",
      position: { x: 500, y: 40 },
      data: {
        label: "Chat Model",
        nodeType: "aiChatModel",
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 400,
      },
    },
    {
      id: "tool",
      type: "aiCalculatorTool",
      position: { x: 680, y: 40 },
      data: {
        label: "Calculator Tool",
        nodeType: "aiCalculatorTool",
        toolName: "calculator",
        description: "Add, subtract, multiply, or divide two numbers.",
      },
    },
  ],
  edges: [
    { id: "e1", source: "manual", target: "set", type: "workflow" },
    { id: "e2", source: "set", target: "agent", type: "workflow" },
    { id: "e3", source: "agent", target: "result", type: "workflow" },
    {
      id: "em",
      source: "model",
      target: "agent",
      sourceHandle: "model",
      targetHandle: "model",
      type: "workflow",
    },
    {
      id: "et",
      source: "tool",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
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
  const name = "UI Test 8 — Multiple Items";
  const description =
    "Three WorkflowItems into Basic AI Agent. After Execute: 3 OUTPUT rows, ~15 / ~27 / ~125, 1:1 pairing, no cross-item leakage.";

  await pool.execute(
    `INSERT INTO workflows
      (id, workspace_id, name, description, definition_json, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [id, WORKSPACE_ID, name, description, JSON.stringify(definition), userId]
  );

  const fe =
    process.env.FRONTEND_ORIGIN ||
    process.env.APP_ORIGIN ||
    "http://localhost:3001";

  console.log("\nCreated UI Test 8:");
  console.log(`  name:       ${name}`);
  console.log(`  workspace:  ${ws[0].name}`);
  console.log(`  workflowId: ${id}`);
  console.log(`  open:       ${fe}/workflows/${id}`);
  console.log("\nExpected after Execute:");
  console.log("  INPUT  → 3 items (10+5, 20+7, 100+25)");
  console.log("  OUTPUT → 3 items, answers ≈ 15, 27, 125");
  console.log("  pairedItem 1:1 — no mixed answers across items\n");

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
