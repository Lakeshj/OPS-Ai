/**
 * Instagram MCP Common (read) tool contracts.
 * Metrics / insights stay in performance.js. No write tools here.
 */

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const COMMON_TOOL_IDS = Object.freeze([
  "account_summary",
  "list_media",
  "media_details",
  "comments",
]);

const WRITE_TOOL_IDS = Object.freeze([
  "publish_image",
  "publish_carousel",
  "publish_reel",
  "publish_story",
  "reply_comment",
]);

const commonToolDefinitions = (provider) =>
  Object.freeze([
    {
      provider: provider.id,
      id: "account_summary",
      displayName: "Account Summary",
      description:
        "Return the current Instagram professional account profile (username, followers, following, media count, bio).",
      whenToUse:
        "Use when the user asks who the connected Instagram account is, follower counts, bio, or a high-level account overview.",
      category: "account",
      authType: provider.authType,
      access: "read",
      risk: "low",
      implemented: true,
      executor: "instagram_mcp",
      uiGroup: "common",
      inputSchema: objectSchema({}),
      outputSchema: objectSchema({
        id: { type: "string", description: "Instagram user id." },
        username: { type: "string", description: "Instagram username." },
      }),
    },
    {
      provider: provider.id,
      id: "list_media",
      displayName: "List Media",
      description:
        "Retrieve recent media from the Instagram account connected to this workflow (captions, post types, timestamps, likes, comments).",
      whenToUse:
        "Use when the user asks about recent posts, captions, post types, publishing dates, likes, comments, engagement, or which posts performed best. Pass limit (default 25) when they want a specific count.",
      category: "media",
      authType: provider.authType,
      access: "read",
      risk: "low",
      implemented: true,
      executor: "instagram_mcp",
      uiGroup: "common",
      inputSchema: objectSchema({
        limit: {
          type: "integer",
          title: "Limit",
          description: "Max media rows (default 25; server caps apply).",
          minimum: 1,
          maximum: 100,
        },
        maxItems: {
          type: "integer",
          title: "Max items",
          description: "Alias for limit.",
          minimum: 1,
          maximum: 100,
        },
      }),
      outputSchema: objectSchema({
        mediaId: { type: "string", description: "Media id." },
        mediaType: { type: "string", description: "Media type when present." },
      }),
    },
    {
      provider: provider.id,
      id: "media_details",
      displayName: "Media Details",
      description:
        "Retrieve one Instagram media object by id (caption, type, permalink, engagement counts when present).",
      whenToUse:
        "Use when the user asks for details about a specific post and you already have its media id.",
      category: "media",
      authType: provider.authType,
      access: "read",
      risk: "low",
      implemented: true,
      executor: "instagram_mcp",
      uiGroup: "common",
      inputSchema: objectSchema(
        {
          mediaId: {
            type: "string",
            title: "Media ID",
            description: "Instagram media id.",
          },
        },
        ["mediaId"]
      ),
      outputSchema: objectSchema({
        mediaId: { type: "string", description: "Media id." },
      }),
    },
    {
      provider: provider.id,
      id: "comments",
      displayName: "Comments",
      description:
        "List comments for one media item (read-only). Does not reply or publish.",
      whenToUse:
        "Use when the user asks what people commented on a specific post (requires media id).",
      category: "comments",
      authType: provider.authType,
      access: "read",
      risk: "low",
      implemented: true,
      executor: "instagram_mcp",
      uiGroup: "common",
      inputSchema: objectSchema(
        {
          mediaId: {
            type: "string",
            title: "Media ID",
            description: "Instagram media id.",
          },
          maxItems: {
            type: "integer",
            title: "Max items",
            description: "Max comments (server caps apply).",
            minimum: 1,
            maximum: 100,
          },
          limit: {
            type: "integer",
            title: "Limit",
            description: "Alias for max items.",
            minimum: 1,
            maximum: 100,
          },
        },
        ["mediaId"]
      ),
      outputSchema: objectSchema({
        id: { type: "string", description: "Comment id." },
        text: { type: "string", description: "Comment text when present." },
      }),
    },
  ]);

module.exports = {
  objectSchema,
  COMMON_TOOL_IDS,
  WRITE_TOOL_IDS,
  commonToolDefinitions,
};
