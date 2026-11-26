/**
 * M10.3.12 — LinkedIn human-readable Copy Results (offline).
 * No live Apify / no billable calls.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  formatLinkedInLeadHumanReadableCopy,
  resolveLinkedInLeadCopyItems,
  shouldCopyLinkedInLeadHumanReadable,
} from "../src/modules/workflows/linkedinLeadCopyResults";

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

const fixturePath = path.join(
  __dirname,
  "../../backend/scripts/fixtures/linkedin-lead-m10311-25posts.json"
);

type FixturePost = {
  postId: string;
  url: string;
  content: string;
  postedAt: string;
  author: { name: string; headline?: string; url?: string; company?: string };
  engagement?: { likes?: number; comments?: number; shares?: number };
};

function toLeadJson(post: FixturePost, index: number) {
  return {
    sourcePostId: post.postId,
    sourcePostUrl: post.url,
    content: post.content,
    publishedAt: post.postedAt,
    matchedKeywords: index % 2 === 0 ? ["seo agency", "looking for"] : [],
    matchedCategories: index % 2 === 0 ? ["SEO", "Digital Marketing"] : [],
    matchedIntentIds: index % 3 === 0 ? ["looking_for", "outsourcing"] : [],
    author: {
      name: post.author.name,
      headline: post.author.headline || null,
      company: post.author.company || null,
      profileUrl: post.author.url || null,
    },
    engagement: post.engagement
      ? {
          likes: post.engagement.likes ?? null,
          comments: post.engagement.comments ?? null,
          reposts: post.engagement.shares ?? null,
        }
      : null,
    dataProvider: "apify",
    candidateOpportunity: true,
    qualifiedLead: false,
    _meta: {
      provider: "linkedin_lead_discovery",
      dataProvider: "apify",
      resource: "lead",
      operation: "discover_by_category",
    },
  };
}

console.log("\nM10.3.12 LinkedIn human-readable Copy Results");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  posts: FixturePost[];
};
const leads = fixture.posts.slice(0, 12).map(toLeadJson);

check("M10312-1 Formats all results with full content + URLs", () => {
  const text = formatLinkedInLeadHumanReadableCopy({ items: leads.map((json) => ({ json })) });
  assert.match(text, /LinkedIn Lead Discovery Results/);
  assert.match(text, /12 opportunities/);
  assert.match(text, /Opportunity 1/);
  assert.match(text, /Opportunity 12/);
  assert.match(text, /Oryntic Labs/);
  assert.match(text, /Post URL: https:\/\/www\.linkedin\.com\/posts\/oryntic/);
  assert.ok(text.includes(leads[0]!.content));
  assert.doesNotMatch(text, /Show more/i);
  assert.doesNotMatch(text, /^\s*\{/m); // not raw JSON object dump
});

check("M10312-2 Omits empty optional fields", () => {
  const sparse = {
    content: "Need an SEO partner next quarter.",
    sourcePostUrl: "https://www.linkedin.com/posts/sparse-example",
    author: { name: "Sparse Buyer" },
    dataProvider: "opsai_native",
    matchedKeywords: [],
    matchedCategories: [],
    matchedIntentIds: [],
    engagement: null,
    _meta: { provider: "linkedin_lead_discovery", dataProvider: "opsai_native" },
  };
  const text = formatLinkedInLeadHumanReadableCopy([sparse]);
  assert.match(text, /Author: Sparse Buyer/);
  assert.match(text, /Post URL:/);
  assert.doesNotMatch(text, /Company:/);
  assert.doesNotMatch(text, /Headline:/);
  assert.doesNotMatch(text, /Matched categories:/);
  assert.doesNotMatch(text, /Matched keywords:/);
  assert.doesNotMatch(text, /Matched intents:/);
  assert.doesNotMatch(text, /Likes:/);
  assert.doesNotMatch(text, /null|undefined/i);
});

check("M10312-3 Canonical resolve does not duplicate wrapper fields", () => {
  const one = leads[0]!;
  const wrapped = {
    items: [{ json: one }],
    result: [{ json: one }],
    __callableReturnItems: [{ json: one }],
  };
  const items = resolveLinkedInLeadCopyItems(wrapped);
  assert.equal(items.length, 1);
  const text = formatLinkedInLeadHumanReadableCopy(wrapped);
  const occurrences = text.split("Opportunity ").length - 1;
  assert.equal(occurrences, 1);
  assert.ok(shouldCopyLinkedInLeadHumanReadable(wrapped));
});

check("M10312-4 Preserves original line breaks in post content", () => {
  const multi = {
    ...leads[0],
    content: "Line one\n\nLine two\nLooking for an agency.",
  };
  const text = formatLinkedInLeadHumanReadableCopy([multi]);
  assert.ok(text.includes("Line one\n\nLine two\nLooking for an agency."));
});

check("M10312-5 Zero results path", () => {
  const text = formatLinkedInLeadHumanReadableCopy([]);
  assert.match(text, /0 opportunities/);
});

check("M10312-6 FE wiring: Copy Results + shared formatter", () => {
  const preview = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/workflows/LinkedInLeadOutputPreview.tsx"
    ),
    "utf8"
  );
  assert.match(preview, /Copy Results/);
  assert.match(preview, /formatLinkedInLeadHumanReadableCopy/);
  assert.doesNotMatch(preview, /Copy JSON/);

  const sidebar = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/workflows/WorkflowResultsSidebar.tsx"
    ),
    "utf8"
  );
  assert.match(sidebar, /formatLinkedInLeadHumanReadableCopy/);
  assert.match(sidebar, /shouldCopyLinkedInLeadHumanReadable/);
  assert.match(sidebar, /Copy Results/);
  // Other nodes still get JSON stringify path for non-LinkedIn.
  assert.match(sidebar, /JSON\.stringify/);
});

check("M10312-7 Intent labels mapped; provider present", () => {
  const text = formatLinkedInLeadHumanReadableCopy([leads[0]!]);
  assert.match(text, /Matched intents: Looking for, Outsourcing/);
  assert.match(text, /Data provider: apify/);
  assert.match(text, /Matched categories:/);
});

console.log(`\nM10.3.12 checks passed: ${passed}`);
console.log(process.exitCode ? "M10.3.12 FAIL" : "M10.3.12 PASS (offline)");
