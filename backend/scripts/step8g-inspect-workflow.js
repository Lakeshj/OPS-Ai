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

  const workflowId = '71eb8707-b787-4481-8fa7-d16a417ed331';
  const [rows] = await pool.query(
    `SELECT id, name, definition_json, updated_at FROM workflows WHERE id = ? LIMIT 1`,
    [workflowId]
  );
  if (!rows.length) throw new Error('workflow not found');
  const def =
    typeof rows[0].definition_json === 'string'
      ? JSON.parse(rows[0].definition_json)
      : rows[0].definition_json;

  const out = path.join(__dirname, '..', '..', '.tmp', 'step8g-workflow-def.json');
  fs.writeFileSync(out, JSON.stringify({ name: rows[0].name, definition: def }, null, 2));

  const nodes = def.nodes || def.graph?.nodes || [];
  const summary = nodes.map((n) => ({
    id: n.id,
    type: n.type || n.data?.type,
    label: n.data?.label || n.data?.name,
    dataKeys: Object.keys(n.data || {}),
    capabilities: n.data?.capabilities || n.data?.capability,
    capabilitySettings: n.data?.capabilitySettings,
    promptPreview: typeof n.data?.prompt === 'string' ? n.data.prompt.slice(0, 120) : n.data?.userPrompt?.slice?.(0, 120),
  }));
  console.log(JSON.stringify({ name: rows[0].name, nodeCount: nodes.length, summary }, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
