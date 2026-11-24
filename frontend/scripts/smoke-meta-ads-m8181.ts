/**
 * Meta Ads M8.18.1 — human-readable Run Results presentation (display-only).
 * Run: npx --yes tsx scripts/smoke-meta-ads-m8181.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";
import {
  maskAdAccountId,
  resolveMetaAdsOutputPresentation,
} from "../src/modules/workflows/metaAdsOutputPresentation";
import { formatStepOutput } from "../src/modules/workflows/runStepDisplay";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const read = (rel: string) =>
  fs.readFileSync(path.join(frontendRoot, rel), "utf8");

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const accountItem = {
  adAccountId: "1234567890128236",
  apiId: "act_1234567890128236",
  name: "Social Tech",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
  accountStatus: 1,
  accountStatusLabel: "ACTIVE",
  platformScope: "all",
  platformLabel: "All Meta",
  _meta: {
    provider: "meta_ads",
    resource: "adAccount",
    operation: "get",
    apiVersion: "v26.0",
  },
};

const campaignItem = {
  id: "111",
  name: "Lead Campaign",
  objective: "OUTCOME_LEADS",
  objectiveLabel: "Leads",
  status: "ACTIVE",
  statusLabel: "Active",
  platformScope: "instagram",
  platformLabel: "Instagram",
  presentation: {
    campaignName: "Lead Campaign",
    objective: "Leads",
    status: "Active",
    platformScope: "Instagram",
  },
  _meta: {
    provider: "meta_ads",
    resource: "campaign",
    operation: "list",
    apiVersion: "v26.0",
    platformScope: "instagram",
  },
};

const insightItem = {
  spend: 20,
  impressions: 1000,
  clicks: 40,
  date_start: "2026-09-29",
  date_stop: "2026-09-29",
  platformScope: "facebook",
  platformLabel: "Facebook",
  extracted: { leads: 2, linkClicks: 30 },
  presentation: {
    title: "Meta Ads · Facebook",
    subtitle: "Last 7 days",
    spend: 20,
    impressions: 1000,
    clicks: 40,
    leads: 2,
  },
  _meta: {
    provider: "meta_ads",
    resource: "insights",
    operation: "runReport",
    level: "account",
    apiVersion: "v26.0",
    dateRange: { since: "2026-09-29", until: "2026-10-05" },
  },
};

console.log("\nMeta Ads M8.18.1 presentation");

check("M8181-1 Ad Account Get resolves to human card", () => {
  const resolved = resolveOutputPresentation(accountItem);
  assert.equal(resolved?.provider, "meta_ads");
  assert.match(resolved!.summaryText, /Social Tech/);
  assert.match(resolved!.summaryText, /All Meta/);
  assert.match(resolved!.summaryText, /INR/);
  assert.equal(maskAdAccountId("1234567890128236"), "•••8236");
  assert.ok(!resolved!.summaryText.includes("apiVersion"));
  assert.ok(!resolved!.summaryText.includes("provider"));
});

check("M8181-2 envelope { items, output } resolves without mutating original", () => {
  const envelope = {
    items: [{ json: { ...accountItem } }],
    output: {
      resource: "adAccount",
      operation: "get",
      platformScope: "all",
      adAccountId: "1234567890128236",
      rowCount: 1,
    },
  };
  const before = JSON.stringify(envelope);
  const resolved = resolveOutputPresentation(envelope);
  assert.equal(resolved?.provider, "meta_ads");
  assert.equal(resolved?.shape, "items_array");
  assert.equal(JSON.stringify(envelope), before);
  assert.equal(resolved?.original, envelope);
});

check("M8181-3 Campaign list compact collection", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    ...campaignItem,
    id: String(100 + i),
    name: `Campaign ${i + 1}`,
    presentation: {
      ...campaignItem.presentation,
      campaignName: `Campaign ${i + 1}`,
    },
  }));
  const resolved = resolveMetaAdsOutputPresentation({
    items: rows,
    resource: "campaign",
    operation: "list",
  });
  assert.ok(resolved);
  assert.equal(resolved!.blocks[0].layout, "entity_list");
  assert.equal(resolved!.blocks[0].listRows?.length, 12);
  assert.match(resolved!.summaryText, /Campaign 1/);
  assert.match(resolved!.summaryText, /Active/);
});

check("M8181-4 Insights preserves platform heading", () => {
  const resolved = resolveOutputPresentation(insightItem);
  assert.equal(resolved?.provider, "meta_ads");
  assert.match(resolved!.summaryText, /Meta Ads · Facebook/);
  assert.match(resolved!.summaryText, /Last 7 days/);
  assert.match(resolved!.summaryText, /Spend/);
});

check("M8181-5 legacy report insights still present", () => {
  const legacy = {
    ...insightItem,
    platformScope: undefined,
    platformLabel: undefined,
    presentation: undefined,
    extracted: undefined,
    _meta: {
      provider: "meta_ads",
      resource: "insights",
      report: "campaign_performance",
      level: "campaign",
      apiVersion: "v26.0",
      dateRange: { since: "2026-09-29", until: "2026-10-05" },
      timezone: "UTC",
    },
  };
  const resolved = resolveOutputPresentation(legacy);
  assert.equal(resolved?.provider, "meta_ads");
  assert.match(resolved!.summaryText, /Meta Ads/);
});

check("M8181-6 formatStepOutput uses presentation summary", () => {
  const text = formatStepOutput({
    items: [{ json: accountItem }],
    output: { resource: "adAccount", operation: "get" },
  });
  assert.match(text, /Social Tech/);
  assert.ok(!text.trimStart().startsWith("{"));
});

check("M8181-7 Instagram still resolves independently", () => {
  const ig = {
    username: "eliteeagle.dev",
    name: "Shubham",
    _meta: {
      provider: "instagram",
      resource: "account",
      operation: "get_profile",
    },
  };
  const resolved = resolveOutputPresentation(ig);
  assert.equal(resolved?.provider, "instagram");
});

check("M8181-8 UI wiring present", () => {
  const preview = read("src/components/workflows/MetaAdsOutputPreview.tsx");
  assert.match(preview, /MetaAdsOutputPreview/);
  assert.match(preview, /Show \$\{hiddenCount\} more/);
  const viewer = read("src/components/workflows/ItemDataViewer.tsx");
  assert.match(viewer, /MetaAdsOutputPreview/);
  const results = read("src/components/workflows/WorkflowResultsSidebar.tsx");
  assert.match(results, /MetaAdsOutputPreview/);
  const resolver = read("src/modules/workflows/outputPresentation.ts");
  assert.match(resolver, /meta_ads/);
  assert.match(resolver, /resolveMetaAdsOutputPresentation/);
});

check("M8181-9 no backend execution files changed by presentation module", () => {
  const presentation = read("src/modules/workflows/metaAdsOutputPresentation.ts");
  assert.ok(!presentation.includes("workflowMetaAds.service"));
  assert.ok(!presentation.includes("metaGraph"));
  assert.ok(!presentation.includes("fetch("));
});

console.log(`\nM8.18.1 done: ${passed} checks`);
