/**
 * Seed: "realtime SEO pulse" — richer than comparison list.
 * Mock live keyword metrics now; HTTP/API nodes can replace the feed later.
 *
 *   Trigger → Live feed → Split → Enrich → Filter traffic
 *   → Switch (hot/warm/watch) → Label → Merge → Sort → Top N
 *   → Board summary → Result
 *
 *   node scripts/seed-realtime-seo-pulse-workflow.js --workspace <uuid> [--force]
 */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

const WORKFLOW_NAME = "realtime SEO pulse";

const definition = {
  version: 1,
  nodes: [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 40, y: 280 },
      data: {
        label: "Manual Trigger",
        note: "Empty run = simulated live feed. Later: swap Live feed for HTTP/API.",
      },
    },
    {
      id: "liveFeed",
      type: "code",
      position: { x: 280, y: 280 },
      data: {
        label: "Live keyword feed (mock)",
        mode: "all",
        code: `const unwrap = (it) => {
  if (!it || typeof it !== "object") return {};
  if (it.json && typeof it.json === "object" && !Array.isArray(it.json)) return it.json;
  const { pairedItem, binary, json, ...rest } = it;
  return Object.keys(rest).length ? rest : {};
};

const incoming = unwrap(items[0] || {});
const now = new Date();
const capturedAt = now.toISOString();
const tick = now.getMinutes() + now.getSeconds();

// Simulated realtime SERP / GSC-style rows (moves slightly with wall-clock).
const demo = [
  { keyword: "opsai workflow builder", intent: "commercial", position: 3, prevPosition: 5, clicks: 420, impressions: 8900, ctr: 4.7, region: "us" },
  { keyword: "n8n alternative", intent: "commercial", position: 7, prevPosition: 6, clicks: 188, impressions: 12000, ctr: 1.6, region: "us" },
  { keyword: "automate seo reports", intent: "informational", position: 12, prevPosition: 18, clicks: 96, impressions: 5400, ctr: 1.8, region: "uk" },
  { keyword: "keyword ranking api", intent: "transactional", position: 4, prevPosition: 4, clicks: 310, impressions: 6100, ctr: 5.1, region: "us" },
  { keyword: "content brief generator", intent: "commercial", position: 21, prevPosition: 29, clicks: 54, impressions: 9800, ctr: 0.6, region: "eu" },
  { keyword: "serp feature tracking", intent: "informational", position: 9, prevPosition: 11, clicks: 140, impressions: 7200, ctr: 1.9, region: "us" },
  { keyword: "local pack optimizer", intent: "local", position: 2, prevPosition: 2, clicks: 265, impressions: 3300, ctr: 8.0, region: "us" },
  { keyword: "ai content quality score", intent: "commercial", position: 15, prevPosition: 14, clicks: 72, impressions: 11000, ctr: 0.7, region: "in" },
  { keyword: "workflow trigger webhook", intent: "technical", position: 6, prevPosition: 9, clicks: 205, impressions: 4500, ctr: 4.6, region: "us" },
  { keyword: "rank drop alert", intent: "commercial", position: 8, prevPosition: 3, clicks: 40, impressions: 8700, ctr: 0.5, region: "us" },
];

let rows = Array.isArray(incoming.keywords) ? incoming.keywords : null;
if (!rows || rows.length === 0) {
  rows = demo.map((row, i) => {
    const wobble = ((tick + i * 3) % 5) - 2; // -2..+2 faux live jitter
    const position = Math.max(1, Number(row.position) + (wobble === 0 ? 0 : wobble > 0 ? 0 : 0));
    // Keep positions stable for demos; vary clicks slightly so each run feels "live".
    const clickJitter = ((tick + i * 7) % 11) - 5;
    return {
      ...row,
      position: row.position,
      clicks: Math.max(0, Number(row.clicks) + clickJitter),
      capturedAt,
      feedSource: "mock-live",
    };
  });
}

const minClicks =
  incoming.minClicks !== undefined && incoming.minClicks !== null && incoming.minClicks !== ""
    ? Number(incoming.minClicks)
    : 50;

return [{
  json: {
    capturedAt,
    feedSource: rows[0]?.feedSource || "custom",
    minClicks: Number.isFinite(minClicks) ? minClicks : 50,
    totalInFeed: rows.length,
    keywords: rows,
    note: "Replace this Code node with HTTP/API later for real GSC/SERP data.",
  },
}];`,
      },
    },
    {
      id: "split",
      type: "splitOut",
      position: { x: 540, y: 280 },
      data: {
        label: "Split keywords",
        fieldName: "keywords",
        includeOtherFields: true,
      },
    },
    {
      id: "enrich",
      type: "code",
      position: { x: 800, y: 280 },
      data: {
        label: "Enrich + opportunity score",
        mode: "all",
        code: `const unwrap = (it) => {
  if (!it || typeof it !== "object") return {};
  if (it.json && typeof it.json === "object" && !Array.isArray(it.json)) return it.json;
  const { pairedItem, binary, json, ...rest } = it;
  return Object.keys(rest).length ? rest : {};
};

const minClicksDefault = 50;
const out = [];
for (const raw of items) {
  const row = unwrap(raw);
  const position = Number(row.position) || 99;
  const prev = Number(row.prevPosition) || position;
  const clicks = Number(row.clicks) || 0;
  const impressions = Number(row.impressions) || 0;
  const ctr = Number(row.ctr) || (impressions ? (clicks / impressions) * 100 : 0);
  const delta = prev - position; // positive = improved
  const rankPressure = Math.max(0, 30 - position);
  const trafficSignal = Math.min(40, clicks / 10);
  const momentum = Math.max(-15, Math.min(25, delta * 4));
  const ctrBonus = Math.min(20, ctr * 2);
  let opportunityScore = Math.round(rankPressure + trafficSignal + momentum + ctrBonus);
  opportunityScore = Math.max(0, Math.min(100, opportunityScore));

  let alert = null;
  if (delta <= -4) alert = "rank_drop";
  else if (delta >= 5 && position <= 15) alert = "breakout";
  else if (clicks >= 200 && position <= 5) alert = "defend_top";

  out.push({
    json: {
      ...row,
      clicks,
      impressions,
      ctr: Math.round(ctr * 10) / 10,
      delta,
      opportunityScore,
      alert,
      minClicks: Number(row.minClicks) || minClicksDefault,
      enrichedAt: new Date().toISOString(),
    },
  });
}
return out;`,
      },
    },
    {
      id: "filterTraffic",
      type: "filter",
      position: { x: 1060, y: 280 },
      data: {
        label: "Keep clicks ≥ 50",
        fieldName: "clicks",
        operator: "gte",
        right: "50",
      },
    },
    {
      id: "tierSwitch",
      type: "switch",
      position: { x: 1320, y: 280 },
      data: {
        label: "Route by opportunity",
        routingMode: "firstMatch",
        enableFallback: true,
        rules: [
          {
            id: "rule_hot",
            label: "Hot",
            left: "{{item.opportunityScore}}",
            operator: "gte",
            right: "75",
          },
          {
            id: "rule_warm",
            label: "Warm",
            left: "{{item.opportunityScore}}",
            operator: "gte",
            right: "45",
          },
        ],
      },
    },
    {
      id: "labelHot",
      type: "set",
      position: { x: 1580, y: 80 },
      data: {
        label: "Tag HOT",
        keepOnlySet: false,
        mappings: [
          { key: "tier", value: "hot" },
          { key: "action", value: "prioritize_now" },
        ],
      },
    },
    {
      id: "labelWarm",
      type: "set",
      position: { x: 1580, y: 280 },
      data: {
        label: "Tag WARM",
        keepOnlySet: false,
        mappings: [
          { key: "tier", value: "warm" },
          { key: "action", value: "plan_this_week" },
        ],
      },
    },
    {
      id: "labelWatch",
      type: "set",
      position: { x: 1580, y: 480 },
      data: {
        label: "Tag WATCH",
        keepOnlySet: false,
        mappings: [
          { key: "tier", value: "watch" },
          { key: "action", value: "monitor" },
        ],
      },
    },
    {
      id: "mergeHotWarm",
      type: "merge",
      position: { x: 1840, y: 180 },
      data: {
        label: "Merge hot + warm",
        mode: "append",
      },
    },
    {
      id: "mergeAll",
      type: "merge",
      position: { x: 2080, y: 320 },
      data: {
        label: "Merge + watch",
        mode: "append",
      },
    },
    {
      id: "sortOpp",
      type: "sort",
      position: { x: 2320, y: 320 },
      data: {
        label: "Sort opportunity desc",
        fieldName: "opportunityScore",
        direction: "desc",
      },
    },
    {
      id: "topN",
      type: "limit",
      position: { x: 2560, y: 320 },
      data: {
        label: "Top 8 board rows",
        maxItems: 8,
        keep: "first",
      },
    },
    {
      id: "board",
      type: "code",
      position: { x: 2800, y: 320 },
      data: {
        label: "Build pulse board",
        mode: "all",
        code: `const unwrap = (it) => {
  if (!it || typeof it !== "object") return {};
  if (it.json && typeof it.json === "object" && !Array.isArray(it.json)) return it.json;
  const { pairedItem, binary, json, ...rest } = it;
  return Object.keys(rest).length ? rest : {};
};

const rows = [];
const seen = new Set();
for (const raw of items) {
  const r = unwrap(raw);
  const key = String(r.keyword || r.id || JSON.stringify(r));
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push(r);
}
const hot = rows.filter((r) => r.tier === "hot").length;
const warm = rows.filter((r) => r.tier === "warm").length;
const watch = rows.filter((r) => r.tier === "watch").length;
const alerts = rows.filter((r) => r.alert).map((r) => ({
  keyword: r.keyword,
  alert: r.alert,
  delta: r.delta,
  position: r.position,
}));
const totalClicks = rows.reduce((s, r) => s + (Number(r.clicks) || 0), 0);

const board = {
  title: "Realtime SEO pulse",
  generatedAt: new Date().toISOString(),
  boardSize: rows.length,
  tierCounts: { hot, warm, watch },
  totalClicksOnBoard: totalClicks,
  alerts,
  rows,
  nextStepHint: "Swap Live feed Code for HTTP → GSC/SERP API when ready.",
};

return [
  { json: { ...board, kind: "summary" } },
  ...rows.map((r) => ({ json: { ...r, kind: "row" } })),
];`,
      },
    },
    {
      id: "result",
      type: "result",
      position: { x: 3040, y: 320 },
      data: {
        label: "Result — pulse board",
        mapFrom: "Realtime SEO pulse board ready",
      },
    },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "liveFeed" },
    { id: "e2", source: "liveFeed", target: "split" },
    { id: "e3", source: "split", target: "enrich" },
    { id: "e4", source: "enrich", target: "filterTraffic" },
    { id: "e5", source: "filterTraffic", target: "tierSwitch" },
    {
      id: "e6",
      source: "tierSwitch",
      target: "labelHot",
      sourceHandle: "rule_hot",
    },
    {
      id: "e7",
      source: "tierSwitch",
      target: "labelWarm",
      sourceHandle: "rule_warm",
    },
    {
      id: "e8",
      source: "tierSwitch",
      target: "labelWatch",
      sourceHandle: "fallback",
    },
    {
      id: "e9",
      source: "labelHot",
      target: "mergeHotWarm",
      targetHandle: "input1",
    },
    {
      id: "e10",
      source: "labelWarm",
      target: "mergeHotWarm",
      targetHandle: "input2",
    },
    {
      id: "e11",
      source: "mergeHotWarm",
      target: "mergeAll",
      targetHandle: "input1",
    },
    {
      id: "e12",
      source: "labelWatch",
      target: "mergeAll",
      targetHandle: "input2",
    },
    { id: "e13", source: "mergeAll", target: "sortOpp" },
    { id: "e14", source: "sortOpp", target: "topN" },
    { id: "e15", source: "topN", target: "board" },
    { id: "e16", source: "board", target: "result" },
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
  if (!users.length) throw new Error("No users found");
  const userId = users[0].id;

  let workspaceId = argWs;
  if (!workspaceId) {
    const [ws] = await pool.execute(
      `SELECT w.id FROM workspaces w
       INNER JOIN workspace_users wu ON wu.workspace_id = w.id AND wu.user_id = ?
       ORDER BY w.updated_at DESC LIMIT 1`,
      [userId]
    );
    workspaceId = ws[0]?.id;
    if (!workspaceId) {
      const [any] = await pool.execute(
        `SELECT id FROM workspaces ORDER BY updated_at DESC LIMIT 1`
      );
      workspaceId = any[0]?.id;
    }
  }
  if (!workspaceId) throw new Error("No workspace");

  const description =
    "Realtime-style SEO keyword pulse: live mock feed → enrich → filter → tier switch → merge → top board. Ready to swap feed for HTTP/API later.";

  const [existing] = await pool.execute(
    `SELECT id FROM workflows
     WHERE workspace_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1`,
    [workspaceId, WORKFLOW_NAME]
  );

  if (existing.length && !force) {
    console.log(`Already exists: ${existing[0].id}`);
    console.log(`Open: /workflows/${existing[0].id}`);
    process.exit(0);
  }

  if (existing.length && force) {
    await pool.execute(
      `UPDATE workflows SET definition_json = ?, description = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
  console.log(`workspace: ${workspaceId}`);
  console.log(`Open: /workflows/${id}`);
  process.exit(0);
};

module.exports = { WORKFLOW_NAME, definition };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
