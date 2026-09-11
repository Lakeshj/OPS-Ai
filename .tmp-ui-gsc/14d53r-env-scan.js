/**
 * Scan env-like files for Google-related KEY NAMES only. Never print values.
 */
const fs = require("fs");
const path = require("path");

const roots = [
  path.join(__dirname, ".."),
  path.join(__dirname, "../backend"),
  path.join(__dirname, "../frontend"),
];
const names = [];
const walk = (dir, depth) => {
  if (depth > 2) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1);
    else if (/^\.env|env\.local|credentials/i.test(e.name)) names.push(full);
  }
};
for (const r of roots) walk(r, 0);

const interesting = /google|oauth|cors_origin/i;
for (const file of names) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const body = trimmed.replace(/^#\s*/, "");
    const eq = body.indexOf("=");
    if (eq < 0) continue;
    const key = body.slice(0, eq).trim();
    if (interesting.test(key) || interesting.test(body.slice(0, 40))) {
      keys.push((trimmed.startsWith("#") ? "#" : "") + key);
    }
  }
  const rel = path.relative(path.join(__dirname, ".."), file);
  console.log(rel, keys.length ? keys.join(",") : "NO_GOOGLE_OAUTH_KEYS");
}
