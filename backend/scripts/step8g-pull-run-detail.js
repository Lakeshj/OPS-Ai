require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const runId = process.argv[2] || 'a9881bbe-ec47-465e-aa33-707c8b3d6ae8';
  console.log('RUN_ID', runId);

  const [steps] = await pool.query(
    `SELECT id, node_id, node_type, status FROM workflow_run_steps WHERE run_id = ?`,
    [runId]
  );
  console.log('STEPS', JSON.stringify(steps, null, 2));

  const outDir = path.join(__dirname, '..', '..', '.tmp');
  fs.mkdirSync(outDir, { recursive: true });

  for (const step of steps) {
    const nid = String(step.node_id || '');
    const ntype = String(step.node_type || '');
    const interesting =
      /ga4|mcp|ai|googleAnalytics|analytics/i.test(nid) ||
      /ga4|mcp|ai|googleAnalytics|analytics/i.test(ntype);
    if (!interesting) continue;

    const [rows] = await pool.query(
      `SELECT output_json, input_json FROM workflow_run_steps WHERE id = ? LIMIT 1`,
      [step.id]
    );
    const row = rows[0] || {};
    const payload = {
      run_id: runId,
      step_id: step.id,
      node_id: step.node_id,
      node_type: step.node_type,
      status: step.status,
      output: safeParse(row.output_json),
      input: safeParse(row.input_json),
    };
    const file = path.join(
      outDir,
      `step8g-${runId.slice(0, 8)}-${sanitize(nid)}.json`
    );
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    console.log('WROTE', file, {
      outItems: countItems(payload.output),
      inItems: countItems(payload.input),
    });
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return { _rawLength: String(v).length };
  }
}

function countItems(obj) {
  if (!obj) return 0;
  if (Array.isArray(obj)) return obj.length;
  if (Array.isArray(obj.items)) return obj.items.length;
  if (obj.json && Array.isArray(obj.json.items)) return obj.json.items.length;
  return null;
}

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
}
