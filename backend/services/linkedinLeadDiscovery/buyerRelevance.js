/**
 * Deterministic buyer-relevance filtering for LinkedIn Lead Discovery (M10.3.11).
 * Demand vs supply: prefer posts expressing service requirements; exclude seller promotions.
 * No AI calls. Thresholds differ for sortBy=recent vs sortBy=relevant.
 */

const { INTENT_VARIATIONS, SERVICE_CATEGORIES } = require("./keywordLibrary");

const BUYER_OPS = new Set([
  "discover_by_category",
  "discover_by_custom_keywords",
]);

const DIRECT_BUYER_RE = [
  /\b(?:looking for|needs?|needing|seeking|require(?:d|s|ments?)?|wants?|wanting|hiring)\b.{0,100}\b(?:agency|freelancer|consultant|partner|vendor|provider|expert|specialist|team|services?)\b/i,
  /\b(?:agency|freelancer|consultant|partner)\b.{0,40}\b(?:required|needed|wanted)\b/i,
  /\b(?:rfp|request for proposal|request for quote|rfq)\b/i,
  /\b(?:outsource|outsourcing)\b.{0,60}\b(?:agency|marketing|seo|ads|content|design|development|services?)\b/i,
  /\b(?:suggest|recommend|recommendations?)\b.{0,80}\b(?:agency|freelancer|consultant|partner|vendor)\b/i,
  /\bwho (?:can|should) (?:i|we) (?:hire|use|engage|contact)\b/i,
  /\b(?:any recommendations?|please recommend|dm me recommendations?)\b/i,
];

const INDIRECT_BUYER_RE = [
  /\b(?:struggling with|challenge(?:s)? with|help with|support (?:for|with)|stuck with)\b.{0,80}\b(?:seo|marketing|ads?|leads?|branding|website|content|social media|ppc|google ads|linkedin)\b/i,
  /\b(?:grow(?:ing)?|improve|increase|boost)\b.{0,40}\b(?:leads?|traffic|rankings?|visibility|pipeline|sales)\b/i,
  /\b(?:in[- ]house (?:team )?is (?:stretched|overwhelmed|limited)|don'?t have (?:an? )?(?:in[- ]house|internal))\b/i,
  /\b(?:external (?:agency|partner|help)|third[- ]party (?:agency|support))\b/i,
  /\b(?:budget (?:approved|available)|ready to (?:hire|engage|outsource))\b/i,
  /\b(?:open to (?:agencies|freelancers|partners)|evaluating (?:agencies|vendors|partners))\b/i,
];

const PARTNERSHIP_RE = [
  /\b(?:looking for|seeking|need)\b.{0,60}\b(?:partnership|partner(?:ship)?|co[- ]?market(?:ing)?|white[- ]?label|referral partner)\b/i,
  /\b(?:white[- ]?label|referral)\b.{0,40}\b(?:partner|agency|opportunity)\b/i,
];

const SELLER_PROMO_RE = [
  /\bwe (?:provide|offer|deliver|specialize in|help businesses|help brands)\b/i,
  /\bour (?:agency|team|experts?|services?|solutions?|portfolio|case stud(?:y|ies))\b/i,
  /\b(?:book (?:a |your )?(?:free )?consult(?:ation)?|free consultation|schedule a call|book a call)\b/i,
  /\b(?:hire (?:us|our agency)|work with us|partner with us|contact us (?:today|now|for))\b/i,
  /\b(?:dm (?:us|me) (?:to|for) (?:get|grow|scale|leads)|link in (?:bio|comments?))\b/i,
  /\b(?:limited time offer|special offer|discount on (?:our|marketing)|get more leads with us)\b/i,
  /\b(?:we help (?:startups|businesses|brands) (?:grow|scale|rank)|our marketing solutions)\b/i,
  /\b(?:case study|success story):\s/i,
  /\b(?:services? we offer|what we offer|our packages?)\b/i,
];

const RECRUITMENT_RE = [
  /\b(?:we'?re hiring|now hiring|job opening|open role|join our team|career(?:s)? (?:page|opportunity)|apply (?:now|today)|full[- ]time (?:role|position))\b/i,
  /\bhiring\s+(?:a\s+)?(?:seo|content|marketing|paid ads|social media)\s+(?:manager|specialist|executive|intern)\b/i,
];

const INFORMATIONAL_RE = [
  /\b(?:tips? (?:to|for)|how to|ultimate guide|what is|here(?:'| a)re \d+|thread:|carousel:)\b/i,
  /\b(?:lessons? (?:learned|from)|my thoughts on|opinion:)\b/i,
];

const countMatches = (patterns, text) => {
  let n = 0;
  const hits = [];
  for (const re of patterns) {
    if (re.test(text)) {
      n += 1;
      hits.push(re.source.slice(0, 48));
    }
  }
  return { n, hits };
};

const normalizeSortMode = (sortBy) =>
  String(sortBy || "recent").toLowerCase() === "relevant"
    ? "relevant"
    : "recent";

const shouldApplyBuyerFilter = (operation) =>
  BUYER_OPS.has(String(operation || ""));

/**
 * Score a single mapped row. Pure / deterministic.
 */
const scoreBuyerRelevance = (row, { categoryIds } = {}) => {
  const content = String(row?.content || row?.text || "").trim();
  const author = row?.author && typeof row.author === "object" ? row.author : {};
  const authorBlob = [
    author.name,
    author.headline,
    author.company,
    author.profileUrl,
  ]
    .filter(Boolean)
    .join(" ");
  const text = `${content}\n${authorBlob}`.trim();
  const lower = text.toLowerCase();

  const direct = countMatches(DIRECT_BUYER_RE, text);
  const indirect = countMatches(INDIRECT_BUYER_RE, text);
  const partnership = countMatches(PARTNERSHIP_RE, text);
  const seller = countMatches(SELLER_PROMO_RE, text);
  const recruitment = countMatches(RECRUITMENT_RE, text);
  const informational = countMatches(INFORMATIONAL_RE, text);

  // Soft category overlap via stems appearing in content (not required).
  let categoryHits = 0;
  const selected =
    Array.isArray(categoryIds) && categoryIds.length
      ? SERVICE_CATEGORIES.filter((c) => categoryIds.includes(c.id))
      : SERVICE_CATEGORIES;
  for (const cat of selected) {
    for (const stem of cat.serviceStems || []) {
      if (stem && lower.includes(String(stem).toLowerCase())) {
        categoryHits += 1;
        break;
      }
    }
  }

  const matchedIntentIds = [];
  for (const intent of INTENT_VARIATIONS) {
    const opener = String(intent.template || "")
      .replace(/\{stem\}/gi, "")
      .trim()
      .toLowerCase();
    const key = opener.split(/\s+/).slice(0, 2).join(" ");
    if (key.length >= 4 && lower.includes(key)) {
      matchedIntentIds.push(intent.id);
    }
  }

  let buyerScore =
    direct.n * 34 +
    indirect.n * 18 +
    partnership.n * 14 +
    categoryHits * 6 +
    matchedIntentIds.length * 4;
  let sellerScore = seller.n * 28 + informational.n * 8;
  if (recruitment.n) sellerScore += 40;

  // Agency author alone is NOT exclusion — only seller language is.
  const authorLooksAgency =
    /\bagency\b|\bmarketing\b|\bconsult(?:ant|ing)\b/i.test(authorBlob);
  if (authorLooksAgency && seller.n === 0 && direct.n + indirect.n > 0) {
    buyerScore += 8; // agencies outsourcing is valid demand
  }

  // Mixed: strong seller promo without separate buyer ask → exclude.
  const hasStrongBuyer = direct.n > 0 || (indirect.n >= 2 && partnership.n === 0);
  const hasAnyBuyer =
    direct.n > 0 || indirect.n > 0 || partnership.n > 0 || matchedIntentIds.length > 0;
  const clearSellerPromo = seller.n >= 2 || (seller.n >= 1 && !hasStrongBuyer);
  // Job posts often contain "hiring … SEO" — treat as recruitment when HR signals dominate.
  const clearRecruitment =
    recruitment.n > 0 &&
    (seller.n === 0 || recruitment.n >= seller.n) &&
    !/\b(?:looking for an? (?:agency|freelancer)|outsource|outsourcing|recommend an? agency)\b/i.test(
      text
    );

  let classification = "irrelevant";
  if (clearRecruitment) classification = "recruitment";
  else if (clearSellerPromo && !hasStrongBuyer) classification = "seller_promo";
  else if (direct.n > 0) classification = "direct_buyer";
  else if (partnership.n > 0 && seller.n === 0) classification = "partnership";
  // Tips/guides with only weak indirect phrasing are not buying opportunities.
  else if (informational.n > 0 && direct.n === 0 && partnership.n === 0)
    classification = "informational";
  else if (indirect.n > 0) classification = "potential_buyer";
  else if (hasAnyBuyer && seller.n === 0) classification = "potential_buyer";
  else classification = "irrelevant";

  // Net score used for relevant-mode sorting (buyer - seller).
  const netScore = buyerScore - sellerScore;

  return {
    classification,
    buyerScore,
    sellerScore,
    netScore,
    matchedIntentIds,
    signals: {
      directBuyer: direct.n,
      indirectBuyer: indirect.n,
      partnership: partnership.n,
      sellerPromo: seller.n,
      recruitment: recruitment.n,
      informational: informational.n,
      categoryHits,
    },
  };
};

/**
 * Mode thresholds (precision targets are validated via fixtures, not claimed here).
 * recent: accept borderline demand evidence
 * relevant: require clearer buying intent
 */
const acceptsClassification = (classification, sortMode) => {
  if (sortMode === "relevant") {
    return (
      classification === "direct_buyer" ||
      classification === "partnership" ||
      // potential_buyer only when not weak noise — gated by score below
      classification === "potential_buyer"
    );
  }
  // recent — moderately strict
  return (
    classification === "direct_buyer" ||
    classification === "potential_buyer" ||
    classification === "partnership"
  );
};

const meetsScoreFloor = (scored, sortMode) => {
  if (sortMode === "relevant") {
    if (scored.classification === "potential_buyer") {
      return scored.buyerScore >= 28 && scored.netScore >= 18;
    }
    if (scored.classification === "partnership") {
      return scored.buyerScore >= 20 && scored.netScore >= 14;
    }
    return scored.buyerScore >= 30 && scored.netScore >= 20;
  }
  // recent: allow borderline potential demand
  if (scored.classification === "potential_buyer") {
    return scored.buyerScore >= 4 && scored.netScore >= 4;
  }
  return scored.buyerScore >= 14 && scored.netScore >= 4;
};

const publishedMs = (row) => {
  const raw = row?.publishedAt || row?.postedAt || row?.postedAtISO;
  if (!raw) return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
};

/**
 * Filter + sort rows for buyer discovery. Pure.
 */
const filterBuyerRelevance = (
  rows,
  { sortBy = "recent", operation, categoryIds, maxResults } = {}
) => {
  const sortMode = normalizeSortMode(sortBy);
  if (!shouldApplyBuyerFilter(operation)) {
    return {
      rows: Array.isArray(rows) ? rows.slice(0, maxResults || rows.length) : [],
      diagnostics: {
        applied: false,
        reason: "buyer_filter_not_applicable",
        sortMode,
        rawCount: Array.isArray(rows) ? rows.length : 0,
        acceptedCount: Array.isArray(rows) ? rows.length : 0,
      },
    };
  }

  const raw = Array.isArray(rows) ? rows : [];
  const accepted = [];
  const excluded = {
    seller_promo: 0,
    recruitment: 0,
    informational: 0,
    irrelevant: 0,
    weak_intent: 0,
  };
  let directBuyer = 0;
  let potentialBuyer = 0;
  let partnership = 0;

  for (const row of raw) {
    const scored = scoreBuyerRelevance(row, { categoryIds });
    const okClass = acceptsClassification(scored.classification, sortMode);
    const okScore = meetsScoreFloor(scored, sortMode);
    if (!okClass || !okScore) {
      if (scored.classification === "seller_promo") excluded.seller_promo += 1;
      else if (scored.classification === "recruitment") excluded.recruitment += 1;
      else if (scored.classification === "informational")
        excluded.informational += 1;
      else if (!okClass) excluded.irrelevant += 1;
      else excluded.weak_intent += 1;
      continue;
    }
    if (scored.classification === "direct_buyer") directBuyer += 1;
    else if (scored.classification === "potential_buyer") potentialBuyer += 1;
    else if (scored.classification === "partnership") partnership += 1;

    accepted.push({
      ...row,
      matchedIntentIds: Array.from(
        new Set([
          ...(Array.isArray(row.matchedIntentIds) ? row.matchedIntentIds : []),
          ...scored.matchedIntentIds,
        ])
      ),
      candidateOpportunity: true,
      _relevance: {
        classification: scored.classification,
        buyerScore: scored.buyerScore,
        sellerScore: scored.sellerScore,
        netScore: scored.netScore,
        sortMode,
        signals: scored.signals,
      },
    });
  }

  accepted.sort((a, b) => {
    if (sortMode === "relevant") {
      const scoreDiff =
        (b._relevance?.netScore || 0) - (a._relevance?.netScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
    }
    return publishedMs(b) - publishedMs(a);
  });

  const limit = Math.min(
    Math.max(Number(maxResults) || accepted.length, 0),
    accepted.length
  );
  const limited = accepted.slice(0, limit || accepted.length);

  return {
    rows: limited,
    diagnostics: {
      applied: true,
      sortMode,
      rawCount: raw.length,
      acceptedBeforeLimit: accepted.length,
      acceptedCount: limited.length,
      competitorPromotionsExcluded: excluded.seller_promo,
      recruitmentExcluded: excluded.recruitment,
      informationalExcluded: excluded.informational,
      irrelevantExcluded: excluded.irrelevant + excluded.weak_intent,
      directBuyerOpportunities: directBuyer,
      potentialBuyerOpportunities: potentialBuyer,
      partnershipOpportunities: partnership,
      excluded,
    },
  };
};

module.exports = {
  scoreBuyerRelevance,
  filterBuyerRelevance,
  shouldApplyBuyerFilter,
  normalizeSortMode,
  BUYER_OPS,
};
