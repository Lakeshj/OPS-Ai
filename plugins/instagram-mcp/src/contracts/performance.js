/**
 * Instagram MCP Performance (insights) tool contracts.
 * Metric names mirror backend instagramInsightsCatalog — validation stays native.
 */

const { objectSchema } = require("./common");

const ACCOUNT_PRESET_ENUM = Object.freeze([
  "overview",
  "engagement",
  "audience",
  "demographics",
  "custom",
]);

const MEDIA_PRESET_ENUM = Object.freeze([
  "overview",
  "engagement",
  "reels",
  "stories",
  "custom",
]);

const PERIOD_ENUM = Object.freeze([
  "day",
  "week",
  "days_28",
  "month",
  "lifetime",
  "total_over_range",
]);

const ACCOUNT_METRIC_ENUM = Object.freeze([
  "views",
  "reach",
  "follower_count",
  "profile_views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "follows_and_unfollows",
  "follower_demographics",
]);

const MEDIA_METRIC_ENUM = Object.freeze([
  "views",
  "reach",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saved",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
  "replies",
  "navigation",
  "exits",
  "taps_forward",
  "taps_back",
]);

const BREAKDOWN_ENUM = Object.freeze([
  "age",
  "city",
  "country",
  "gender",
  "follow_type",
]);

const MEDIA_TYPE_ENUM = Object.freeze([
  "IMAGE",
  "VIDEO",
  "CAROUSEL_ALBUM",
  "REELS",
  "STORY",
]);

const PERFORMANCE_TOOL_IDS = Object.freeze([
  "account_insights",
  "media_insights",
]);

const performanceToolDefinitions = (provider) =>
  Object.freeze([
    {
      provider: provider.id,
      id: "account_insights",
      displayName: "Account Insights",
      description:
        "Retrieve Instagram account performance metrics (reach, views, engagement) using the server-owned insights catalog.",
      whenToUse:
        "Use when the user asks about account-level performance, reach, impressions/views, or engagement trends over a period — not for listing individual posts.",
      category: "insights",
      authType: provider.authType,
      access: "read",
      risk: "low",
      implemented: true,
      executor: "instagram_mcp",
      uiGroup: "performance",
      inputSchema: objectSchema({
        preset: {
          type: "string",
          title: "Preset",
          description: "Catalog preset (overview, engagement, audience, …).",
          enum: [...ACCOUNT_PRESET_ENUM],
        },
        metrics: {
          type: "array",
          title: "Metrics",
          description: "Allowed catalog metrics (required for custom preset).",
          items: { type: "string", enum: [...ACCOUNT_METRIC_ENUM] },
        },
        period: {
          type: "string",
          title: "Period",
          description: "Insight period when supported by the metrics.",
          enum: [...PERIOD_ENUM],
        },
        dateRange: {
          type: "string",
          title: "Date range",
          description: "Named range such as last7days / last28days when supported.",
        },
        since: {
          type: "string",
          title: "Since",
          description: "Optional YYYY-MM-DD start when supported.",
        },
        until: {
          type: "string",
          title: "Until",
          description: "Optional YYYY-MM-DD end when supported.",
        },
        breakdown: {
          type: "string",
          title: "Breakdown",
          description: "Optional account breakdown when supported.",
          enum: [...BREAKDOWN_ENUM],
        },
      }),
      outputSchema: objectSchema({
        metric: { type: "string", description: "Metric name." },
        value: { type: "number", description: "Metric value when present." },
      }),
    },
    {
      provider: provider.id,
      id: "media_insights",
      displayName: "Media Insights",
      description:
        "Retrieve performance metrics for one media item using the media-type insights catalog.",
      whenToUse:
        "Use when the user asks for insights on a specific post and you already have its media id.",
      category: "insights",
      authType: provider.authType,
      access: "read",
      risk: "low",
      implemented: true,
      executor: "instagram_mcp",
      uiGroup: "performance",
      inputSchema: objectSchema(
        {
          mediaId: {
            type: "string",
            title: "Media ID",
            description: "Instagram media id.",
          },
          mediaType: {
            type: "string",
            title: "Media type",
            description: "Optional type hint (IMAGE, REELS, STORY, …).",
            enum: [...MEDIA_TYPE_ENUM],
          },
          preset: {
            type: "string",
            title: "Preset",
            description: "Catalog preset (overview, engagement, reels, …).",
            enum: [...MEDIA_PRESET_ENUM],
          },
          metrics: {
            type: "array",
            title: "Metrics",
            description: "Allowed media metrics (required for custom preset).",
            items: { type: "string", enum: [...MEDIA_METRIC_ENUM] },
          },
        },
        ["mediaId"]
      ),
      outputSchema: objectSchema({
        metric: { type: "string", description: "Metric name." },
        value: { type: "number", description: "Metric value when present." },
      }),
    },
  ]);

module.exports = {
  PERFORMANCE_TOOL_IDS,
  ACCOUNT_PRESET_ENUM,
  MEDIA_PRESET_ENUM,
  PERIOD_ENUM,
  ACCOUNT_METRIC_ENUM,
  MEDIA_METRIC_ENUM,
  BREAKDOWN_ENUM,
  MEDIA_TYPE_ENUM,
  performanceToolDefinitions,
};
