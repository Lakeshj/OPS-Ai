# OpsAi GA4 — Existing Implementation Assessment

**Status:** Inspection only. No GA4 Tools / MCP implementation in this phase.  
**Date:** 2026-09-21  
**Companion plan:** `ga4_existing_assessment_f2c296bd` (do not edit that plan file for this work).

---

## Freeze decision (gate)

Native `googleAnalytics` remains the **auth + property + `runReport`** source of truth.

**Do not change until architecture shortlist is approved:**

- `google_ga4` OAuth product / scopes
- Property listing (`accountSummaries` → numeric / `properties/{id}`)
- Analytics Data API `POST …/v1beta/{property}:runReport` fetch path
- Curated metric / dimension allowlists (extend carefully later only)
- Flat `WorkflowItem` fan-out row shape

**Do not implement** a GA4 Tools / MCP layer until:

1. n8n answers in [§ n8n questionnaire](#n8n-questionnaire-section-j) are collected, and  
2. a DATA / INTELLIGENCE capability shortlist is agreed against those answers.

---

## A. Existing GA4 node

| Field | Value |
|--------|--------|
| Display name | Google Analytics |
| Node type | `googleAnalytics` |
| Credential type | `google_ga4` |
| Category | SEO (action) |
| Cardinality | `1-to-N` fan-out |
| Ports | main in → main out + error out |

**Where defined**

| Concern | Location |
|---------|----------|
| Contract | `frontend/src/modules/workflows/nodeContract.ts` (`googleAnalytics`, `params: []`) |
| UI schema | `frontend/src/modules/workflows/nodeParameterSchemas.ts` |
| Backend dispatch | `backend/services/workflowNodes.service.js` → thin delegate |
| Execution | `backend/services/workflowGoogleNodes.service.js` → `ga4Report` |
| Date presets | `backend/services/workflowGoogleDateRange.js` |
| Property picker API | `backend/services/workflowGoogleResources.service.js` → `listGa4PropertiesForCredential` |

**Operations (effective)**

- UI shows `resource: report`, `operation: get` — **backend ignores these fields**
- Single capability: Analytics Data API `runReport`

**Parameters (UI → `node.data`)**

- `credentialId`, `propertyId` (locator: account / manual / expression)
- `dateRange` (+ `startDate` / `endDate` when custom)
- `metrics[]`, `dimensions[]`
- `limit` (default 100), `returnAll` (caps at 10 000; **no real multi-page pagination**)
- `orderByField`, `orderDirection`
- `dimensionFilter`, `metricFilter` as JSON `{ field, operator, value }`

**Inputs / outputs**

- Input: optional upstream (`propertyId` can be expression); report does not require GSC-style item rows
- Output: fan-out `WorkflowItem[]` — one item per report row; summary on `output` (`propertyId`, dates, `rowCount`)

---

## B. Authentication

```text
GA4 node credentialId
  → googleOAuth.service (token refresh)
  → Admin API accountSummaries (property picker)
  → Analytics Data API runReport
```

- **OAuth product:** `google_ga4` with scope `https://www.googleapis.com/auth/analytics.readonly`
- **Same machinery as GSC** (`HYBRID_CUSTOM_PRIMARY`, custom-app or platform OAuth, shared `googleApiRequest`) — **separate credential type/scopes** (not the same token as `google_gsc`)
- **Account selection:** pick a `google_ga4` credential on the node
- **Property selection:** `GET /workflows/google-oauth/ga4-properties` → Admin API `accountSummaries` → numeric `propertyId` (normalized to `properties/{id}` at execute)
- **Passed to backend:** `node.data.credentialId` + `node.data.propertyId` (expressions resolved); `requiredType: "google_ga4"`

---

## C. Current GA4 capabilities (code reality)

### Curated metrics (Phase 1A)

Traffic/engagement: `sessions`, `totalUsers`, `newUsers`, `activeUsers`, `screenPageViews`, `screenPageViewsPerSession`, `eventCount`, `eventsPerSession`, `eventCountPerUser`, `userEngagementDuration`, `engagementRate`, `engagedSessions`, `averageSessionDuration`, `sessionsPerUser`, `bounceRate`, `scrolledUsers`

Conversions/ecommerce: `conversions`, `keyEvents`, `totalRevenue`, `purchaseRevenue`, `transactions`, `ecommercePurchases`, `addToCarts`, `checkouts`, `itemsPurchased`, `itemRevenue`

### Curated dimensions (Phase 1A)

`date`, `dateHour`, `dayOfWeekName`, `country`, `region`, `city`, `deviceCategory`, `browser`, `operatingSystem`, `platform`, `language`, `sessionSource`, `sessionMedium`, `sessionSourceMedium`, `sessionDefaultChannelGroup`, `sessionCampaignName`, `firstUserSource`, `firstUserMedium`, `firstUserDefaultChannelGroup`, `pageLocation`, `pagePath`, `pageTitle`, `hostName`, `landingPage`, `landingPagePlusQueryString`, `eventName`, `newVsReturning`

Unknown API names remain **soft-allowed** if they match `/^[a-zA-Z][a-zA-Z0-9]+$/` (UI only lists the curated set).

| Capability | Support | Notes |
|------------|---------|--------|
| Sessions / users / engagement / views | Yes | Via metrics allowlist |
| Events (count) | Partial | `eventCount` only; no event-name dimension in curated set |
| Conversions / key events / revenue | **No** | Not in UI/backend sets |
| Traffic acquisition | Partial | Via source/medium/campaign dimensions |
| Landing / pages | Partial | `landingPage`, `pagePath`, `pageLocation` |
| Devices / geo / browser / language | Yes | Dimensions allowlist |
| Dates | Yes | dim `date` + dateRange presets |
| Period comparisons | **No** | Single date range only |
| Segmentation | **No** | Only dim/metric filters |
| Report ops beyond get | **No** | UI stubs unused |
| Real pagination | **No** | Single request, limit ≤ 10k |

**Date presets:** today, yesterday, last7/28/30 days, lastCalendarWeek, lastCalendarMonth, custom.

**Filter operators:** metric equals/gt/lt/between; dimension equals/contains/beginsWith/inList.

---

## D. Input / output structure

Normalized row shape (flat `json`):

```text
{
  // each selected dimension → string field
  // each selected metric → number field
}
```

Example (sessions by pagePath):

```json
{ "json": { "pagePath": "/blog/foo", "sessions": 42, "totalUsers": 30 } }
```

Plus step `output`: `{ propertyId, startDate, endDate, rowCount }`.

- Row-based fan-out: yes  
- Dimensions + metrics flattened onto the same object (not nested headers)  
- Downstream Filter / Sort / AI / Sheets: yes (generic items / `{{input}}`)  
- No GA4-specific `intelligenceContext` today  

---

## E. Current workflow behavior

```text
Trigger → googleAnalytics → Filter → Sort → Sheets / Gmail / Result
```

- Native **data pull** (like GSC), not a processor  
- Upstream items not required for the report itself  
- n8n import marks `n8n-nodes-base.googleAnalytics` as **unavailable** (`OPSAI_AVAILABILITY.googleAnalytics: false`) — OpsAi uses its own canvas node type  

**Note:** `frontend/src/modules/analytics/` and `backend/modules/analytics/` are **product analytics UI/API**, not this workflow node.

---

## F. GA4 vs GSC architecture

| Aspect | GA4 now | GSC now |
|--------|---------|---------|
| Native pull node | `googleAnalytics` | `googleSearchConsole` |
| OAuth product | `google_ga4` | `google_gsc` |
| Resource picker | propertyId | siteUrl |
| Tools / MCP layer | **None** | `gscMcpTool` + `plugins/gsc-mcp` |
| Auth on tools layer | N/A | Tools do **not** re-auth |
| Intel contracts | None | IntelligenceContext, capabilities, scoring |
| Multi-capability UI | N/A | CTR / Ranking / Decay multi-select |
| Pagination | Single request ≤10k | Paginated Search Analytics |
| Shared platform patterns | Google OAuth, date-range helper, resource locator, fan-out items | Same |

**Already correct for future GA4 Tools:** separate credential + property on native node; row fan-out; Filter/Sort/AI-ready.

**Needs new layer (later):** GA4 Tools/MCP — analysis on upstream rows, no second OAuth.

---

## G. MCP readiness

| Pattern | GA4 status |
|---------|------------|
| Tool/capability contracts | Absent |
| MCP plugin (`plugins/ga4-*`) | Absent (only `gsc-mcp`) |
| Registry / audiences | Absent for GA4 |
| Normalized intel contracts | Absent |
| Reusable fetch service | Present (`ga4Report` / Google nodes) |
| AI grounding for GA4 | Absent (GSC-oriented today) |
| Workflow node for tools | Absent |

---

## H. Potential future capability categories (justified by current fetch)

**DATA** (reshape/export of fetched rows — still no auth)

- Traffic / engagement summaries  
- Acquisition cuts (source/medium/campaign)  
- Page / landing performance  
- Device / geo / browser splits  
- Event-count oriented views (limited until metrics expand)

**INTELLIGENCE** (analysis on upstream GA4 rows — parallel to GSC MCP Tools)

- Engagement / bounce-adjacent opportunity detection  
- Landing-page underperformance vs sessions  
- Acquisition anomaly / concentration insights  
- (Later) conversion/revenue intel — **only after** native metrics support exists

**ACTION** (downstream side effects — existing nodes)

- Sheets / Gmail / HTTP already exist; GA4 Tools should stay analysis-first like GSC Tools

---

## I. Native vs Tools split (target architecture)

**Native `googleAnalytics` keeps**

- Google OAuth (`google_ga4`)
- Account + GA4 property selection
- Date range, metrics, dimensions, filters, order, limits
- Calling Analytics Data API `runReport`
- Emitting flat WorkflowItems

**Future GA4 Tools layer should**

- Require upstream GA4 (or compatible) items
- **Not** reconnect Google / pick property
- Expose multi-capability analysis
- Feed Filter / Sort / AI

---

## n8n questionnaire (section J)

Send the questions below to n8n (or GA4 node / MCP maintainers). **Do not invent answers from web search.** Fill the **n8n answer** column when replies arrive. Compare each to the **OpsAi baseline**.

| # | Topic | Ask n8n | OpsAi baseline | n8n answer (fill in) |
|---|--------|---------|----------------|----------------------|
| 1 | Operations list | Report get only vs realtime, admin, pivot, cohort, funnel, etc.? | Single `runReport` get; UI resource/operation stubs unused | |
| 2 | Metrics catalog | Full metrics they expose; custom metric support? | Curated 8 + soft custom API name regex | |
| 3 | Dimensions catalog | Full dimensions; custom dimensions? | Curated 13 + soft custom API name regex | |
| 4 | Filter model | Expression shape, AND/OR, metric vs dimension filters? | Single dim filter + single metric filter objects; limited operators | |
| 5 | Comparisons | Previous period, YoY; request/response encoding? | Not supported (one date range) | |
| 6 | Date ranges / presets | Presets; timezone handling? | today/yesterday/last7/28/30/calendar week/month/custom via shared helper | |
| 7 | Segmentation | Audience / segment support? | None | |
| 8 | Output structure | Flat rows vs nested headers; pairing with input items? | Flat fan-out rows; no input pairing required | |
| 9 | Auth | OAuth scopes, service account?, property vs account resource names? | `analytics.readonly`; property `properties/{id}`; no SA in workflow path | |
| 10 | Pagination / limits | pageToken/offset, max rows, returnAll behavior? | Single request; limit ≤ 10 000; no pageToken loop | |
| 11 | Reporting extras | keepEmptyRows, metric aggregations, currency, quotas? | Not exposed | |
| 12 | MCP / tools layer | Tools re-auth or consume upstream data only? | No GA4 tools layer yet; GSC tools consume upstream only | |
| 13 | Reusable logic | Error mapping, property ID normalization worth aligning? | Normalize numeric → `properties/{id}`; shared `googleApiRequest` errors | |

### Collection checklist

- [ ] Questionnaire sent to n8n / maintainers  
- [ ] Answers recorded in the table above  
- [ ] Gap list written (n8n − OpsAi)  
- [ ] DATA / INTELLIGENCE shortlist agreed  
- [ ] Only then: design GA4 Tools (mirror GSC MCP: upstream rows in, multi-capability intel out, no second Google login)

---

## Recommended next steps (after this assessment)

1. Keep native GA4 frozen as documented above.  
2. Complete the n8n answer table.  
3. Design GA4 Tools only after shortlist approval — start with DATA/INTELLIGENCE justified by the current 8×13 curated surface (expand native metrics only when needed for conversions/revenue intel).

**No GA4 Tools code in this phase.**
