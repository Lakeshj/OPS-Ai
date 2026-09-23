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
  const [runs] = await pool.query(`
    SELECT id, workflow_id, status, created_at
    FROM workflow_runs
    ORDER BY created_at DESC
    LIMIT 8
  `);
  console.log('RECENT_RUNS', JSON.stringify(runs, null, 2));
  if (!runs.length) {
    await pool.end();
    return;
  }

  const outDir = path.join(__dirname, '..', '..', '.tmp');
  fs.mkdirSync(outDir, { recursive: true });

  for (const run of runs.slice(0, 4)) {
    const [steps] = await pool.query(
      `
      SELECT id, node_id, node_type, status,
        CHAR_LENGTH(COALESCE(output_json,'')) as out_len,
        CHAR_LENGTH(COALESCE(input_json,'')) as in_len
      FROM workflow_run_steps
      WHERE run_id = ?
      ORDER BY id
    `,
      [run.id]
    );
    console.log('RUN', run.id, 'STEPS', JSON.stringify(steps, null, 2));
  }

  // Pull most recent run that has a ga4 mcp step with output
  const [mcpSteps] = await pool.query(`
    SELECT s.run_id, s.node_id, s.node_type, s.status, s.output_json, s.input_json, r.created_at
    FROM workflow_run_steps s
    JOIN workflow_runs r ON r.id = s.run_id
    WHERE s.node_id LIKE 'ga4Mcp%' OR s.node_type LIKE '%ga4%mcp%' OR s.node_type LIKE '%Ga4Mcp%'
    ORDER BY r.created_at DESC
    LIMIT 5
  `);
  console.log(
    'MCP_STEPS_META',
    JSON.stringify(
      mcpSteps.map((s) => ({
        run_id: s.run_id,
        node_id: s.node_id,
        node_type: s.node_type,
        status: s.status,
        out_len: s.output_json ? String(s.output_json).length : 0,
        created_at: s.created_at,
      })),
      null,
      2
    )
  );

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
