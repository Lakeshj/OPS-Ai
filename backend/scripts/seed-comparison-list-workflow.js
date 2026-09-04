/**
 * Seed a demo workflow: "comparison list"
 *
 * Flow:
 *   Manual Trigger → Seed input → Normalize list → Split Out
 *   → Compare (score ≥ threshold) → Sort desc → Label matches → Result
 *
 * Usage:
 *   node scripts/seed-comparison-list-workflow.js
 *   node scripts/seed-comparison-list-workflow.js --workspace <uuid>
 *   node scripts/seed-comparison-list-workflow.js --force
 */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

const WORKFLOW_NAME = "comparison list";

const definition = {
  version: 1,
  nodes: [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 60, y: 240 },
      data: {
        label: "Manual Trigger",
        note: "Execute empty for demo data, or pass { threshold, items }",
      },
    },
    {
      id: "seed",
      type: "set",
      position: { x: 300, y: 240 },
      data: {
        label: "Capture run input",
        keepOnlySet: false,
        mappings: [
          { key: "threshold", value: "{{input.threshold}}" },
          { key: "items", value: "{{input.items}}" },
          { key: "regionFilter", value: "{{input.region}}" },
        ],
      },
    },
    {
      id: "normalize",
      type: "code",
      position: { x: 560, y: 240 },
      data: {
        label: "Build comparison list",
        mode: "all",
        code: `const unwrap = (it) => {
  if (!it || typeof it !== "object") return {};
  if (it.json && typeof it.json === "object" && !Array.isArray(it.json)) return it.json;
  const { pairedItem, binary, json, ...rest } = it;
  return Object.keys(rest).length ? rest : {};
};

const incoming = unwrap(items[0]);
const demoList = [
  { id: "A1", name: "Alpha Store", score: 92, status: "active", region: "west" },
  { id: "B2", name: "Beta Market", score: 74, status: "active", region: "east" },
  { id: "C3", name: "Gamma Hub", score: 88, status: "paused", region: "west" },
  { id: "D4", name: "Delta Shop", score: 61, status: "active", region: "north" },
  { id: "E5", name: "Epsilon Co", score: 95, status: "active", region: "south" },
  { id: "F6", name: "Zeta Retail", score: 80, status: "active", region: "east" },
];

let list = Array.isArray(incoming.items) ? incoming.items : null;
if (!list || list.length === 0) list = demoList;

let threshold = 80;
const rawThreshold = incoming.threshold;
if (rawThreshold !== undefined && rawThreshold !== null && rawThreshold !== "") {
  const n = Number(rawThreshold);
  if (Number.isFinite(n)) threshold = n;
}

const regionFilter =
  incoming.regionFilter === undefined ||
  incoming.regionFilter === null ||
  incoming.regionFilter === ""
    ? null
    : String(incoming.regionFilter);

const prepared = list.map((row, index) => {
  const base =
    row && typeof row === "object" && !Array.isArray(row) ? { ...row } : { value: row };
  return {
    ...base,
    threshold,
    regionFilter,
    listIndex: index,
  };
});

return [
  {
    json: {
      threshold,
      regionFilter,
      totalCandidates: prepared.length,
      list: prepared,
      source: "comparison-list-demo",
    },
  },
];`,
      },
    },
    {
      id: "split",
      type: "splitOut",
      position: { x: 820, y: 240 },
      data: {
        label: "Split candidates",
        fieldName: "list",
        includeOtherFields: true,
      },
    },
    {
      id: "compare",
      type: "code",
      position: { x: 1080, y: 240 },
      data: {
        label: "Compare score ≥ threshold",
        mode: "all",
        code: `const unwrap = (it) => {
  if (!it || typeof it !== "object") return {};
  if (it.json && typeof it.json === "object" && !Array.isArray(it.json)) return it.json;
  const { pairedItem, binary, json, ...rest } = it;
  return Object.keys(rest).length ? rest : {};
};

const matches = [];
for (const raw of items) {
  const item = unwrap(raw);
  const score = Number(item.score);
  const threshold = Number(item.threshold);
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) continue;
  if (score < threshold) continue;
  if (item.regionFilter && String(item.region) !== String(item.regionFilter)) {
    continue;
  }
  matches.push({
    json: {
      ...item,
      passed: true,
      margin: score - threshold,
    },
  });
}
return matches;`,
      },
    },
    {
      id: "sort",
      type: "sort",
      position: { x: 1340, y: 240 },
      data: {
        label: "Sort by score (desc)",
        fieldName: "score",
        direction: "desc",
      },
    },
    {
      id: "label",
      type: "set",
      position: { x: 1600, y: 240 },
      data: {
        label: "Label match rows",
        keepOnlySet: false,
        mappings: [
          { key: "verdict", value: "above_threshold" },
          { key: "listName", value: "comparison list" },
        ],
      },
    },
    {
      id: "result",
      type: "result",
      position: { x: 1860, y: 240 },
      data: {
        label: "Result — match list",
        mapFrom: "{{steps.compare.count}} matches above threshold",
      },
    },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "seed" },
    { id: "e2", source: "seed", target: "normalize" },
    { id: "e3", source: "normalize", target: "split" },
    { id: "e4", source: "split", target: "compare" },
    { id: "e5", source: "compare", target: "sort" },
    { id: "e6", source: "sort", target: "label" },
    { id: "e7", source: "label", target: "result" },
  ],
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { workspaceId: null, force: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--workspace" && args[i + 1]) {
      out.workspaceId = args[i + 1];
      i += 1;
    } else if (args[i] === "--force") {
      out.force = true;
    }
  }
  return out;
};

const main = async () => {
  const { workspaceId: argWs, force } = parseArgs();

  const [users] = await pool.execute(
    `SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1`
  );
  if (!users.length) {
    throw new Error("No users found — cannot seed workflow");
  }
  const userId = users[0].id;

  let workspaceId = argWs;
  let workspaceName = null;
  if (!workspaceId) {
    const [ws] = await pool.execute(
      `SELECT w.id, w.name
       FROM workspaces w
       INNER JOIN workspace_users wu ON wu.workspace_id = w.id AND wu.user_id = ?
       ORDER BY w.updated_at DESC
       LIMIT 1`,
      [userId]
    );
    if (ws.length) {
      workspaceId = ws[0].id;
      workspaceName = ws[0].name;
    } else {
      const [any] = await pool.execute(
        `SELECT id, name FROM workspaces ORDER BY updated_at DESC LIMIT 1`
      );
      if (!any.length) throw new Error("No workspaces found");
      workspaceId = any[0].id;
      workspaceName = any[0].name;
    }
  }

  console.log(
    `Workspace: ${workspaceName || workspaceId} (${workspaceId}) as user ${users[0].email}`
  );

  const [existing] = await pool.execute(
    `SELECT id FROM workflows
     WHERE workspace_id = ? AND name = ? AND deleted_at IS NULL
     LIMIT 1`,
    [workspaceId, WORKFLOW_NAME]
  );

  const description =
    "Demo comparison list: split candidates, keep score ≥ threshold (optional region), sort, return matches.";

  if (existing.length && !force) {
    console.log(`Already exists: ${existing[0].id}`);
    console.log(`Open: /workflows/${existing[0].id}`);
    console.log(`Re-run with --force to refresh the definition.`);
    process.exit(0);
  }

  if (existing.length && force) {
    await pool.execute(
      `UPDATE workflows
       SET definition_json = ?, description = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(definition), description, existing[0].id]
    );
    console.log(`Updated: ${WORKFLOW_NAME}`);
    console.log(`id: ${existing[0].id}`);
    console.log(`Open: /workflows/${existing[0].id}`);
    process.exit(0);
  }

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO workflows
      (id, workspace_id, name, description, definition_json, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [id, workspaceId, WORKFLOW_NAME, description, JSON.stringify(definition), userId]
  );

  console.log(`Created: ${WORKFLOW_NAME}`);
  console.log(`id: ${id}`);
  console.log(`Open: /workflows/${id}`);
  console.log("");
  console.log("Try Execute with empty input → demo list, threshold 80.");
  console.log(
    'Custom: { "threshold": 90, "region": "west", "items": [{ "id": "X", "name": "Custom", "score": 91, "status": "active", "region": "west" }] }'
  );
  process.exit(0);
};

module.exports = { WORKFLOW_NAME, definition };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
