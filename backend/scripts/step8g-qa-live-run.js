/**
 * STEP 8G — temporary landing-only QA filter live run.
 * Restores workflow definition afterward. Does not change production code files.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = '71eb8707-b787-4481-8fa7-d16a417ed331';
const MCP_NODE = 'ga4McpTool-1790083223630';
const OUT_DIR = path.join(__dirname, '..', '..', '.tmp');

const USER_PROMPT = `Analyze the structured GA4 MCP landing underperformance opportunities.

Report every qualifying landing-page opportunity provided by the MCP.

For each result show:
- Landing page
- Sessions
- Engagement rate, if provided
- Bounce rate, if provided
- MCP score
- Reason
- Recommendation

Use the MCP score exactly as provided.
Do not recalculate the score.
Do not invent metrics.
Do not create additional opportunities.
Do not confuse landing pages with acquisition channels.

If there are no qualifying landing underperformance opportunities, state that clearly.`;

const QA_LANDING_FILTERS = {
  minSessions: 0,
  maxEngagementRate: 1,
  minBounceRate: 0,
  minScore: 0,
  limit: 50,
};

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  return JSON.parse(v);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [wfRows] = await pool.query(
    `SELECT id, workspace_id, created_by, definition_json FROM workflows WHERE id = ? LIMIT 1`,
    [WORKFLOW_ID]
  );
  if (!wfRows.length) throw new Error('workflow not found');
  const originalDef = parseJson(wfRows[0].definition_json);
  const backupPath = path.join(OUT_DIR, 'step8g-workflow-def-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(originalDef, null, 2));
  console.log('BACKUP', backupPath);

  const patched = JSON.parse(JSON.stringify(originalDef));
  const mcp = (patched.nodes || []).find((n) => n.id === MCP_NODE);
  if (!mcp) throw new Error('MCP node not found');
  mcp.data = mcp.data || {};
  mcp.data.capabilities = ['landing_underperformance'];
  mcp.data.capability = 'landing_underperformance';
  mcp.data.capabilitySettings = {
    ...(mcp.data.capabilitySettings || {}),
    landing_underperformance: {
      ...(mcp.data.capabilitySettings?.landing_underperformance || {}),
      ...QA_LANDING_FILTERS,
    },
  };
  // clear flat filter bleed fields during QA
  mcp.data.minSessions = QA_LANDING_FILTERS.minSessions;
  mcp.data.maxEngagementRate = QA_LANDING_FILTERS.maxEngagementRate;
  mcp.data.minBounceRate = QA_LANDING_FILTERS.minBounceRate;

  const ai = (patched.nodes || []).find((n) => n.type === 'ai' || n.data?.nodeType === 'ai');
  if (ai?.data) {
    ai.data.systemPrompt = USER_PROMPT;
  }

  let restored = false;
  const restore = async () => {
    if (restored) return;
    await pool.query(`UPDATE workflows SET definition_json = ? WHERE id = ?`, [
      JSON.stringify(originalDef),
      WORKFLOW_ID,
    ]);
    restored = true;
    console.log('RESTORED original workflow definition');
  };

  try {
    await pool.query(`UPDATE workflows SET definition_json = ? WHERE id = ?`, [
      JSON.stringify(patched),
      WORKFLOW_ID,
    ]);
    console.log('PATCHED workflow for landing-only QA filters');

    const authUser = {
      userId: wfRows[0].created_by,
      role: 'Admin',
    };

    // Prefer service startRun so queue + snapshot behave normally
    const workflowsService = require('../modules/workflows/workflows.service');
    const run = await workflowsService.startRun(WORKFLOW_ID, {}, authUser);
    console.log('STARTED_RUN', run.id, run.status);

    // Poll
    let final = run;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const [rows] = await pool.query(
        `SELECT id, status, error_message FROM workflow_runs WHERE id = ? LIMIT 1`,
        [run.id]
      );
      final = rows[0];
      console.log('POLL', i, final.status);
      if (['succeeded', 'failed', 'cancelled', 'error'].includes(final.status)) break;
    }

    // Export steps
    const [steps] = await pool.query(
      `SELECT id, node_id, node_type, status FROM workflow_run_steps WHERE run_id = ?`,
      [run.id]
    );
    console.log('STEPS', JSON.stringify(steps, null, 2));

    const exportMeta = { runId: run.id, status: final.status, error: final.error_message, steps: [] };

    for (const step of steps) {
      const interesting = /ga4|mcp|ai|googleAnalytics|analytics/i.test(
        `${step.node_id} ${step.node_type}`
      );
      if (!interesting) continue;
      const [full] = await pool.query(
        `SELECT output_json, input_json FROM workflow_run_steps WHERE id = ? LIMIT 1`,
        [step.id]
      );
      const payload = {
        run_id: run.id,
        node_id: step.node_id,
        node_type: step.node_type,
        status: step.status,
        output: parseJson(full[0]?.output_json),
        input: parseJson(full[0]?.input_json),
      };
      const file = path.join(
        OUT_DIR,
        `step8g-qa-${run.id.slice(0, 8)}-${String(step.node_id).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
      );
      fs.writeFileSync(file, JSON.stringify(payload, null, 2));
      const items = Array.isArray(payload.output)
        ? payload.output
        : Array.isArray(payload.output?.items)
          ? payload.output.items
          : [];
      exportMeta.steps.push({
        node_id: step.node_id,
        node_type: step.node_type,
        status: step.status,
        itemCount: items.length,
        file,
      });
      console.log('WROTE', file, 'items', items.length);
    }

    fs.writeFileSync(
      path.join(OUT_DIR, 'step8g-qa-live-run-meta.json'),
      JSON.stringify(exportMeta, null, 2)
    );
  } finally {
    await restore();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
