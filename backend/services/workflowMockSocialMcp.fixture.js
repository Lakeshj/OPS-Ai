/**
 * M8.16.1 — Local-only Mock Social MCP fixture.
 *
 * Test/dev tool provider that uses the same Agent tool-descriptor + executor
 * path as production MCP tools. Never a production integration; no external API.
 */

const PROVIDER_ID = "mock";
const TOOL_ID_LIST_POSTS = "list_posts";
const PUBLIC_TOOL_NAME = "mock_list_posts";

const MOCK_POSTS = Object.freeze([
  {
    id: "p1",
    date: "2026-11-20",
    type: "REEL",
    likes: 40,
    comments: 5,
  },
  {
    id: "p2",
    date: "2026-11-19",
    type: "IMAGE",
    likes: 25,
    comments: 2,
  },
  {
    id: "p3",
    date: "2026-11-18",
    type: "CAROUSEL",
    likes: 70,
    comments: 8,
  },
  {
    id: "p4",
    date: "2026-11-17",
    type: "REEL",
    likes: 30,
    comments: 1,
  },
  {
    id: "p5",
    date: "2026-11-16",
    type: "IMAGE",
    likes: 20,
    comments: 0,
  },
]);

const LIST_POSTS_CATALOG = Object.freeze({
  id: TOOL_ID_LIST_POSTS,
  provider: PROVIDER_ID,
  displayName: "List mock social posts",
  description:
    "Retrieve the five most recent mock social posts including date, post type, likes and comments.",
  whenToUse:
    "Use when the user asks about recent social posts or engagement.",
  access: "read",
  risk: "low",
  implemented: true,
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max posts to return (1–5).",
        minimum: 1,
        maximum: 5,
      },
    },
    required: [],
  },
});

const TOOLS_BY_ID = Object.freeze({
  [TOOL_ID_LIST_POSTS]: LIST_POSTS_CATALOG,
});

const getToolDefinition = (toolId) => {
  const id = String(toolId || "").trim();
  const tool = TOOLS_BY_ID[id];
  if (!tool) {
    throw new Error(`Unknown Mock Social MCP tool: ${id || "(empty)"}`);
  }
  return tool;
};

const listToolDefinitions = () => Object.values(TOOLS_BY_ID);

/**
 * Deterministic fixture execution — no network.
 */
const executeListPosts = (params = {}) => {
  const limitRaw = Number(params.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(5, Math.floor(limitRaw))
      : 5;
  const posts = MOCK_POSTS.slice(0, limit);
  return {
    ok: true,
    provider: PROVIDER_ID,
    tool: TOOL_ID_LIST_POSTS,
    posts,
    itemCount: posts.length,
  };
};

const executeTool = (toolId, params = {}) => {
  const id = String(toolId || "").trim();
  if (id === TOOL_ID_LIST_POSTS) {
    return executeListPosts(params);
  }
  throw new Error(`No Mock Social executor for tool: ${id || "(empty)"}`);
};

/** Safe public capability metadata for Copilot (no executors/secrets). */
const publicCapabilitiesForToolId = (toolId) => {
  const catalog = getToolDefinition(toolId);
  return {
    name: PUBLIC_TOOL_NAME,
    toolId: catalog.id,
    description: catalog.description,
    whenToUse: catalog.whenToUse,
    displayName: catalog.displayName,
  };
};

module.exports = {
  PROVIDER_ID,
  TOOL_ID_LIST_POSTS,
  PUBLIC_TOOL_NAME,
  MOCK_POSTS,
  LIST_POSTS_CATALOG,
  getToolDefinition,
  listToolDefinitions,
  executeListPosts,
  executeTool,
  publicCapabilitiesForToolId,
};
