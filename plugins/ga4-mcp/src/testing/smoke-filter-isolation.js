/**
 * STEP 8B — GA4 capabilitySettings filter isolation regression.
 * Does not change scoring; asserts extract + multi-cap processUpstream only.
 */
const assert = require("assert");
const path = require("path");

const filterContract = require("../contracts/filters");
const { processUpstreamItems } = require("../adapters/processUpstream");
const {
  FILTER_DEFAULTS,
  extractFiltersFromNodeData,
  validateCapabilityFilters,
} = filterContract;

const PAGE_ROWS = [
  {
    json: {
      pagePath: "/",
      sessions: 485,
      totalUsers: 306,
      engagementRate: 0.5021,
      bounceRate: 0.4979,
    },
  },
  {
    json: {
      pagePath: "/blog/",
      sessions: 80,
      totalUsers: 70,
      engagementRate: 0.25,
      bounceRate: 0.75,
    },
  },
  {
    json: {
      landingPage: "/lp/webinar",
      sessions: 200,
      totalUsers: 180,
      engagementRate: 0.18,
      bounceRate: 0.8,
      screenPageViews: 220,
    },
  },
  {
    json: {
      landingPage: "/lp/trial",
      sessions: 160,
      totalUsers: 150,
      engagementRate: 0.22,
      bounceRate: 0.72,
      screenPageViews: 180,
    },
  },
];

const ALL = [
  "engagement_opportunities",
  "landing_underperformance",
  "acquisition_concentration",
  "page_performance",
];

const real = (items) =>
  (items || []).filter((i) => i.json && !i.json.__ga4CapabilitySection);

const byCap = (items, cap) =>
  real(items).filter((i) => i.json.capability === cap);

const landLabels = (items) =>
  byCap(items, "landing_underperformance")
    .map((i) => i.json.entity && i.json.entity.label)
    .sort();

/**
 * Mirror CapabilitySettingsField.fieldValue GA4 display rule for Test 5.
 * (TSX is not required here — contract must match runtime CASE C.)
 */
function resolveGa4DisplayValue(values, capabilityId, fieldName, schemaDefault) {
  const bag = values.capabilitySettings;
  const hasBag =
    bag && typeof bag === "object" && !Array.isArray(bag);
  if (hasBag) {
    const nested = bag[capabilityId];
    if (
      nested &&
      typeof nested === "object" &&
      Object.prototype.hasOwnProperty.call(nested, fieldName)
    ) {
      return nested[fieldName];
    }
    return schemaDefault;
  }
  if (Object.prototype.hasOwnProperty.call(values, fieldName)) {
    return values[fieldName];
  }
  return schemaDefault;
}

function assertValidatedDefaults(capabilityId, raw) {
  const validated = validateCapabilityFilters(capabilityId, raw);
  assert.equal(validated.ok, true, `${capabilityId} filters must validate`);
  const defaults = FILTER_DEFAULTS[capabilityId];
  for (const [key, defVal] of Object.entries(defaults)) {
    assert.equal(
      validated.filters[key],
      defVal,
      `${capabilityId}.${key} should be default ${defVal}, got ${validated.filters[key]}`
    );
  }
}

function run() {
  // ---- Test 1: UI-style dual-write must not leak ----
  {
    const nodeData = {
      minSessions: 200,
      capabilitySettings: {
        engagement_opportunities: { minSessions: 200 },
      },
    };
    const eng = extractFiltersFromNodeData("engagement_opportunities", nodeData);
    const land = extractFiltersFromNodeData("landing_underperformance", nodeData);
    const acq = extractFiltersFromNodeData("acquisition_concentration", nodeData);
    const page = extractFiltersFromNodeData("page_performance", nodeData);

    assert.equal(eng.minSessions, 200);
    assert.equal("minSessions" in land, false);
    assert.equal("minSessions" in page, false);
    assert.equal("minSessions" in acq, false);

    const landV = validateCapabilityFilters("landing_underperformance", land);
    const pageV = validateCapabilityFilters("page_performance", page);
    const acqV = validateCapabilityFilters("acquisition_concentration", acq);
    assert.equal(landV.ok, true);
    assert.equal(pageV.ok, true);
    assert.equal(acqV.ok, true);
    assert.equal(landV.filters.minSessions, 150);
    assert.equal(pageV.filters.minSessions, 0);
    assert.equal(acqV.filters.minShare, FILTER_DEFAULTS.acquisition_concentration.minShare);

    const baseline = processUpstreamItems({
      capabilities: ALL,
      inputItems: PAGE_ROWS,
      nodeData: {},
    });
    const leaked = processUpstreamItems({
      capabilities: ALL,
      inputItems: PAGE_ROWS,
      nodeData,
    });
    assert.deepEqual(landLabels(leaked.items), landLabels(baseline.items));
    assert.equal(byCap(leaked.items, "landing_underperformance").length, 2);
    assert.equal(
      byCap(leaked.items, "engagement_opportunities").length,
      byCap(
        processUpstreamItems({
          capabilities: ALL,
          inputItems: PAGE_ROWS,
          nodeData: {
            capabilitySettings: {
              engagement_opportunities: { minSessions: 200 },
            },
          },
        }).items,
        "engagement_opportunities"
      ).length
    );
  }

  // ---- Test 2: nested-only ----
  {
    const nodeData = {
      capabilitySettings: {
        engagement_opportunities: { minSessions: 200 },
      },
    };
    assert.equal(
      extractFiltersFromNodeData("engagement_opportunities", nodeData).minSessions,
      200
    );
    assertValidatedDefaults(
      "landing_underperformance",
      extractFiltersFromNodeData("landing_underperformance", nodeData)
    );
    assertValidatedDefaults(
      "page_performance",
      extractFiltersFromNodeData("page_performance", nodeData)
    );
    assertValidatedDefaults(
      "acquisition_concentration",
      extractFiltersFromNodeData("acquisition_concentration", nodeData)
    );
  }

  // ---- Test 3: legacy flat (no capabilitySettings) ----
  {
    const nodeData = { minSessions: 200 };
    const eng = extractFiltersFromNodeData("engagement_opportunities", nodeData);
    assert.equal(eng.minSessions, 200);
    // Flat legacy still applies overlapping keys to any cap that lists them
    const land = extractFiltersFromNodeData("landing_underperformance", nodeData);
    assert.equal(land.minSessions, 200);
    const page = extractFiltersFromNodeData("page_performance", nodeData);
    assert.equal(page.minSessions, 200);
  }

  // ---- Test 4: shared filter-name matrix ----
  {
    const nodeData = {
      minSessions: 999,
      limit: 1,
      minScore: 50,
      capabilitySettings: {
        engagement_opportunities: {
          minSessions: 200,
          limit: 10,
          minScore: 1,
        },
      },
    };
    const eng = validateCapabilityFilters(
      "engagement_opportunities",
      extractFiltersFromNodeData("engagement_opportunities", nodeData)
    ).filters;
    assert.equal(eng.minSessions, 200);
    assert.equal(eng.limit, 10);
    assert.equal(eng.minScore, 1);

    const land = validateCapabilityFilters(
      "landing_underperformance",
      extractFiltersFromNodeData("landing_underperformance", nodeData)
    ).filters;
    assert.equal(land.minSessions, 150);
    assert.equal(land.limit, 50);
    assert.equal(land.minScore, 0);

    const page = validateCapabilityFilters(
      "page_performance",
      extractFiltersFromNodeData("page_performance", nodeData)
    ).filters;
    assert.equal(page.minSessions, 0);
    assert.equal(page.limit, 50);

    const acq = validateCapabilityFilters(
      "acquisition_concentration",
      extractFiltersFromNodeData("acquisition_concentration", nodeData)
    ).filters;
    assert.equal(acq.limit, 20);
    assert.equal(acq.minScore, 0);
  }

  // ---- Test 5: UI display isolation (fieldValue contract) ----
  {
    const values = {
      minSessions: 200,
      capabilitySettings: {
        engagement_opportunities: { minSessions: 200 },
      },
    };
    assert.equal(
      resolveGa4DisplayValue(
        values,
        "engagement_opportunities",
        "minSessions",
        100
      ),
      200
    );
    assert.equal(
      resolveGa4DisplayValue(
        values,
        "landing_underperformance",
        "minSessions",
        150
      ),
      150,
      "Landing UI must not show flat 200"
    );
    assert.equal(
      resolveGa4DisplayValue(values, "page_performance", "minSessions", 0),
      0
    );
  }

  // ---- Per-capability mutation isolation (processUpstream) ----
  {
    const baseline = processUpstreamItems({
      capabilities: ALL,
      inputItems: PAGE_ROWS,
      nodeData: {},
    });
    const engOnly = processUpstreamItems({
      capabilities: ALL,
      inputItems: PAGE_ROWS,
      nodeData: {
        capabilitySettings: {
          engagement_opportunities: { minSessions: 200 },
        },
      },
    });
    assert.deepEqual(
      landLabels(engOnly.items),
      landLabels(baseline.items),
      "Engagement filter must not change landing"
    );
    assert.equal(
      byCap(engOnly.items, "page_performance").length,
      byCap(baseline.items, "page_performance").length
    );

    const landOnly = processUpstreamItems({
      capabilities: ALL,
      inputItems: PAGE_ROWS,
      nodeData: {
        capabilitySettings: {
          landing_underperformance: { minSessions: 250 },
        },
      },
    });
    assert.equal(byCap(landOnly.items, "landing_underperformance").length, 0);
    assert.equal(
      byCap(landOnly.items, "engagement_opportunities").length,
      byCap(baseline.items, "engagement_opportunities").length
    );
  }

  console.log("ga4-mcp smoke-filter-isolation: OK");
}

run();
