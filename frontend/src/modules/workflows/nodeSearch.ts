/**
 * UX Phase A — ranked Node Library search (pure, UI-only).
 */

import catalog from "./nodeLibrary.json";
import type { LibraryNode, NodeLibraryCatalog } from "./nodeLibrary";
import {
  NODE_SEARCH_META,
  type NodeSearchMeta,
} from "./nodeSearchMeta";

const defaultNodes = (catalog as NodeLibraryCatalog).nodes;

export type NodeAvailabilityFilter = "available" | "all";

export type NodeSearchMatchKind =
  | "exact_name"
  | "name_prefix"
  | "name_word"
  | "alias"
  | "keyword"
  | "category"
  | "description"
  | "provider"
  | "fuzzy"
  | "none";

export type RankedLibraryNode = LibraryNode & {
  score: number;
  matchKind: NodeSearchMatchKind;
  bestMatch?: boolean;
};

export type SearchNodesOptions = {
  query?: string;
  category?: string | "all";
  availability?: NodeAvailabilityFilter;
  nodes?: LibraryNode[];
  /** Cap results (picker). */
  limit?: number;
};

const SCORE: Record<NodeSearchMatchKind, number> = {
  exact_name: 1000,
  name_prefix: 800,
  name_word: 650,
  alias: 550,
  keyword: 450,
  category: 300,
  description: 200,
  provider: 180,
  fuzzy: 120,
  none: 0,
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokenize = (value: string) =>
  normalize(value)
    .split(/\s+/)
    .filter(Boolean);

/** Lightweight Levenshtein for short typo tolerance. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

function metaFor(node: LibraryNode): NodeSearchMeta {
  return (
    NODE_SEARCH_META[node.id] ||
    (node.engineType ? NODE_SEARCH_META[node.engineType] : undefined) ||
    {}
  );
}

function bestMatchForNode(
  node: LibraryNode,
  query: string
): { kind: NodeSearchMatchKind; score: number } {
  if (!query) return { kind: "none", score: 0 };

  const q = normalize(query);
  const qTokens = tokenize(query);
  const name = normalize(node.name);
  const nameTokens = tokenize(node.name);
  const category = normalize(node.category);
  const description = normalize(node.description);
  const provider = normalize(String(node.provider || ""));
  const engine = normalize(String(node.engineType || ""));
  const meta = metaFor(node);
  const aliases = (meta.aliases || []).map(normalize);
  const keywords = (meta.keywords || []).map(normalize);

  if (name === q || engine === q) {
    return { kind: "exact_name", score: SCORE.exact_name };
  }
  {
    const prefixToken = nameTokens.find((t) => t.startsWith(q));
    const tightPrefix =
      (prefixToken && prefixToken.length <= q.length + 2) ||
      (name.startsWith(q) && name.length <= q.length + 2);
    if (tightPrefix) {
      return { kind: "name_prefix", score: SCORE.name_prefix };
    }
  }
  if (
    nameTokens.some((t) => t === q) ||
    qTokens.every((qt) =>
      nameTokens.some(
        (t) => t === qt || (t.startsWith(qt) && t.length <= qt.length + 2)
      )
    )
  ) {
    return { kind: "name_word", score: SCORE.name_word };
  }
  if (aliases.some((a) => a === q || a.startsWith(q) || tokenize(a).some((t) => t === q))) {
    return { kind: "alias", score: SCORE.alias };
  }
  if (keywords.some((k) => k === q || k.startsWith(q) || k.includes(q))) {
    return { kind: "keyword", score: SCORE.keyword };
  }
  if (category.includes(q) || tokenize(node.category).some((t) => t.startsWith(q))) {
    return { kind: "category", score: SCORE.category };
  }
  if (provider && (provider.includes(q) || provider.startsWith(q))) {
    return { kind: "provider", score: SCORE.provider };
  }
  if (description.includes(q)) {
    return { kind: "description", score: SCORE.description };
  }

  // Typo tolerance against name tokens + aliases (short queries only)
  if (q.length >= 4) {
    const fuzzyTargets = [...nameTokens, ...aliases];
    for (const target of fuzzyTargets) {
      if (target.length < 4) continue;
      const dist = editDistance(q, target.slice(0, Math.max(q.length, target.length)));
      if (dist <= 1 || (q.length >= 6 && dist <= 2)) {
        return { kind: "fuzzy", score: SCORE.fuzzy - dist * 10 };
      }
      // prefix typo: spredsheet → spreadsheet
      if (
        target.startsWith(q.slice(0, 3)) &&
        editDistance(q, target.slice(0, q.length)) <= 1
      ) {
        return { kind: "fuzzy", score: SCORE.fuzzy };
      }
    }
  }

  return { kind: "none", score: 0 };
}

function catalogOrderIndex(node: LibraryNode, nodes: LibraryNode[]): number {
  return nodes.findIndex((n) => n.id === node.id);
}

/**
 * Ranked node search. Empty query → catalog order (optionally filtered).
 */
export function searchNodes(options: SearchNodesOptions = {}): RankedLibraryNode[] {
  const {
    query = "",
    category = "all",
    availability = "all",
    nodes = defaultNodes,
    limit,
  } = options;

  const q = query.trim();
  let list = nodes.filter((n) => {
    if (category !== "all" && n.category !== category) return false;
    if (availability === "available" && !n.available) return false;
    return true;
  });

  if (!q) {
    const ranked = list.map((n, i) => ({
      ...n,
      score: 0,
      matchKind: "none" as const,
      bestMatch: false,
    }));
    return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
  }

  const scored: RankedLibraryNode[] = [];
  for (const node of list) {
    const match = bestMatchForNode(node, q);
    if (match.kind === "none") continue;
    // Prefer available when relevance is similar
    const availabilityBoost = node.available ? 25 : 0;
    scored.push({
      ...node,
      score: match.score + availabilityBoost,
      matchKind: match.kind,
      bestMatch: false,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (
      catalogOrderIndex(a, nodes) - catalogOrderIndex(b, nodes) ||
      a.name.localeCompare(b.name)
    );
  });

  if (scored.length > 0) {
    const top = scored[0].score;
    scored[0].bestMatch = true;
    // Mark near-ties as related (not best)
    for (let i = 1; i < scored.length; i += 1) {
      scored[i].bestMatch = false;
      if (top - scored[i].score > 200) {
        // keep order; UI may section related as the rest
      }
    }
  }

  return typeof limit === "number" ? scored.slice(0, limit) : scored;
}

/** Related = non-best results within a useful score window of the top hit. */
export function splitBestAndRelated(results: RankedLibraryNode[]): {
  best: RankedLibraryNode | null;
  related: RankedLibraryNode[];
  flat: RankedLibraryNode[];
} {
  if (results.length === 0) {
    return { best: null, related: [], flat: [] };
  }
  if (results.length === 1) {
    return { best: results[0], related: [], flat: results };
  }
  const best = results[0];
  const related = results.slice(1).filter((r) => best.score - r.score <= 400);
  const rest = results.slice(1).filter((r) => best.score - r.score > 400);
  return {
    best,
    related: [...related, ...rest],
    flat: results,
  };
}

export function getRecentNodeIds(limit = 5): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("opsai.workflow.recentNodes");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function pushRecentNodeId(nodeId: string) {
  if (typeof window === "undefined") return;
  try {
    const prev = getRecentNodeIds(20).filter((id) => id !== nodeId);
    const next = [nodeId, ...prev].slice(0, 12);
    window.localStorage.setItem(
      "opsai.workflow.recentNodes",
      JSON.stringify(next)
    );
  } catch {
    // ignore quota / private mode
  }
}
