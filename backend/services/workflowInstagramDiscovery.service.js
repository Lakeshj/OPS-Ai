/**
 * Unified Login Instagram asset discovery (graph.facebook.com).
 * Separate from Meta Ads Graph client.
 *
 * Primary documented business edges:
 *   /{business-id}/owned_instagram_assets  (ig_user_id, ig_username)
 *   /{business-id}/client_instagram_assets
 * Plus assigned_instagram_accounts, debug_token targets, page-linked fallback.
 */

const {
  SCOPE_BASIC,
  SCOPE_PAGES_READ,
  ACCESS_DEPENDENCY_PERMISSIONS,
  normalizeGrantedScope,
  graphBaseUrl,
  appCredentials,
} = require("../config/instagramGraph");

const pushUniqueAccount = (map, row) => {
  const id = String(row?.id || row?.ig_user_id || "").trim();
  if (!id) return;
  const prev = map.get(id) || { id, username: "", source: "" };
  const username = String(
    row?.username || row?.ig_username || prev.username || ""
  ).trim();
  const source = String(row?.source || prev.source || "").slice(0, 60);
  map.set(id, { id, username, source });
};

const normalizeAssetRow = (row, source) => {
  const igUserId = String(row?.ig_user_id || row?.id || "").trim();
  const username = String(row?.ig_username || row?.username || "").trim();
  if (!igUserId) return null;
  return { id: igUserId, username, source };
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
    appIdMatchesExpected: false,
    isValid: false,
    tokenType: "",
    hasInstagramBasic: false,
    hasPagesReadEngagement: false,
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
  const tokenAppId = String(data.app_id || "").trim();
  const result = {
    ok: true,
    scopes,
    granularScopes,
    granularTargetIdsCount,
    appIdMatchesExpected: Boolean(tokenAppId && tokenAppId === app.appId),
    isValid: data.is_valid !== false,
    tokenType: String(data.type || data.token_type || "").slice(0, 40),
    hasInstagramBasic: scopes.includes(SCOPE_BASIC),
    hasPagesReadEngagement: scopes.includes(SCOPE_PAGES_READ),
    hasAdsReadOrManagement: ACCESS_DEPENDENCY_PERMISSIONS.some((p) =>
      scopes.includes(p)
    ),
  };
  logger({
    event: "instagram_discovery_debug_token",
    ok: true,
    scopeCount: scopes.length,
    granularTargetIdsCount,
    tokenType: result.tokenType || undefined,
    appIdMatchesExpected: result.appIdMatchesExpected,
    isValid: result.isValid,
    hasInstagramBasic: result.hasInstagramBasic,
    hasPagesReadEngagement: result.hasPagesReadEngagement,
    hasAdsReadOrManagement: result.hasAdsReadOrManagement,
  });
  return result;
};

const assertRequiredUnifiedPermissions = (debugInfo, igError) => {
  if (!debugInfo?.ok) return;
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
  let lastErrorCode = "";
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
        pushUniqueAccount(found, { ...row, source: "assigned_instagram_accounts" });
      }
      const next = String(pageBody?.paging?.cursors?.after || "").trim();
      if (!rows.length || !next || next === after || seenCursors.has(next)) break;
      seenCursors.add(next);
      after = next;
    }
  } catch (err) {
    lastErrorCode = String(err?.code || "INSTAGRAM_GRAPH_ERROR");
  }
  logger({
    event: "instagram_discovery_assigned",
    count: found.size,
    errorCode: lastErrorCode || undefined,
  });
  return { accounts: [...found.values()], count: found.size };
};

const resolveGranularTargetCandidates = async ({
  debugInfo,
  graphGet,
  accessToken,
  credentialId,
  workspaceId,
  logger,
}) => {
  const found = new Map();
  const categories = [];
  for (const entry of debugInfo.granularScopes || []) {
    const scope = String(entry.scope || "");
    for (const targetId of entry.targetIds || []) {
      let category = "unknown";
      let account = null;
      try {
        // Instagram Business Asset shape
        const asset = await graphGet({
          accessToken,
          credentialId,
          workspaceId,
          path: targetId,
          query: { fields: "id,ig_user_id,ig_username" },
        });
        if (asset?.ig_user_id) {
          category = "instagram_business_asset";
          account = normalizeAssetRow(asset, `granular:${scope}`);
        }
      } catch {
        // try IG user profile
      }
      if (!account) {
        try {
          const ig = await graphGet({
            accessToken,
            credentialId,
            workspaceId,
            path: targetId,
            query: { fields: "id,username,account_type" },
          });
          if (ig?.username || ig?.id) {
            category = "instagram_user";
            account = {
              id: String(ig.id || targetId),
              username: String(ig.username || "").trim(),
              source: `granular:${scope}`,
            };
          }
        } catch {
          category = "unresolved";
        }
      }
      categories.push({ permission: scope, targetIdCount: 1, category });
      if (account) pushUniqueAccount(found, account);
    }
  }
  logger({
    event: "instagram_discovery_granular_targets",
    count: found.size,
    categoryCount: categories.length,
  });
  return { accounts: [...found.values()], categories, count: found.size };
};

const collectBusinessIds = async ({
  graphGet,
  accessToken,
  credentialId,
  workspaceId,
  logger,
}) => {
  const ids = new Set();
  try {
    const me = await graphGet({
      accessToken,
      credentialId,
      workspaceId,
      path: "me",
      query: { fields: "id,client_business_id" },
    });
    const clientBiz = String(me?.client_business_id || "").trim();
    if (clientBiz) ids.add(clientBiz);
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
      const id = String(row?.id || "").trim();
      if (id) ids.add(id);
    }
  } catch {
    // optional
  }
  const list = [...ids];
  logger({
    event: "instagram_discovery_business_ids",
    count: list.length,
  });
  return list;
};

const collectFromBusinessEdges = async ({
  graphGet,
  accessToken,
  credentialId,
  workspaceId,
  businessIds,
  logger,
}) => {
  const found = new Map();
  const counts = {
    owned_instagram_assets: 0,
    client_instagram_assets: 0,
    instagram_business_accounts: 0,
  };
  const edges = [
    {
      name: "owned_instagram_assets",
      fields: "id,ig_user_id,ig_username",
    },
    {
      name: "client_instagram_assets",
      fields: "id,ig_user_id,ig_username",
    },
    {
      name: "instagram_business_accounts",
      fields: "id,username",
    },
  ];
  for (const biz of businessIds) {
    for (const edge of edges) {
      try {
        const body = await graphGet({
          accessToken,
          credentialId,
          workspaceId,
          path: `${biz}/${edge.name}`,
          query: { fields: edge.fields },
        });
        const rows = Array.isArray(body?.data) ? body.data : [];
        counts[edge.name] += rows.length;
        for (const row of rows) {
          const normalized =
            edge.name === "instagram_business_accounts"
              ? {
                  id: String(row?.id || "").trim(),
                  username: String(row?.username || "").trim(),
                  source: edge.name,
                }
              : normalizeAssetRow(row, edge.name);
          if (normalized?.id) pushUniqueAccount(found, normalized);
        }
        logger({
          event: "instagram_discovery_business_edge",
          edge: edge.name,
          count: rows.length,
        });
      } catch (err) {
        logger({
          event: "instagram_discovery_business_edge",
          edge: edge.name,
          count: 0,
          code: String(err?.code || "INSTAGRAM_GRAPH_ERROR"),
        });
      }
    }
  }
  return { accounts: [...found.values()], counts, count: found.size };
};

const collectFromPages = async ({
  graphGet,
  accessToken,
  credentialId,
  workspaceId,
  hasPagesReadEngagement,
  logger,
  igError,
}) => {
  const found = new Map();
  if (!hasPagesReadEngagement) {
    logger({
      event: "instagram_discovery_pages",
      count: 0,
      skipped: "pages_read_engagement_missing",
    });
    return { accounts: [], count: 0, skippedMissingPermission: true };
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
      if (ig) {
        pushUniqueAccount(found, {
          id: ig.id,
          username: ig.username,
          source: "page_linked",
        });
      }
    }
    logger({ event: "instagram_discovery_pages", count: found.size });
  } catch (err) {
    const code = String(err?.code || "");
    if (
      code === "INSTAGRAM_PERMISSION_DENIED" ||
      /permission/i.test(String(err?.message || ""))
    ) {
      throw igError(
        "pages_read_engagement is required to resolve Instagram accounts linked to Pages.",
        "INSTAGRAM_PERMISSION_PAGES_READ_ENGAGEMENT_REQUIRED",
        403
      );
    }
    logger({
      event: "instagram_discovery_pages",
      count: 0,
      code: code || "INSTAGRAM_GRAPH_ERROR",
    });
  }
  return { accounts: [...found.values()], count: found.size };
};

const verifyReadableInstagramAccounts = async ({
  graphGet,
  presentInstagramAccount,
  assertProfessionalAccount,
  accessToken,
  credentialId,
  workspaceId,
  candidates,
  logger,
}) => {
  const readable = [];
  for (const candidate of candidates) {
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
            "id,username,name,profile_picture_url,followers_count,media_count,account_type",
        },
      });
      const profile = presentInstagramAccount({
        id: body?.id || id,
        username: body?.username || candidate.username,
        name: body?.name,
        profile_picture_url: body?.profile_picture_url,
        followers_count: body?.followers_count,
        media_count: body?.media_count,
        account_type: body?.account_type || "BUSINESS",
      });
      if (profile.id && profile.username) {
        readable.push({ ...profile, source: candidate.source });
      }
    } catch (err) {
      logger({
        event: "instagram_discovery_verify_skip",
        code: String(err?.code || "INSTAGRAM_GRAPH_ERROR"),
      });
      if (candidate.username) {
        try {
          const minimal = presentInstagramAccount({
            id,
            username: candidate.username,
            account_type: "BUSINESS",
          });
          assertProfessionalAccount(minimal);
          readable.push({ ...minimal, source: candidate.source });
        } catch {
          // skip
        }
      }
    }
  }
  return readable;
};

/**
 * Full Unified Login discovery with safe stage trace.
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
  const assigned = await collectAssignedInstagramAccounts({
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    logger: log,
  });
  for (const row of assigned.accounts) pushUniqueAccount(merged, row);

  const granular = await resolveGranularTargetCandidates({
    debugInfo,
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    logger: log,
  });
  for (const row of granular.accounts) pushUniqueAccount(merged, row);

  const businessIds = await collectBusinessIds({
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    logger: log,
  });
  const business = await collectFromBusinessEdges({
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    businessIds,
    logger: log,
  });
  for (const row of business.accounts) pushUniqueAccount(merged, row);

  const pages = await collectFromPages({
    graphGet,
    accessToken,
    credentialId,
    workspaceId,
    hasPagesReadEngagement: debugInfo.hasPagesReadEngagement,
    logger: log,
    igError,
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

  const trace = {
    event: "instagram_discovery_trace",
    token_has_instagram_basic: Boolean(debugInfo.hasInstagramBasic),
    token_has_pages_read_engagement: Boolean(debugInfo.hasPagesReadEngagement),
    token_has_ads_read_or_management: Boolean(debugInfo.hasAdsReadOrManagement),
    granular_target_ids_count: debugInfo.granularTargetIdsCount || 0,
    business_ids_considered: businessIds.length,
    assigned_instagram_accounts_count: assigned.count,
    owned_instagram_assets_count: business.counts.owned_instagram_assets || 0,
    client_instagram_assets_count: business.counts.client_instagram_assets || 0,
    instagram_business_accounts_count:
      business.counts.instagram_business_accounts || 0,
    page_linked_instagram_count: pages.count,
    deduplicated_instagram_accounts: candidates.length,
  };

  if (candidates.length === 0) {
    log({ ...trace, selected_account_username_match: false });
    if (businessIds.length === 0) {
      throw igError(
        "Instagram business context was not found for this login.",
        "INSTAGRAM_BUSINESS_CONTEXT_NOT_FOUND",
        403
      );
    }
    throw igError(
      "Instagram authorization succeeded, but no accessible Instagram account was found.",
      "INSTAGRAM_NO_ACCESSIBLE_ACCOUNT",
      403
    );
  }

  const readable = await verifyReadableInstagramAccounts({
    graphGet,
    presentInstagramAccount,
    assertProfessionalAccount,
    accessToken,
    credentialId,
    workspaceId,
    candidates: ordered,
    logger: log,
  });

  if (readable.length === 0) {
    log({ ...trace, selected_account_username_match: false });
    throw igError(
      "Instagram assets were shared, but none could be resolved for API access.",
      "INSTAGRAM_SELECTED_ASSET_NOT_RESOLVABLE",
      403
    );
  }

  const profile =
    (preferred && readable.find((a) => a.id === preferred)) || readable[0];
  assertProfessionalAccount(profile);
  log({
    ...trace,
    deduplicated_instagram_accounts: candidates.length,
    readableCount: readable.length,
    discoverySource: String(profile.source || "").slice(0, 60) || undefined,
    selected_account_username_match: undefined,
  });
  console.error(
    "[instagram-oauth]",
    JSON.stringify({
      ...trace,
      discoverySource: String(profile.source || "").slice(0, 60) || undefined,
      readableCount: readable.length,
    })
  );

  return {
    ...profile,
    clientBusinessId: businessIds[0] || undefined,
    discoveryTrace: trace,
    discoverySource: profile.source,
  };
};

module.exports = {
  inspectAccessTokenDebug,
  assertRequiredUnifiedPermissions,
  discoverUnifiedInstagramAccount,
  normalizeAssetRow,
  pushUniqueAccount,
};
