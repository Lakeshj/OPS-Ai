/**
 * Part 14D.5.5A.1 — GSC canonical property discovery / picker matching.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D55A1Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.5A.1 GSC property discovery / picker");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");
  const locator = () => require("../services/resourceLocator");
  const resources = () => require("../services/workflowGoogleResources.service");
  const oauth = () => require("../services/googleOAuth.service");

  const picker = () =>
    readFe("components/workflows/params/ResourceLocatorField.tsx");
  const feLocator = () => readFe("modules/workflows/resourceLocator.ts");

  check("GSCPICKER-1 sites.list response preserves sc-domain identifier", async () => {
    const store = new Map();
    store.set("c1", {
      id: "c1",
      type: "google_gsc",
      workspaceId: "ws-1",
      secret: {
        accessToken: "t",
        refreshToken: "r",
        expiryMs: Date.now() + 3600_000,
        oauthAppMode: "CUSTOM_APP",
        clientId: "cid",
        clientSecret: "sec",
      },
      config: { oauthAppMode: "CUSTOM_APP" },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({
          status: 200,
          ok: true,
          body: {
            siteEntry: [
              {
                siteUrl: "sc-domain:govisible.ai",
                permissionLevel: "siteFullUser",
              },
            ],
          },
        }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const res = await resources().listGscSitesForCredential({
          credentialId: "c1",
          workspaceId: "ws-1",
        });
        assertX.equal(res.sites[0].siteUrl, "sc-domain:govisible.ai");
        assertX.equal(res.sites[0].kind, "domain");
        assertX.ok(res.sites[0].label.includes("Domain ·"));
        assertX.ok(res.sites[0].label.includes("govisible.ai"));
        assertX.ok(!res.sites[0].label.includes("sc-domain:"));
      }
    );
  });

  check("GSCPICKER-2 URL-prefix identifier preserved exactly", async () => {
    const store = new Map();
    store.set("c1", {
      id: "c1",
      type: "google_gsc",
      workspaceId: "ws-1",
      secret: {
        accessToken: "t",
        refreshToken: "r",
        expiryMs: Date.now() + 3600_000,
        oauthAppMode: "CUSTOM_APP",
        clientId: "cid",
        clientSecret: "sec",
      },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({
          status: 200,
          ok: true,
          body: {
            siteEntry: [
              {
                siteUrl: "https://www.govisible.ai/",
                permissionLevel: "siteRestrictedUser",
              },
            ],
          },
        }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const res = await resources().listGscSitesForCredential({
          credentialId: "c1",
          workspaceId: "ws-1",
        });
        assertX.equal(res.sites[0].siteUrl, "https://www.govisible.ai/");
        assertX.equal(res.sites[0].kind, "urlPrefix");
        assertX.equal(res.sites[0].permissionLevel, "siteRestrictedUser");
      }
    );
  });

  check("GSCPICKER-3 search query does not mutate siteUrl", () => {
    assertX.ok(picker().includes("searchQuery"));
    assertX.ok(picker().includes("setSearchQuery"));
    assertX.ok(picker().includes("Search filter only"));
    // Search onChange only updates searchQuery — never patchValue
    assertX.ok(
      /onChange=\{\(e\) => setSearchQuery\(e\.target\.value\)\}/.test(picker())
    );
    assertX.ok(!/setSearchQuery[\s\S]{0,40}patchValue/.test(picker()));
  });

  check("GSCPICKER-4 selected resource compares by canonical value", () => {
    const opts = [
      {
        id: "sc-domain:govisible.ai",
        label: "Domain · govisible.ai",
      },
    ];
    assertX.equal(
      locator().staleResourceState("sc-domain:govisible.ai", opts).stale,
      false
    );
    assertX.equal(
      locator().staleResourceState("Domain · govisible.ai", opts).stale,
      true
    );
    assertX.ok(feLocator().includes("Compare canonical provider values"));
  });

  check("GSCPICKER-5 saved canonical property found → no warning", () => {
    const opts = [
      { id: "sc-domain:govisible.ai", label: "Domain · govisible.ai" },
      { id: "https://govisible.ai/", label: "URL prefix · https://govisible.ai/" },
    ];
    assertX.equal(
      locator().staleResourceState("sc-domain:govisible.ai", opts).stale,
      false
    );
    assertX.equal(
      locator().staleResourceState("https://govisible.ai/", opts).stale,
      false
    );
  });

  check("GSCPICKER-6 saved property missing → contextual unavailable warning", () => {
    const opts = [
      { id: "sc-domain:other.com", label: "Domain · other.com" },
    ];
    assertX.equal(
      locator().staleResourceState("sc-domain:govisible.ai", opts).stale,
      true
    );
    assertX.ok(
      picker().includes(
        "The selected Search Console property isn't available to this account"
      )
    );
    assertX.ok(!picker().includes("This account cannot list that resource"));
  });

  check("GSCPICKER-7 provider list failure → load failure message, not resource mismatch", () => {
    assertX.ok(
      picker().includes("Couldn't load Search Console properties. Retry.")
    );
    assertX.equal(
      locator().classifyResourceLoadError({
        code: "GOOGLE_FORBIDDEN",
        status: 403,
      }),
      "permission_denied"
    );
    // mismatch copy is separate from load failure
    assertX.ok(picker().includes("resourceMismatchMessage"));
  });

  check("GSCPICKER-8 credential switch reloads resources", () => {
    assertX.ok(picker().includes("[credentialId, kind]"));
    assertX.ok(picker().includes("setSearchQuery(\"\")"));
    assertX.ok(/useEffect\(\(\) => \{\s*if \(currentMode === "account"\) void load\(\);/.test(picker()));
  });

  check("GSCPICKER-9 refresh retains valid selected resource", () => {
    // Refresh calls load() only — does not clear scalar / siteUrl
    assertX.ok(/onClick=\{\(\) => void load\(\)\}/.test(picker()));
    assertX.ok(!/onClick=\{\(\) => \{\s*patchValue\(""/.test(picker()));
  });

  check("GSCPICKER-10 bare legacy domain is not silently rewritten ambiguously", () => {
    const opts = [
      { id: "sc-domain:govisible.ai", label: "Domain · govisible.ai" },
      { id: "https://www.govisible.ai/", label: "URL prefix · https://www.govisible.ai/" },
    ];
    const found = locator().findLegacyGscPropertyMatches("govisible.ai", opts);
    assertX.equal(found.legacyBare, true);
    assertX.equal(found.ambiguous, true);
    assertX.equal(found.matches.length, 2);
    // Helper never returns a rewritten siteUrl — only suggestions
    assertX.ok(picker().includes("findLegacyGscPropertyMatches"));
    assertX.ok(picker().includes("not a canonical Search Console property ID"));
  });

  check("GSCPICKER-11 friendly label differs safely from canonical value", () => {
    const cls = locator().classifyGscProperty("sc-domain:govisible.ai");
    assertX.equal(cls.id, "sc-domain:govisible.ai");
    assertX.equal(cls.label, "Domain · govisible.ai");
    assertX.notEqual(cls.label, cls.id);
    const url = locator().classifyGscProperty("https://www.example.com/");
    assertX.equal(url.id, "https://www.example.com/");
    assertX.equal(url.label, "URL prefix · https://www.example.com/");
  });

  check("GSCPICKER-12 permissionLevel may be displayed but does not affect canonical ID", async () => {
    const store = new Map();
    store.set("c1", {
      id: "c1",
      type: "google_gsc",
      workspaceId: "ws-1",
      secret: {
        accessToken: "t",
        refreshToken: "r",
        expiryMs: Date.now() + 3600_000,
        oauthAppMode: "CUSTOM_APP",
        clientId: "cid",
        clientSecret: "sec",
      },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({
          status: 200,
          ok: true,
          body: {
            siteEntry: [
              {
                siteUrl: "sc-domain:govisible.ai",
                permissionLevel: "siteFullUser",
              },
            ],
          },
        }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const res = await resources().listGscSitesForCredential({
          credentialId: "c1",
          workspaceId: "ws-1",
        });
        assertX.equal(res.sites[0].siteUrl, "sc-domain:govisible.ai");
        assertX.equal(res.sites[0].permissionLevel, "siteFullUser");
      }
    );
    assertX.ok(picker().includes("permissionLevel"));
  });
};

module.exports = { registerPart14D55A1Tests };
