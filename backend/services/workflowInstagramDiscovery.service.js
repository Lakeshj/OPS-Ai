/**
 * Unified Login Instagram asset discovery (graph.facebook.com).
 * Separate from Meta Ads Graph client.
 *
 * Critical: Graph errors must NEVER be treated as empty `data: []`.
 *
 * Documented business edges:
 *   /{business-id}/owned_instagram_assets  (id, ig_user_id, ig_username)
 *   /{business-id}/client_instagram_assets
 */

const {
  SCOPE_BASIC,
  SCOPE_PAGES_READ,
  SCOPE_ADS_READ_DEPENDENCY,
  ACCESS_DEPENDENCY_PERMISSIONS,
  normalizeGrantedScope,
  graphBaseUrl,
  appCredentials,
} = require("../config/instagramGraph");

const EDGE_STATUS = Object.freeze({
  EMPTY: "BUSINESS_EDGE_EMPTY",
  PERMISSION_DENIED: "BUSINESS_EDGE_PERMISSION_DENIED",
  OBJECT_NOT_FOUND: "BUSINESS_EDGE_OBJECT_NOT_FOUND",
  UNSUPPORTED: "BUSINESS_EDGE_UNSUPPORTED",
  GRAPH_ERROR: "BUSINESS_EDGE_GRAPH_ERROR",
  SUCCESS: "BUSINESS_EDGE_SUCCESS",
});

const pushUniqueAccount = (map, row) => {
  const id = String(row?.id || row?.ig_user_id || "").trim();
  if (!id) return;
  const prev = map.get(id) || {
    id,
    username: "",
    source: "",
    assetId: "",
  };
  const username = String(
    row?.username || row?.ig_username || prev.username || ""
  ).trim();
  const source = String(row?.source || prev.source || "").slice(0, 80);
  const assetId = String(row?.assetId || row?.asset_id || prev.assetId || "").trim();
  map.set(id, { id, username, source, assetId });
};

/** Instagram Business Asset → IG User candidate. Never invent usernames. */
const normalizeAssetRow = (row, source) => {
  const assetId = String(row?.id || "").trim();
  const igUserId = String(row?.ig_user_id || "").trim();
  const username = String(row?.ig_username || row?.username || "").trim();
  // Prefer real IG user id; do not treat bare asset id as IG user unless that is all we have.
  if (igUserId) {
    return {
      id: igUserId,
      username,
      source,
      assetId: assetId || undefined,
    };
  }
  if (assetId && username) {
    // Asset listed username but no ig_user_id yet — keep asset id for direct lookup.
    return {
      id: assetId,
      username,
      source: `${source}:asset_pending`,
      assetId,
      needsAssetResolve: true,
    };
  }
  if (assetId) {
    return {
      id: assetId,
      username: "",
      source: `${source}:asset_only`,
      assetId,
      needsAssetResolve: true,
    };
  }
  return null;
};

const classifyGraphFailure = (err, body) => {
  const code = String(err?.code || "");
  const graphCode = Number(
    body?.error?.code || err?.graphCode || err?.errno || NaN
  );
  const subcode = Number(body?.error?.error_subcode || err?.graphSubcode || NaN);
  const message = String(err?.message || body?.error?.message || "");
  if (
    code === "INSTAGRAM_PERMISSION_DENIED" ||
    graphCode === 10 ||
    graphCode === 200 ||
    /permission|(#200)|(#10)/i.test(message)
  ) {
    return {
      status: EDGE_STATUS.PERMISSION_DENIED,
      graphErrorCode: Number.isFinite(graphCode) ? graphCode : undefined,
      graphErrorSubcode: Number.isFinite(subcode) ? subcode : undefined,
    };
  }
  if (
    graphCode === 100 ||
    /nonexisting field|unknown path|unsupported get request|does not exist/i.test(
      message
    )
  ) {
    const unsupported = /nonexisting field|unknown field|unsupported field/i.test(
      message
    );
    return {
      status: unsupported
        ? EDGE_STATUS.UNSUPPORTED
        : EDGE_STATUS.OBJECT_NOT_FOUND,
      graphErrorCode: Number.isFinite(graphCode) ? graphCode : undefined,
      graphErrorSubcode: Number.isFinite(subcode) ? subcode : undefined,
    };
  }
  return {
    status: EDGE_STATUS.GRAPH_ERROR,
    graphErrorCode: Number.isFinite(graphCode) ? graphCode : undefined,
    graphErrorSubcode: Number.isFinite(subcode) ? subcode : undefined,
  };
};

/**
 * Raw Graph GET via transport so edge callers can distinguish empty vs error.
 * Never logs tokens.
 */
const rawGraphGet = async ({
  transport,
  accessToken,
  path,
  query = {},
}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  params.set("access_token", accessToken);
  const url = `${graphBaseUrl()}/${String(path || "").replace(/^\//, "")}?${params.toString()}`;
  const res = await transport(url, { method: "GET" });
  return {
    ok: Boolean(res?.ok),
    status: Number(res?.status) || 0,
    body: res?.body || null,
  };
};

/**
 * Safe debug_token inspection — never returns or logs the token.
 */
const inspectAccessTokenDebug = async ({ accessToken, transport, logger }) => {
  const empty = {
    ok: false,
    scopes: [],
    granularScopes: [],
    granularTargetIdsCount: 0,
    granularScopeNames: [],
    appIdMatchesExpected: false,
    isValid: false,
    tokenType: "",
    hasInstagramBasic: false,
    hasPagesReadEngagement: false,
    hasBusinessManagement: false,
    hasAdsRead: false,
    hasAdsManagement: false,
    hasAdsReadOrManagement: false,
  };
  const app = appCredentials();
  if (!app.appId || !app.appSecret || !accessToken) return empty;
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${app.appId}|${app.appSecret}`,
  });
  let res;
  try {
    res = await transport(
      `${graphBaseUrl()}/debug_token?${params.toString()}`,
      { method: "GET" }
    );
  } catch {
    logger({ event: "instagram_discovery_debug_token", ok: false });
    return empty;
  }
  if (!res?.ok) {
    logger({
      event: "instagram_discovery_debug_token",
      ok: false,
      status: res?.status,
    });
    return empty;
  }
  const data =
    res.body?.data && typeof res.body.data === "object"
      ? res.body.data
      : res.body || {};
  const scopes = [
    ...new Set(
      (Array.isArray(data.scopes) ? data.scopes : [])
        .map((s) => normalizeGrantedScope(s))
        .filter(Boolean)
    ),
  ];
  const granularScopes = Array.isArray(data.granular_scopes)
    ? data.granular_scopes.map((entry) => ({
        scope: normalizeGrantedScope(entry?.scope),
        targetIdsCount: Array.isArray(entry?.target_ids)
          ? entry.target_ids.length
          : 0,
        targetIds: Array.isArray(entry?.target_ids)
          ? entry.target_ids.map((id) => String(id).trim()).filter(Boolean)
          : [],
      }))
    : [];
  const granularTargetIdsCount = granularScopes.reduce(
    (sum, entry) => sum + entry.targetIdsCount,
    0
  );
  const granularScopeNames = [
    ...new Set(granularScopes.map((e) => e.scope).filter(Boolean)),
  ];
  const tokenAppId = String(data.app_id || "").trim();
  const hasAdsRead = scopes.includes(SCOPE_ADS_READ_DEPENDENCY);
  const hasAdsManagement = scopes.includes("ads_management");
  const result = {
    ok: true,
    scopes,
    granularScopes,
    granularTargetIdsCount,
    granularScopeNames,
    appIdMatchesExpected: Boolean(tokenAppId && tokenAppId === app.appId),
    isValid: data.is_valid !== false,
    tokenType: String(data.type || data.token_type || "").slice(0, 40),
    hasInstagramBasic: scopes.includes(SCOPE_BASIC),
    hasPagesReadEngagement: scopes.includes(SCOPE_PAGES_READ),
    hasBusinessManagement: scopes.includes("business_management"),
    hasAdsRead,
    hasAdsManagement,
    hasAdsReadOrManagement: ACCESS_DEPENDENCY_PERMISSIONS.some((p) =>
      scopes.includes(p)
    ),
  };
  logger({
    event: "instagram_discovery_debug_token",
    ok: true,
    scopeCount: scopes.length,
    granularTargetIdsCount,
    granularScopeNames,
    tokenType: result.tokenType || undefined,
    appIdMatchesExpected: result.appIdMatchesExpected,
    isValid: result.isValid,
    hasInstagramBasic: result.hasInstagramBasic,
    hasPagesReadEngagement: result.hasPagesReadEngagement,
    hasBusinessManagement: result.hasBusinessManagement,
    hasAdsRead: result.hasAdsRead,
    hasAdsManagement: result.hasAdsManagement,
  });
  return result;
};

const assertRequiredUnifiedPermissions = (debugInfo, igError) => {
  if (!debugInfo?.ok) {
    throw igError(
      "Instagram token could not be inspected. Reconnect Instagram.",
      "INSTAGRAM_REQUIRED_PERMISSION_MISSING",
      403
    );
  }
  if (!debugInfo.isValid) {
    throw igError(
      "Instagram login expired or was revoked. Reconnect Instagram.",
      "INSTAGRAM_TOKEN_INVALID",
      401
    );
  }
  if (!debugInfo.hasInstagramBasic) {
    throw igError(
      "Instagram basic access was not granted. Reconnect and allow Instagram professional account access.",
      "INSTAGRAM_REQUIRED_PERMISSION_MISSING",
      403
    );
  }
  if (!debugInfo.hasPagesReadEngagement) {
    throw igError(
      "pages_read_engagement is required to resolve Instagram accounts shared through Business Manager.",
      "INSTAGRAM_PERMISSION_PAGES_READ_ENGAGEMENT_REQUIRED",
      403
    );
  }
};

const collectAssignedInstagramAccounts = async ({
  graphGet,
  accessToken,
  credentialId,
  workspaceId,
  logger,
}) => {
  const found = new Map();
  const seenCursors = new Set();
  let after = "";
  let edgeStatus = EDGE_STATUS.EMPTY;
  let graphErrorCode;
  let graphErrorSubcode;
  try {
    for (let page = 0; page < 20; page += 1) {
      const query = { fields: "id,username" };
      if (after) query.after = after;
      const pageBody = await graphGet({
        accessToken,
        credentialId,
        workspaceId,
        path: "me/assigned_instagram_accounts",
        query,
      });
      const rows = Array.isArray(pageBody?.data) ? pageBody.data : [];
      for (const row of rows) {
        pushUniqueAccount(found, {
          ...row,
          source: "assigned_instagram_accounts",
        });
      }
      if (rows.length) edgeStatus = EDGE_STATUS.SUCCESS;
      const next = String(pageBody?.paging?.cursors?.after || "").trim();
      if (!rows.length || !next || next === after || seenCursors.has(next)) break;
      seenCursors.add(next);
      after = next;
    }
  } catch (err) {
    const classified = classifyGraphFailure(err);
    edgeStatus = classified.status;
    graphErrorCode = classified.graphErrorCode;
    graphErrorSubcode = classified.graphErrorSubcode;
  }
  logger({
    event: "instagram_discovery_assigned",
    count: found.size,
    status: edgeStatus,
    graphErrorCode,
    graphErrorSubcode,
  });
  return {
    accounts: [...found.values()],
    count: found.size,
    status: edgeStatus,
    graphErrorCode,
    graphErrorSubcode,
  };
};

/**
 * Resolve each granular target ID to a typed category.
 * Categories: Instagram Business Asset | Instagram User | Page | Business | Ad Account | unknown
 */
const resolveGranularTargetCandidates = async ({
  debugInfo,
  transport,
  accessToken,
  logger,
}) => {
  const found = new Map();
  const categories = [];
  const assets = [];
  let instagramAssetTargets = 0;

  for (const entry of debugInfo.granularScopes || []) {
    const scope = String(entry.scope || "");
    for (const targetId of entry.targetIds || []) {
      let category = "unknown";
      let account = null;
      let assetMeta = null;

      // 1) Instagram Business Asset
      try {
        const res = await rawGraphGet({
          transport,
          accessToken,
          path: targetId,
          query: { fields: "id,ig_user_id,ig_username" },
        });
        if (res.ok && res.body?.ig_user_id) {
          category = "instagram_business_asset";
          instagramAssetTargets += 1;
          assetMeta = {
            asset_id: String(res.body.id || targetId),
            ig_user_id: String(res.body.ig_user_id),
            ig_username: String(res.body.ig_username || "").trim(),
          };
          account = normalizeAssetRow(res.body, `granular:${scope}`);
        } else if (res.ok && res.body?.id && res.body?.ig_username) {
          category = "instagram_business_asset";
          instagramAssetTargets += 1;
          account = normalizeAssetRow(res.body, `granular:${scope}`);
        }
      } catch {
        // continue typing
      }

      // 2) IG User
      if (!account) {
        try {
          const res = await rawGraphGet({
            transport,
            accessToken,
            path: targetId,
            query: { fields: "id,username" },
          });
          if (res.ok && res.body?.username) {
            category = "instagram_user";
            account = {
              id: String(res.body.id || targetId),
              username: String(res.body.username || "").trim(),
              source: `granular:${scope}`,
            };
          }
        } catch {
          // continue
        }
      }

      // 3) Page
      if (category === "unknown") {
        try {
          const res = await rawGraphGet({
            transport,
            accessToken,
            path: targetId,
            query: {
              fields: "id,name,instagram_business_account{id,username}",
            },
          });
          if (res.ok && res.body?.instagram_business_account) {
            category = "page";
            const ig = res.body.instagram_business_account;
            account = {
              id: String(ig.id || "").trim(),
              username: String(ig.username || "").trim(),
              source: `granular_page:${scope}`,
            };
          } else if (res.ok && res.body?.name && !res.body?.ig_user_id) {
            category = "page";
          }
        } catch {
          // continue
        }
      }

      // 4) Business
      if (category === "unknown") {
        try {
          const res = await rawGraphGet({
            transport,
            accessToken,
            path: targetId,
            query: { fields: "id,name,verification_status" },
          });
          if (
            res.ok &&
            res.body?.id &&
            (res.body.verification_status != null ||
              /business/i.test(String(res.body?.name || "")))
          ) {
            category = "business";
          } else if (res.ok && res.body?.id && res.body?.name && !res.body?.username) {
            // Heuristic: businesses often expose name without username/account_type
            category = "business";
          }
        } catch {
          // continue
        }
      }

      // 5) Ad account
      if (category === "unknown" && /^act_/i.test(targetId)) {
        category = "ad_account";
      } else if (category === "unknown") {
        try {
          const res = await rawGraphGet({
            transport,
            accessToken,
            path: targetId,
            query: { fields: "id,account_id,currency,name" },
          });
          if (res.ok && (res.body?.account_id || res.body?.currency)) {
            category = "ad_account";
          }
        } catch {
          // leave unknown
        }
      }

      categories.push({
        permission: scope,
        targetIdPresent: true,
        category,
      });
      if (assetMeta) assets.push(assetMeta);
      if (account?.id) pushUniqueAccount(found, account);
    }
  }

  logger({
    event: "instagram_discovery_granular_targets",
    count: found.size,
    categoryCount: categories.length,
    instagramAssetTargets,
  });
  return {
    accounts: [...found.values()],
    categories,
    assets,
    count: found.size,
    instagramAssetTargets,
  };
};

/**
 * Candidate Business IDs with source tracking.
 * Never assumes /me is the portfolio.
 */
const collectBusinessIds = async ({
  graphGet,
  transport,
  accessToken,
  credentialId,
  workspaceId,
  granularCategories,
  logger,
}) => {
  const byId = new Map();
  const add = (id, source, businessName) => {
    const biz = String(id || "").trim();
    if (!biz) return;
    if (!byId.has(biz)) {
      byId.set(biz, {
        businessId: biz,
        source: String(source || "").slice(0, 60),
        businessName: businessName
          ? String(businessName).slice(0, 80)
          : undefined,
      });
    }
  };

  try {
    const me = await graphGet({
      accessToken,
      credentialId,
      workspaceId,
      path: "me",
      query: { fields: "id,client_business_id" },
    });
    add(me?.client_business_id, "client_business_id");
  } catch {
    // continue
  }

  try {
    const body = await graphGet({
      accessToken,
      credentialId,
      workspaceId,
      path: "me/businesses",
      query: { fields: "id,name" },
    });
    for (const row of Array.isArray(body?.data) ? body.data : []) {
      add(row?.id, "me/businesses", row?.name);
    }
  } catch {
    // optional
  }

  // Granular targets typed as business
  for (const entry of granularCategories || []) {
    if (entry.category === "business" && entry.targetId) {
      add(entry.targetId, "granular_target:business");
    }
  }

  // Also try to pull business ids from granular target ids already classified
  // (categories from resolve step may not include targetId — re-scan debug scopes below if needed)

  const list = [...byId.values()];
  logger({
    event: "instagram_discovery_business_ids",
    count: list.length,
    sources: list.map((b) => b.source),
  });
  return list;
};

/**
 * Query owned/client Instagram asset edges per business.
 * Empty success and Graph errors are distinct statuses.
 */
const collectFromBusinessEdges = async ({
  transport,
  accessToken,
  businessCandidates,
  logger,
}) => {
  const found = new Map();
  const perBusiness = [];
  const counts = {
    owned_instagram_assets: 0,
    client_instagram_assets: 0,
  };
  const edges = ["owned_instagram_assets", "client_instagram_assets"];

  for (const biz of businessCandidates) {
    const businessId = biz.businessId;
    const edgeReports = {};
    for (const edge of edges) {
      let report = {
        status: EDGE_STATUS.EMPTY,
        count: 0,
        graph_error_code: undefined,
        graph_error_subcode: undefined,
        assets: [],
      };
      try {
        const res = await rawGraphGet({
          transport,
          accessToken,
          path: `${businessId}/${edge}`,
          query: { fields: "id,ig_user_id,ig_username" },
        });
        if (!res.ok) {
          const classified = classifyGraphFailure(
            {
              code:
                res.status === 403
                  ? "INSTAGRAM_PERMISSION_DENIED"
                  : "INSTAGRAM_GRAPH_ERROR",
              message: res.body?.error?.message,
              graphCode: res.body?.error?.code,
              graphSubcode: res.body?.error?.error_subcode,
            },
            res.body
          );
          report = {
            status: classified.status,
            count: null, // explicit: not an empty success
            graph_error_code: classified.graphErrorCode,
            graph_error_subcode: classified.graphErrorSubcode,
            assets: [],
          };
        } else {
          const rows = Array.isArray(res.body?.data) ? res.body.data : [];
          const assets = [];
          for (const row of rows) {
            const normalized = normalizeAssetRow(row, edge);
            if (normalized?.id) {
              pushUniqueAccount(found, normalized);
              assets.push({
                asset_id: String(row.id || "").trim() || undefined,
                ig_user_id: String(row.ig_user_id || "").trim() || undefined,
                ig_username: String(row.ig_username || "").trim() || undefined,
              });
            } else if (row?.id) {
              // Resolve asset directly when fields incomplete
              try {
                const assetRes = await rawGraphGet({
                  transport,
                  accessToken,
                  path: String(row.id),
                  query: { fields: "id,ig_user_id,ig_username" },
                });
                if (assetRes.ok && assetRes.body?.ig_user_id) {
                  const resolved = normalizeAssetRow(assetRes.body, edge);
                  if (resolved?.id) {
                    pushUniqueAccount(found, resolved);
                    assets.push({
                      asset_id: String(assetRes.body.id || row.id),
                      ig_user_id: String(assetRes.body.ig_user_id),
                      ig_username: String(assetRes.body.ig_username || "").trim(),
                    });
                  }
                }
              } catch {
                // keep going
              }
            }
          }
          report = {
            status: rows.length ? EDGE_STATUS.SUCCESS : EDGE_STATUS.EMPTY,
            count: rows.length,
            graph_error_code: undefined,
            graph_error_subcode: undefined,
            assets,
          };
          counts[edge] += rows.length;
        }
      } catch (err) {
        const classified = classifyGraphFailure(err);
        report = {
          status: classified.status,
          count: null,
          graph_error_code: classified.graphErrorCode,
          graph_error_subcode: classified.graphErrorSubcode,
          assets: [],
        };
      }
      edgeReports[edge] = report;
      logger({
        event: "instagram_discovery_business_edge",
        businessId,
        edge,
        status: report.status,
        count: report.count,
        graphErrorCode: report.graph_error_code,
        graphErrorSubcode: report.graph_error_subcode,
      });
    }
    perBusiness.push({
      source: biz.source,
      id: businessId,
      businessName: biz.businessName,
      owned_instagram_assets: edgeReports.owned_instagram_assets,
      client_instagram_assets: edgeReports.client_instagram_assets,
    });
  }

  return {
    accounts: [...found.values()],
    counts,
    count: found.size,
    perBusiness,
  };
};

const collectFromPages = async ({
  graphGet,
  accessToken,
  credentialId,
  workspaceId,
  hasPagesReadEngagement,
  logger,
}) => {
  const found = new Map();
  if (!hasPagesReadEngagement) {
    logger({
      event: "instagram_discovery_pages",
      count: 0,
      status: EDGE_STATUS.PERMISSION_DENIED,
      skipped: "pages_read_engagement_missing",
    });
    return {
      accounts: [],
      count: 0,
      status: EDGE_STATUS.PERMISSION_DENIED,
    };
  }
  try {
    const body = await graphGet({
      accessToken,
      credentialId,
      workspaceId,
      path: "me/accounts",
      query: {
        fields: "id,name,instagram_business_account{id,username}",
      },
    });
    const rows = Array.isArray(body?.data) ? body.data : [];
    for (const row of rows) {
      const ig = row?.instagram_business_account;
      if (ig?.id) {
        pushUniqueAccount(found, {
          id: ig.id,
          username: ig.username,
          source: "page_linked",
        });
      }
    }
    logger({
      event: "instagram_discovery_pages",
      count: found.size,
      status: found.size ? EDGE_STATUS.SUCCESS : EDGE_STATUS.EMPTY,
    });
    return {
      accounts: [...found.values()],
      count: found.size,
      status: found.size ? EDGE_STATUS.SUCCESS : EDGE_STATUS.EMPTY,
    };
  } catch (err) {
    const classified = classifyGraphFailure(err);
    logger({
      event: "instagram_discovery_pages",
      count: null,
      status: classified.status,
      graphErrorCode: classified.graphErrorCode,
    });
    return {
      accounts: [],
      count: null,
      status: classified.status,
      graphErrorCode: classified.graphErrorCode,
    };
  }
};

/**
 * Resolve pending Instagram Business Asset ids → ig_user_id, then verify IG User.
 */
const resolvePendingAssetsAndUsers = async ({
  transport,
  graphGet,
  presentInstagramAccount,
  assertProfessionalAccount,
  accessToken,
  credentialId,
  workspaceId,
  candidates,
  logger,
}) => {
  const resolvedCandidates = [];
  let businessAssetsResolved = 0;
  let igUsersResolved = 0;

  for (const candidate of candidates) {
    let next = { ...candidate };
    if (candidate.needsAssetResolve || candidate.source?.includes(":asset")) {
      try {
        const res = await rawGraphGet({
          transport,
          accessToken,
          path: candidate.assetId || candidate.id,
          query: { fields: "id,ig_user_id,ig_username" },
        });
        if (res.ok && res.body?.ig_user_id) {
          businessAssetsResolved += 1;
          next = {
            id: String(res.body.ig_user_id),
            username: String(res.body.ig_username || candidate.username || "").trim(),
            source: candidate.source,
            assetId: String(res.body.id || candidate.assetId || ""),
          };
        }
      } catch {
        // keep candidate
      }
    } else if (candidate.assetId) {
      businessAssetsResolved += 1;
    }
    resolvedCandidates.push(next);
  }

  const readable = [];
  for (const candidate of resolvedCandidates) {
    const id = String(candidate?.id || "").trim();
    if (!id) continue;
    try {
      const body = await graphGet({
        accessToken,
        credentialId,
        workspaceId,
        path: id,
        query: {
          fields:
            "id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website,ig_id",
        },
      });
      const profile = presentInstagramAccount({
        id: body?.id || id,
        username: body?.username || candidate.username,
        name: body?.name,
        profile_picture_url: body?.profile_picture_url,
        followers_count: body?.followers_count,
        follows_count: body?.follows_count,
        media_count: body?.media_count,
        // Unified Login IGUser may omit account_type; treat as professional.
        account_type: body?.account_type || "BUSINESS",
      });
      if (profile.id && profile.username) {
        igUsersResolved += 1;
        readable.push({
          ...profile,
          source: candidate.source,
          assetId: candidate.assetId,
          assetReadable: Boolean(candidate.assetId),
          igUserReadable: true,
        });
      }
    } catch (err) {
      logger({
        event: "instagram_discovery_verify_skip",
        code: String(err?.code || "INSTAGRAM_GRAPH_ERROR"),
        assetReadable: Boolean(candidate.assetId || candidate.username),
        igUserReadable: false,
      });
      // Asset known with username but IG User GET failed — keep minimal only if username known.
      if (candidate.username) {
        try {
          const minimal = presentInstagramAccount({
            id,
            username: candidate.username,
            account_type: "BUSINESS",
          });
          assertProfessionalAccount(minimal);
          readable.push({
            ...minimal,
            source: candidate.source,
            assetId: candidate.assetId,
            assetReadable: true,
            igUserReadable: false,
          });
        } catch {
          // skip
        }
      }
    }
  }

  return { readable, businessAssetsResolved, igUsersResolved };
};

const emitTrace = (trace) => {
  console.error("[instagram-oauth]", JSON.stringify(trace));
};

/**
 * Full Unified Login discovery with safe stage trace.
 * Order (after live Meta business-asset proof):
 *   1) granular Instagram asset/user targets
 *   2) owned_instagram_assets / client_instagram_assets
 *   3) assigned_instagram_accounts
 *   4) page-linked fallback
 */
const discoverUnifiedInstagramAccount = async ({
  accessToken,
  credentialId,
  workspaceId,
  preferredInstagramUserId,
  graphGet,
  transport,
  logger,
  presentInstagramAccount,
  assertProfessionalAccount,
  igError,
}) => {
  const log = typeof logger === "function" ? logger : () => {};
  const debugInfo = await inspectAccessTokenDebug({
    accessToken,
    transport,
    logger: log,
  });
  assertRequiredUnifiedPermissions(debugInfo, igError);

  const merged = new Map();

  // 1) Granular targets first (may include the exact shared Instagram Business Asset)
  const granular = await resolveGranularTargetCandidates({
    debugInfo,
    transport,
    accessToken,
    logger: log,
  });
  for (const row of granular.accounts) pushUniqueAccount(merged, row);

  // Attach target IDs onto category rows for business collection
  const granularCategoriesWithIds = [];
  let targetIdx = 0;
  for (const entry of debugInfo.granularScopes || []) {
    for (const targetId of entry.targetIds || []) {
      const cat = granular.categories[targetIdx] || { category: "unknown" };
      granularCategoriesWithIds.push({
        ...cat,
        targetId,
        permission: entry.scope,
      });
      targetIdx += 1;
    }
  }

  const businessCandidates = await collectBusinessIds({
    graphGet,
    transport,
    accessToken,
    credentialId,
    workspaceId,
    granularCategories: granularCategoriesWithIds,
    logger: log,
  });

  // 2) Business portfolio Instagram asset edges
  const business = await collectFromBusinessEdges({
    transport,
    accessToken,
    businessCandidates,
    logger: log,
  });
  for (const row of business.accounts) pushUniqueAccount(merged, row);

  // 3) assigned_instagram_accounts
  const assigned = await collectAssignedInstagramAccounts({
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    logger: log,
  });
  for (const row of assigned.accounts) pushUniqueAccount(merged, row);

  // 4) Page-linked fallback
  const pages = await collectFromPages({
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    hasPagesReadEngagement: debugInfo.hasPagesReadEngagement,
    logger: log,
  });
  for (const row of pages.accounts) pushUniqueAccount(merged, row);

  const candidates = [...merged.values()];
  const preferred = String(preferredInstagramUserId || "").trim();
  const ordered = preferred
    ? [
        ...candidates.filter((a) => a.id === preferred),
        ...candidates.filter((a) => a.id !== preferred),
      ]
    : candidates;

  const { readable, businessAssetsResolved, igUsersResolved } =
    await resolvePendingAssetsAndUsers({
      transport,
      graphGet,
      presentInstagramAccount,
      assertProfessionalAccount,
      accessToken,
      credentialId,
      workspaceId,
      candidates: ordered,
      logger: log,
    });

  const ownedSuccessCount = business.perBusiness.reduce(
    (n, b) =>
      n +
      (b.owned_instagram_assets?.status === EDGE_STATUS.SUCCESS
        ? b.owned_instagram_assets.count || 0
        : 0),
    0
  );
  const clientSuccessCount = business.perBusiness.reduce(
    (n, b) =>
      n +
      (b.client_instagram_assets?.status === EDGE_STATUS.SUCCESS
        ? b.client_instagram_assets.count || 0
        : 0),
    0
  );
  const anyBusinessEdgeError = business.perBusiness.some(
    (b) =>
      (b.owned_instagram_assets?.status &&
        b.owned_instagram_assets.status !== EDGE_STATUS.EMPTY &&
        b.owned_instagram_assets.status !== EDGE_STATUS.SUCCESS) ||
      (b.client_instagram_assets?.status &&
        b.client_instagram_assets.status !== EDGE_STATUS.EMPTY &&
        b.client_instagram_assets.status !== EDGE_STATUS.SUCCESS)
  );
  const allBusinessEdgesPermissionDenied =
    businessCandidates.length > 0 &&
    business.perBusiness.every((b) => {
      const owned = b.owned_instagram_assets?.status;
      const client = b.client_instagram_assets?.status;
      return (
        owned === EDGE_STATUS.PERMISSION_DENIED &&
        client === EDGE_STATUS.PERMISSION_DENIED
      );
    });

  const trace = {
    event: "instagram_discovery_trace",
    oauth_stage: "instagram_discovery",
    token_valid: Boolean(debugInfo.isValid),
    app_id_matches: Boolean(debugInfo.appIdMatchesExpected),
    token_type: debugInfo.tokenType || undefined,
    token_has_instagram_basic: Boolean(debugInfo.hasInstagramBasic),
    token_has_pages_read_engagement: Boolean(debugInfo.hasPagesReadEngagement),
    token_has_business_management: Boolean(debugInfo.hasBusinessManagement),
    token_has_ads_read: Boolean(debugInfo.hasAdsRead),
    token_has_ads_management: Boolean(debugInfo.hasAdsManagement),
    granular_scope_names: debugInfo.granularScopeNames || [],
    granular_target_ids_count: debugInfo.granularTargetIdsCount || 0,
    instagram_asset_targets: granular.instagramAssetTargets || 0,
    granular_target_types: (granularCategoriesWithIds || []).map((c) => ({
      permission: c.permission,
      category: c.category,
    })),
    candidate_business_ids: businessCandidates.length,
    businesses: business.perBusiness.map((b) => ({
      source: b.source,
      id: b.id,
      // names are non-secret portfolio labels when Graph returns them
      businessName: b.businessName,
      owned_instagram_assets: {
        status:
          b.owned_instagram_assets?.status === EDGE_STATUS.SUCCESS
            ? "success"
            : b.owned_instagram_assets?.status === EDGE_STATUS.EMPTY
              ? "empty"
              : "error",
        edgeStatus: b.owned_instagram_assets?.status,
        count: b.owned_instagram_assets?.count,
        graph_error_code: b.owned_instagram_assets?.graph_error_code,
        graph_error_subcode: b.owned_instagram_assets?.graph_error_subcode,
        assets: b.owned_instagram_assets?.assets || [],
      },
      client_instagram_assets: {
        status:
          b.client_instagram_assets?.status === EDGE_STATUS.SUCCESS
            ? "success"
            : b.client_instagram_assets?.status === EDGE_STATUS.EMPTY
              ? "empty"
              : "error",
        edgeStatus: b.client_instagram_assets?.status,
        count: b.client_instagram_assets?.count,
        graph_error_code: b.client_instagram_assets?.graph_error_code,
        graph_error_subcode: b.client_instagram_assets?.graph_error_subcode,
        assets: b.client_instagram_assets?.assets || [],
      },
    })),
    assigned_instagram_accounts_count:
      assigned.count == null ? null : assigned.count,
    assigned_status: assigned.status,
    owned_instagram_assets_count: ownedSuccessCount,
    client_instagram_assets_count: clientSuccessCount,
    page_linked_instagram_count: pages.count,
    page_linked_status: pages.status,
    deduplicated_instagram_accounts: candidates.length,
    instagram_business_assets_resolved: businessAssetsResolved,
    instagram_users_resolved: igUsersResolved,
  };

  if (readable.length === 0) {
    emitTrace({
      ...trace,
      credential_persist: "NOT_REACHED",
    });
    log(trace);

    if (allBusinessEdgesPermissionDenied && !debugInfo.hasBusinessManagement) {
      throw igError(
        "business_management is required to list Instagram assets on the selected Business Portfolio.",
        "INSTAGRAM_REQUIRED_PERMISSION_MISSING",
        403
      );
    }
    if (businessCandidates.length === 0) {
      throw igError(
        "Instagram business context was not found for this login.",
        "INSTAGRAM_BUSINESS_CONTEXT_NOT_FOUND",
        403
      );
    }
    if (candidates.length > 0) {
      throw igError(
        "Instagram assets were shared, but none could be resolved for API access.",
        "INSTAGRAM_SELECTED_ASSET_NOT_RESOLVABLE",
        403
      );
    }
    if (anyBusinessEdgeError) {
      throw igError(
        "Instagram authorization succeeded, but Business Portfolio Instagram asset lookup failed.",
        "INSTAGRAM_SELECTED_ASSET_NOT_RESOLVABLE",
        403
      );
    }
    throw igError(
      "Instagram authorization succeeded, but no accessible Instagram account was found.",
      "INSTAGRAM_NO_ACCESSIBLE_ACCOUNT",
      403
    );
  }

  const profile =
    (preferred && readable.find((a) => a.id === preferred)) || readable[0];
  assertProfessionalAccount(profile);

  const finalTrace = {
    ...trace,
    discoverySource: String(profile.source || "").slice(0, 80) || undefined,
    readableCount: readable.length,
    resolved_ig_user_id: profile.id,
    resolved_ig_username: profile.username,
  };
  emitTrace(finalTrace);
  log(finalTrace);

  return {
    ...profile,
    clientBusinessId: businessCandidates[0]?.businessId || undefined,
    discoveryTrace: finalTrace,
    discoverySource: profile.source,
  };
};

module.exports = {
  EDGE_STATUS,
  inspectAccessTokenDebug,
  assertRequiredUnifiedPermissions,
  discoverUnifiedInstagramAccount,
  normalizeAssetRow,
  pushUniqueAccount,
  classifyGraphFailure,
  collectFromBusinessEdges,
  collectBusinessIds,
  resolveGranularTargetCandidates,
};
