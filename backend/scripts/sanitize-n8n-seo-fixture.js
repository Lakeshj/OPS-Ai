/**
 * One-shot sanitizer: real n8n SEO export → golden fixture.
 * Usage: node scripts/sanitize-n8n-seo-fixture.js [sourcePath]
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_SRC = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  "Downloads",
  "SEO Report Data - 20 to 23 July - Final One.json"
);

const srcPath = process.argv[2] || DEFAULT_SRC;
const destPath = path.join(__dirname, "../fixtures/n8n/seo-report-real-world.json");

function walkSanitize(obj) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach(walkSanitize);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      let s = v;
      s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "imported-user@example.com");
      s = s.replace(/www\.evincera\.com/gi, "www.example.com");
      s = s.replace(/evincera\.com/gi, "example.com");
      s = s.replace(/p\d{6,}/g, "p000000000");
      s = s.replace(/properties\/\d+/g, "properties/000000000");
      obj[k] = s;
    } else if (v && typeof v === "object") {
      walkSanitize(v);
    }
  }
}

const raw = fs.readFileSync(srcPath, "utf8");
const w = JSON.parse(raw);
walkSanitize(w);

let credIdx = 0;
for (const node of w.nodes || []) {
  if (node.credentials && typeof node.credentials === "object") {
    for (const [ctype, cred] of Object.entries(node.credentials)) {
      if (cred && typeof cred === "object") {
        credIdx += 1;
        cred.id = `sanitized_cred_${credIdx}`;
        cred.name = `${ctype} (sanitized)`;
      }
    }
  }
  if ("webhookId" in node) delete node.webhookId;
}

const out = {
  name: w.name || "SEO Report Data - 20 to 23 July - Final One",
  nodes: w.nodes,
  connections: w.connections,
  // Intentionally active in source JSON so importer must ignore it.
  active: true,
  settings: w.settings || {},
  meta: { templateCredsSetupCompleted: false, sanitizedFixture: true },
  tags: [],
  id: "n8n-source-workflow-id-must-not-be-reused",
  versionId: "n8n-source-version-id-must-not-be-reused",
  instanceId: "n8n-source-instance-id-must-not-be-reused",
};

fs.mkdirSync(path.dirname(destPath), { recursive: true });
fs.writeFileSync(destPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      dest: destPath,
      nodes: out.nodes.length,
      bytes: fs.statSync(destPath).size,
      sourceName: out.name,
    },
    null,
    2
  )
);
