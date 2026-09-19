/**
 * Smoke: MCP connection + essential catalog + audience gating (mock).
 * Catalog size: 6 data + 6 intelligence + 2 action = 14.
 */
const assert = require("assert");
const { createPlugin, getStaticCatalog, AUDIENCES } = require("../index");
const {
  ESSENTIAL_INTELLIGENCE_IDS,
  TOOL_LABELS,
} = require("../contracts/capabilities");

const ESSENTIAL_COUNT = 14;

const main = async () => {
  const plugin = createPlugin({ transport: "mock" });
  const tools = await plugin.listTools({}, { audience: AUDIENCES.AGENT });
  assert.equal(tools.length, ESSENTIAL_COUNT, `expected ${ESSENTIAL_COUNT} tools`);

  const data = tools.filter((t) => t.category === "data");
  const intel = tools.filter((t) => t.category === "intelligence");
  const actions = tools.filter((t) => t.category === "action");
  assert.equal(data.length, 6, "expected 6 data tools");
  assert.equal(intel.length, 6, "expected 6 intelligence tools");
  assert.equal(actions.length, 2, "expected 2 action tools");

  for (const id of ESSENTIAL_INTELLIGENCE_IDS) {
    const entry = intel.find((t) => t.id === id);
    assert.ok(entry, `registry missing intelligence id ${id}`);
    assert.equal(entry.label, TOOL_LABELS[id], `label mismatch for ${id}`);
    assert.notEqual(entry.id, entry.label, "ids must stay separate from labels");
  }

  assert.ok(
    tools.some((t) => t.id === "get_capabilities" && t.discoveryOnly),
    "get_capabilities must be discovery-only"
  );
  assert.ok(
    !tools.some((t) => t.name === "reauthenticate"),
    "reauthenticate must be blocked"
  );

  const future = await plugin.listTools(
    {},
    { audience: AUDIENCES.WORKFLOW_FUTURE }
  );
  assert.ok(
    !future.some((t) => t.id === "get_capabilities"),
    "workflow_future must exclude get_capabilities"
  );
  assert.equal(future.length, ESSENTIAL_COUNT - 1);

  const staticAgent = getStaticCatalog({}, { audience: AUDIENCES.AGENT });
  assert.equal(staticAgent.length, ESSENTIAL_COUNT);

  const metrics = plugin.contracts.metrics.metricOptionsForUi();
  assert.ok(metrics.some((m) => m.value === "get_impressions" && m.label === "Impressions"));

  console.log(
    `gsc-mcp smoke-connection OK tools=${tools.length} data=${data.length} intel=${intel.length} actions=${actions.length}`
  );
  await plugin.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
