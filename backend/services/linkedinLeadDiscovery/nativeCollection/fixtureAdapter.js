/**
 * Deterministic fixtures — development / automated tests only.
 */

const FIXTURE_POSTS = Object.freeze([
  Object.freeze({
    sourcePostId: "fixture-li-1",
    sourcePostUrl:
      "https://www.linkedin.com/feed/update/urn:li:activity:fixture1",
    content:
      "Looking for a digital marketing agency to manage end-to-end campaigns for our SaaS brand. Recommendations welcome.",
    contentKind: "full",
    publishedAt: "2026-11-20T09:00:00.000Z",
    publishedAtVerified: true,
    author: {
      name: "Alex Rivera",
      headline: "VP Marketing",
      company: "Northwind SaaS",
      profileUrl: "https://www.linkedin.com/in/fixture-alex",
    },
    engagement: { likes: 42, comments: 11, reposts: 3 },
    _fixture: true,
    _sourceAdapter: "deterministic_fixtures",
  }),
  Object.freeze({
    sourcePostId: "fixture-li-2",
    sourcePostUrl:
      "https://www.linkedin.com/feed/update/urn:li:activity:fixture2",
    content:
      "Need SEO expert / SEO agency required for technical SEO and local SEO agency support this quarter.",
    contentKind: "full",
    publishedAt: "2026-11-18T14:30:00.000Z",
    publishedAtVerified: true,
    author: {
      name: "Priya Shah",
      headline: "Growth Lead",
      company: "Harbor Retail",
      profileUrl: "https://www.linkedin.com/in/fixture-priya",
    },
    engagement: { likes: 28, comments: 9, reposts: 1 },
    _fixture: true,
    _sourceAdapter: "deterministic_fixtures",
  }),
  Object.freeze({
    sourcePostId: "fixture-li-3",
    sourcePostUrl:
      "https://www.linkedin.com/feed/update/urn:li:activity:fixture3",
    content:
      "Exploring GEO agency and AEO services for ChatGPT visibility and AI search optimization.",
    contentKind: "full",
    publishedAt: "2026-11-15T11:10:00.000Z",
    publishedAtVerified: true,
    author: {
      name: "Jordan Lee",
      headline: "Founder",
      company: "Brightline Labs",
      profileUrl: "https://www.linkedin.com/in/fixture-jordan",
    },
    engagement: { likes: 67, comments: 22, reposts: 8 },
    _fixture: true,
    _sourceAdapter: "deterministic_fixtures",
  }),
  Object.freeze({
    sourcePostId: "fixture-li-4",
    sourcePostUrl:
      "https://www.linkedin.com/feed/update/urn:li:activity:fixture4",
    content:
      "Google Ads agency required and Meta Ads agency required for performance marketing partner search.",
    contentKind: "full",
    publishedAt: "2026-11-12T08:45:00.000Z",
    publishedAtVerified: true,
    author: {
      name: "Sam Okonkwo",
      headline: "Performance Manager",
      company: "Atlas Commerce",
      profileUrl: "https://www.linkedin.com/in/fixture-sam",
    },
    engagement: { likes: 19, comments: 4, reposts: 0 },
    _fixture: true,
    _sourceAdapter: "deterministic_fixtures",
  }),
  Object.freeze({
    sourcePostId: "fixture-li-5",
    sourcePostUrl:
      "https://www.linkedin.com/feed/update/urn:li:activity:fixture5",
    content:
      "Looking for influencer marketing agency and UGC agency required for creator collaboration.",
    contentKind: "full",
    publishedAt: "2026-11-10T16:20:00.000Z",
    publishedAtVerified: true,
    author: {
      name: "Mia Chen",
      headline: "Brand Manager",
      company: "Lumen Beauty",
      profileUrl: "https://www.linkedin.com/in/fixture-mia",
    },
    engagement: { likes: 53, comments: 15, reposts: 6 },
    _fixture: true,
    _sourceAdapter: "deterministic_fixtures",
  }),
]);

const searchFixtures = ({ queries, maxResults = 25 }) => {
  const limit = Math.min(Math.max(Number(maxResults) || 25, 1), 100);
  const q = Array.isArray(queries) ? queries : [];
  const matched = FIXTURE_POSTS.filter((post) => {
    if (!q.length) return true;
    const hay = String(post.content || "").toLowerCase();
    return q.some((query) =>
      hay.includes(String(query).toLowerCase().slice(0, 24))
    );
  });
  const rows = (matched.length ? matched : FIXTURE_POSTS.slice(0, Math.min(3, limit)))
    .slice(0, limit)
    .map((row) => ({ ...row }));
  return {
    rows,
    queryCount: q.length,
  };
};

const getFixturePost = ({ postUrl, postId }) => {
  const needle = String(postUrl || postId || "")
    .trim()
    .toLowerCase();
  const row =
    FIXTURE_POSTS.find(
      (p) =>
        String(p.sourcePostId).toLowerCase() === needle ||
        String(p.sourcePostUrl).toLowerCase() === needle ||
        (needle && String(p.sourcePostUrl).toLowerCase().includes(needle))
    ) || null;
  return { rows: row ? [{ ...row }] : [] };
};

module.exports = {
  id: "deterministic_fixtures",
  FIXTURE_POSTS,
  searchFixtures,
  getFixturePost,
};
