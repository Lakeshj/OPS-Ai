/**
 * Curated GA4 Data API metric/dimension catalogs (UI).
 * Must stay in sync with backend/services/ga4Catalog.js — smoke tests enforce parity.
 */

export const GA4_METRIC_OPTIONS = [
  { name: "Sessions", value: "sessions" },
  { name: "Total users", value: "totalUsers" },
  { name: "New users", value: "newUsers" },
  { name: "Active users", value: "activeUsers" },
  { name: "Views", value: "screenPageViews" },
  { name: "Views per session", value: "screenPageViewsPerSession" },
  { name: "Event count", value: "eventCount" },
  { name: "Events per session", value: "eventsPerSession" },
  { name: "Event count per user", value: "eventCountPerUser" },
  { name: "Engagement duration", value: "userEngagementDuration" },
  { name: "Engagement rate", value: "engagementRate" },
  { name: "Engaged sessions", value: "engagedSessions" },
  { name: "Average session duration", value: "averageSessionDuration" },
  { name: "Sessions per user", value: "sessionsPerUser" },
  { name: "Bounce rate", value: "bounceRate" },
  { name: "Scrolled users", value: "scrolledUsers" },
  { name: "Conversions", value: "conversions" },
  { name: "Key events", value: "keyEvents" },
  { name: "Total revenue", value: "totalRevenue" },
  { name: "Purchase revenue", value: "purchaseRevenue" },
  { name: "Transactions", value: "transactions" },
  { name: "Ecommerce purchases", value: "ecommercePurchases" },
  { name: "Add to carts", value: "addToCarts" },
  { name: "Checkouts", value: "checkouts" },
  { name: "Items purchased", value: "itemsPurchased" },
  { name: "Item revenue", value: "itemRevenue" },
] as const;

export const GA4_DIMENSION_OPTIONS = [
  { name: "Date", value: "date" },
  { name: "Date hour", value: "dateHour" },
  { name: "Day of week", value: "dayOfWeekName" },
  { name: "Country", value: "country" },
  { name: "Region", value: "region" },
  { name: "City", value: "city" },
  { name: "Device", value: "deviceCategory" },
  { name: "Browser", value: "browser" },
  { name: "Operating system", value: "operatingSystem" },
  { name: "Platform", value: "platform" },
  { name: "Language", value: "language" },
  { name: "Source", value: "sessionSource" },
  { name: "Medium", value: "sessionMedium" },
  { name: "Source / medium", value: "sessionSourceMedium" },
  { name: "Default channel group", value: "sessionDefaultChannelGroup" },
  { name: "Campaign", value: "sessionCampaignName" },
  { name: "First user source", value: "firstUserSource" },
  { name: "First user medium", value: "firstUserMedium" },
  { name: "First user channel group", value: "firstUserDefaultChannelGroup" },
  { name: "Page location", value: "pageLocation" },
  { name: "Page path", value: "pagePath" },
  { name: "Page title", value: "pageTitle" },
  { name: "Host name", value: "hostName" },
  { name: "Landing page", value: "landingPage" },
  { name: "Landing page + query", value: "landingPagePlusQueryString" },
  { name: "Event name", value: "eventName" },
  { name: "New vs returning", value: "newVsReturning" },
] as const;

export const GA4_DIMENSION_FILTER_OPERATORS = [
  { name: "Equals", value: "equals" },
  { name: "Contains", value: "contains" },
  { name: "Begins with", value: "beginsWith" },
  { name: "In list", value: "inList" },
] as const;

export const GA4_METRIC_FILTER_OPERATORS = [
  { name: "Equals", value: "equals" },
  { name: "Greater than", value: "gt" },
  { name: "Less than", value: "lt" },
  { name: "Between", value: "between" },
] as const;

export const GA4_ROW_MAX = 10000;
