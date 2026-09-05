/**
 * Seed a real draft workflow for UI testing of Basic AI Agent.
 * Usage: node scripts/seed-basic-ai-agent-workflow.js
 */
require("dotenv").config();
const { v4: uuidv4 } = useUuid();
const { pool } = require("../config/database");

function useUuid() {
  try {
    return require("uuid");
  } catch {
    return { v4: () => require("crypto").randomUUID() };
  }
}

const WORKSPACE_ID = process.env.SEED_WORKSPACE_ID || "1a470f32-6f02-40a4-ac83-0b5cdafc50d0";
const USER_EMAIL = process.env.SEED_USER_EMAIL || "lakesh.jat@socialchamps.com";

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
      type: "set",
      position: { x: 300, y: 220 },
      data: {
        label: "Edit Fields",
        nodeType: "set",
        mappings: [
          {
            key: "question",
            value: "What is 12 + 30? Reply with only the number.",
          },
        ],
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
          "You are a careful assistant. Use the calculator tool for arithmetic. Prefer short answers.",
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
        temperature: 0.2,
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
    `SELECT id, email FROM users WHERE email = ? LIMIT 1`,
    [USER_EMAIL]
  );
  let userId = users[0]?.id;
  if (!userId) {
    const [fallback] = await pool.execute(`SELECT id FROM users LIMIT 1`);
    userId = fallback[0]?.id;
  }
  if (!userId) throw new Error("No users found");

  const [ws] = await pool.execute(`SELECT id, name FROM workspaces WHERE id = ?`, [
    WORKSPACE_ID,
  ]);
  if (!ws.length) throw new Error(`Workspace not found: ${WORKSPACE_ID}`);

  const id = uuidv4();
  const name = "UI Test — Basic AI Agent";
  const description =
    "Manual → Edit Fields → Basic AI Agent → Result, with Chat Model + Calculator. Open and click Execute to verify Part 12B/12C from the UI.";

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

  console.log("\nCreated workflow for UI testing:");
  console.log(`  name:       ${name}`);
  console.log(`  workspace:  ${ws[0].name} (${WORKSPACE_ID})`);
  console.log(`  workflowId: ${id}`);
  console.log(`  open:       ${fe}/workflows/${id}`);
  console.log("\nWhat to check:");
  console.log("  1. Agent card shows Model connected + Tools: 1");
  console.log("  2. Dashed Model / Tool resource edges");
  console.log("  3. Execute workflow → Agent output + tool-call trace");
  console.log("  4. Chat Model / Calculator have no Run Step as fake steps\n");

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
