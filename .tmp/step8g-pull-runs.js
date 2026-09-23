require('dotenv').config();
const mysql = require('mysql2/promise');

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
  for (const run of runs.slice(0, 4)) {
    const [steps] = await pool.query(
      `
      SELECT node_id, node_type, status,
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
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
