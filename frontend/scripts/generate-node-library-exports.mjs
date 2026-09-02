// Regenerates the downloadable copies of the workflow node library
// (public/*.json|csv) from src/modules/workflows/nodeLibrary.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/modules/workflows/nodeLibrary.json");

const catalog = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
catalog.updatedAt = new Date().toISOString();

const json = `${JSON.stringify(catalog, null, 2)}\n`;
fs.writeFileSync(sourcePath, json);
fs.writeFileSync(path.join(root, "public/workflow-node-library.json"), json);

const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const header = ["Node Name", "Category", "Type", "Description", "Provider", "Available"];
const rows = catalog.nodes.map((n) => [
  n.name,
  n.category,
  n.type,
  n.description,
  n.provider || "",
  n.available ? "true" : "false",
]);
fs.writeFileSync(
  path.join(root, "public/workflow-node-library.csv"),
  `${[header, ...rows].map((r) => r.map(esc).join(",")).join("\n")}\n`
);

const executable = catalog.nodes.filter((n) => n.engineType);
console.log(`nodes: ${catalog.nodes.length}, executable: ${executable.length}`);
console.log(
  `llm nodes: ${catalog.nodes
    .filter((n) => n.engineType === "ai" || n.engineType === "bot")
    .map((n) => `${n.name} -> ${n.engineType}`)
    .join(", ")}`
);
