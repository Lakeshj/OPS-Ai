// One-off: flip library placeholders to executable as engine support lands.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/modules/workflows/nodeLibrary.json");

const ENABLE = {
  "split-out": "splitOut",
  filter: "filter",
  sort: "sort",
  limit: "limit",
  "remove-duplicates": "removeDuplicates",
  aggregate: "aggregate",
  summarize: "aggregate",
  merge: "merge",
  code: "code",
};

const catalog = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const changed = [];
for (const node of catalog.nodes) {
  const engineType = ENABLE[node.id];
  if (!engineType) continue;
  node.available = true;
  node.engineType = engineType;
  changed.push(`${node.name} -> ${engineType}`);
}

fs.writeFileSync(sourcePath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`enabled ${changed.length}:\n  ${changed.join("\n  ")}`);
