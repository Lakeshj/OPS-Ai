/**
 * Seed UI Test 7 — Tidy (execution path vs resource cluster).
 * Starts with a deliberately wrong horizontal layout so Tidy is meaningful.
 *
 * Usage: node scripts/seed-ui-test-7-tidy.js
 */
require("dotenv").config();
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

const WORKSPACE_ID =
  process.env.SEED_WORKSPACE_ID || "1a470f32-6f02-40a4-ac83-0b5cdafc50d0";
const USER_EMAIL =
  process.env.SEED_USER_EMAIL || "lakesh.jat@socialchamps.com";

const QUESTION = "What is 12 + 30? Use the calculator tool.";

/**
 * Intentionally bad starting positions (looks like Model → Tool → Agent → Result).
 * After Tidy, execution should read Manual → Edit → Agent → Result left-to-right,
 * with Chat Model / Calculator clustered near Agent (not in the execution rank).
 */
const definition = {
  version: 1,
  nodes: [
    {
      id: "manual",
      type: "trigger",
      position: { x: 700, y: 400 },
      data: { label: "Manual Trigger", nodeType: "trigger" },
    },
    {
      id: "set",
      type: "set",
      position: { x: 520, y: 280 },
      data: {
        label: "Edit Fields",
        nodeType: "set",
        mappings: [{ key: "question", value: QUESTION }],
      },
    },
    {
      id: "model",
      type: "aiChatModel",
      position: { x: 40, y: 220 },
      data: {
        label: "Chat Model",
        nodeType: "aiChatModel",
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 400,
      },
    },
    {
      id: "tool",
      type: "aiCalculatorTool",
      position: { x: 260, y: 220 },
      data: {
        label: "Calculator Tool",
        nodeType: "aiCalculatorTool",
        toolName: "calculator",
        description: "Add, subtract, multiply, or divide two numbers.",
      },
    },
    {
      id: "agent",
      type: "aiAgent",
      position: { x: 480, y: 220 },
      data: {
        label: "Basic AI Agent",
        nodeType: "aiAgent",
        prompt: "{{item.question}}",
        systemInstruction:
          "Use the calculator tool for arithmetic. Keep the final answer short.",
        needsNaming: false,
      },
    },
    {
      id: "result",
      type: "result",
      position: { x: 760, y: 220 },
      data: {
        label: "Result",
        nodeType: "result",
        mapFrom: "{{steps.agent.text}}",
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
  const name = "UI Test 7 — Tidy";
  const description =
    "Starts with a messy layout (looks like Model → Calculator → Agent). Click Tidy: execution must stay Manual → Edit → Agent → Result; resources cluster near Agent, not in the execution chain.";

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

  console.log("\nCreated UI Test 7:");
  console.log(`  name:       ${name}`);
  console.log(`  workspace:  ${ws[0].name}`);
  console.log(`  workflowId: ${id}`);
  console.log(`  open:       ${fe}/workflows/${id}`);
  console.log("\nTidy checklist:");
  console.log("  ✓ Manual → Edit Fields → Basic AI Agent → Result (L→R)");
  console.log("  ✓ Chat Model + Calculator near Agent (above/beside)");
  console.log("  ✗ Not Chat Model → Calculator → Agent → Result\n");

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
