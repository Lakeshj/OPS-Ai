/**
 * 14D.5.3R — report Google OAuth key presence only. Never print values.
 */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../backend/.env");
const keys = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "CORS_ORIGIN",
];

const classifyLine = (raw) => {
  const line = String(raw || "");
  const hash = line.trimStart().startsWith("#");
  const eq = line.indexOf("=");
  const rhs = eq >= 0 ? line.slice(eq + 1).trim().replace(/^["']|["']$/g, "") : "";
  if (hash) return "COMMENTED";
  if (!rhs) return "EMPTY";
  return "SET";
};

const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
console.log("ENV_FILE", fs.existsSync(envPath) ? "PRESENT" : "MISSING");
for (const key of keys) {
  const lines = text.split(/\r?\n/).filter((l) => {
    const t = l.replace(/^\s*#\s*/, "").trimStart();
    return t.startsWith(`${key}=`) || t.startsWith(`${key} =`);
  });
  const file = lines.length ? classifyLine(lines[lines.length - 1]) : "ABSENT";
  const proc = process.env[key] && String(process.env[key]).trim() ? "SET" : "UNSET";
  console.log(key, "file=" + file, "process=" + proc, "count=" + lines.length);
}
