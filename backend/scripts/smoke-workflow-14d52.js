/**
 * Part 14D.5.2 — focused regression for editor displayOptions vs schema defaults.
 */
const fs = require("fs");
const path = require("path");

const valuesWithParamDefaults = (params, values) => {
  const next = { ...values };
  for (const param of params) {
    if (
      param.default !== undefined &&
      !Object.prototype.hasOwnProperty.call(values, param.name)
    ) {
      next[param.name] = param.default;
    }
  }
  return next;
};

const conditionMatches = (fieldValue, allowed) => {
  const normalized =
    typeof fieldValue === "boolean" || typeof fieldValue === "number"
      ? fieldValue
      : fieldValue == null
        ? ""
        : String(fieldValue);
  return allowed.some((a) => String(a) === String(normalized));
};

const isParamVisible = (param, values) => {
  const { show, hide } = param.displayOptions || {};
  if (show) {
    for (const [key, allowed] of Object.entries(show)) {
      if (!allowed?.length) continue;
      if (!conditionMatches(values[key], allowed)) return false;
    }
  }
  if (hide) {
    for (const [key, blocked] of Object.entries(hide)) {
      if (!blocked?.length) continue;
      if (conditionMatches(values[key], blocked)) return false;
    }
  }
  return true;
};

const getVisibleParams = (params, values) => {
  const resolved = valuesWithParamDefaults(params, values);
  return params.filter((p) => p.type !== "hidden" && isParamVisible(p, resolved));
};

const registerPart14D52Tests = ({ check, section, assert }) => {
  const assertX = assert;
  const displaySrc = fs.readFileSync(
    path.join(__dirname, "../../frontend/src/modules/workflows/paramDisplayOptions.ts"),
    "utf8"
  );

  section("14D.5.2 displayOptions honor schema defaults");

  check("DISPLAY-DEFAULT-1 frontend visibility merges schema defaults", () => {
    assertX.match(displaySrc, /export function valuesWithParamDefaults/);
    assertX.match(
      displaySrc,
      /getVisibleParams\([\s\S]*valuesWithParamDefaults\(params, values\)/
    );
  });

  check("DISPLAY-DEFAULT-2 Sheets Range visible when operation is unset", () => {
    const params = [
      { name: "operation", type: "options", default: "readRows" },
      {
        name: "range",
        type: "string",
        displayOptions: {
          show: { operation: ["readRows", "appendRows", "updateRows", "clearRange"] },
        },
      },
      {
        name: "title",
        type: "string",
        displayOptions: { show: { operation: ["createSpreadsheet"] } },
      },
    ];
    const names = getVisibleParams(params, {}).map((p) => p.name);
    assertX.equal(names.includes("range"), true);
    assertX.equal(names.includes("title"), false);
  });

  check("DISPLAY-DEFAULT-3 Gmail Send fields visible on Message/Send defaults", () => {
    const params = [
      { name: "resource", type: "options", default: "message" },
      { name: "operation", type: "options", default: "send" },
      {
        name: "to",
        type: "string",
        displayOptions: {
          show: { resource: ["message", "draft"], operation: ["send", "reply", "create"] },
        },
      },
      {
        name: "labelIds",
        type: "string",
        displayOptions: {
          show: { resource: ["message", "thread"], operation: ["addLabels"] },
        },
      },
    ];
    const names = getVisibleParams(params, {}).map((p) => p.name);
    assertX.equal(names.includes("to"), true);
    assertX.equal(names.includes("labelIds"), false);
  });

  check("DISPLAY-DEFAULT-4 explicit operation still wins over default", () => {
    const params = [
      { name: "resource", type: "options", default: "message" },
      { name: "operation", type: "options", default: "send" },
      {
        name: "to",
        type: "string",
        displayOptions: {
          show: { resource: ["message"], operation: ["send"] },
        },
      },
      {
        name: "labelIds",
        type: "string",
        displayOptions: {
          show: { resource: ["message"], operation: ["addLabels"] },
        },
      },
    ];
    const names = getVisibleParams(params, { operation: "addLabels" }).map(
      (p) => p.name
    );
    assertX.equal(names.includes("to"), false);
    assertX.equal(names.includes("labelIds"), true);
  });

  check("GOOGLE-AUTH-COPY-1 Google nodes label the account, not Credential", () => {
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assertX.match(
      schema,
      /googleSearchConsole: \[[\s\S]*displayName: "Google Search Console Account"/
    );
    assertX.match(
      schema,
      /googleAnalytics: \[[\s\S]*displayName: "Google Analytics Account"/
    );
    assertX.match(schema, /gmail: \[[\s\S]*displayName: "Gmail Account"/);
    assertX.match(
      schema,
      /gmailTrigger: \[[\s\S]*displayName: "Gmail Account"/
    );
    assertX.match(
      schema,
      /googleSheets: \[[\s\S]*displayName: "Google Sheets Account"/
    );
    const googleBlock = schema.slice(schema.indexOf("googleSearchConsole:"));
    const beforeAi = googleBlock.split("aiGenerate:")[0] || googleBlock;
    assertX.equal(/displayName: "Credential"/.test(beforeAi), false);
  });

  check("GOOGLE-AUTH-COPY-2 picker uses Google Account language", () => {
    const picker = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/CredentialPicker.tsx"
      ),
      "utf8"
    );
    const types = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/types.ts"),
      "utf8"
    );
    assertX.match(types, /connectAction: "Connect Google Analytics"/);
    assertX.match(types, /connectAction: "Connect Google Search Console"/);
    assertX.match(types, /connectAction: "Connect Gmail"/);
    assertX.match(types, /connectAction: "Connect Google Sheets"/);
    assertX.match(picker, /connectAction/);
    assertX.match(picker, /CREDENTIAL_TYPE_FIELDS/);
    assertX.match(picker, /Select connected account/);
    assertX.equal(/Add credential/.test(picker), false);
    assertX.equal(/No authentication/.test(picker), false);
    assertX.equal(/access or refresh tokens/.test(picker), false);
    assertX.equal(/OAuth Client ID/.test(picker), false);
    assertX.equal(/OAuth Redirect URL/.test(picker), false);
    assertX.match(picker, /Add API key/);
    assertX.match(picker, /Add connection/);
  });

  check("GOOGLE-AUTH-COPY-3 locator missing-account copy", () => {
    const locator = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/ResourceLocatorField.tsx"
      ),
      "utf8"
    );
    assertX.match(locator, /Connect a Google account to load resources/);
    assertX.equal(
      /Select a credential to load resources/.test(locator),
      false
    );
  });
};

module.exports = { registerPart14D52Tests };
