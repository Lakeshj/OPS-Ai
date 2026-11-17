/**
 * Instagram M8.1 — native card renderer + MCP category + connection classification.
 * Run: npx --yes tsx scripts/smoke-instagram-ui-fix.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getNodeCardIcon,
  getNodeCardTitle,
  getNodeVisualCategory,
} from "../src/modules/workflows/nodeCardPresentation";
import {
  getEdgeConnectionKind,
  isAuxiliaryEdge,
  validateTypedConnection,
} from "../src/modules/workflows/connectionPorts";
import { getNodeContract } from "../src/modules/workflows/nodeContract";
import { Camera, BarChart3 } from "lucide-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const read = (rel: string) =>
  fs.readFileSync(path.join(frontendRoot, rel), "utf8");

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

console.log("\nInstagram M8.1 UI renderer + connection fix");

check("IG-UI-FIX-1 Instagram renderer does not resolve generic light fallback", () => {
  const canvas = read("src/components/workflows/WorkflowCanvas.tsx");
  assert.match(
    canvas,
    /instagram:\s*WorkflowNode/,
    "native instagram must be registered in React Flow nodeTypes"
  );
  const visual = getNodeVisualCategory("instagram");
  assert.equal(visual.bucket, "marketing");
  assert.match(visual.borderClass, /rose/);
  assert.notEqual(visual.bucket, "core_data");
  assert.notEqual(visual.label, "CORE / DATA");
  // Generic light RF default is avoided when WorkflowNode + marketing tokens apply.
  assert.ok(visual.glowClass.includes("244,63,94") || visual.glowClass.includes("rose"));
});

check("IG-UI-FIX-2 Instagram title foreground has readable presentation token", () => {
  const visual = getNodeVisualCategory("instagram");
  assert.equal(visual.tagClass, "text-rose-300");
  assert.match(visual.iconWrapClass, /text-rose-200/);
  const title = getNodeCardTitle("instagram", { label: "" } as never);
  assert.equal(title, "Instagram");
  const nodeSrc = read("src/components/workflows/WorkflowNode.tsx");
  assert.match(nodeSrc, /getNodeVisualCategory/);
  assert.match(nodeSrc, /text-foreground/);
  assert.match(nodeSrc, /visual\.tagClass/);
  assert.match(nodeSrc, /visual\.iconWrapClass/);
});

check("IG-UI-FIX-3 Instagram icon resolves", () => {
  assert.equal(getNodeCardIcon("instagram"), Camera);
  const wrap = getNodeVisualCategory("instagram").iconWrapClass;
  assert.match(wrap, /bg-rose-500/);
});

check("IG-UI-FIX-4 Instagram MCP does not display FILES / GOOGLE / EMAIL", () => {
  const visual = getNodeVisualCategory("instagramMcpTool");
  assert.equal(visual.bucket, "social_mcp");
  assert.equal(visual.label, "SOCIAL / MCP");
  assert.notEqual(visual.label, "FILES / GOOGLE / EMAIL");
  assert.match(visual.borderClass, /amber/);
  assert.equal(getNodeCardIcon("instagramMcpTool"), BarChart3);
  const title = getNodeCardTitle("instagramMcpTool", { label: "" } as never);
  assert.equal(title, "Instagram MCP Tools");
  // Google Ads MCP taxonomy unchanged
  const gads = getNodeVisualCategory("googleAdsMcpTool");
  assert.equal(gads.label, "FILES / GOOGLE / EMAIL");
});

check("IG-UI-FIX-5 Instagram→MCP source binding classified non-execution", () => {
  // Proven Google/Meta architecture: source is node config, not a canvas edge.
  const panel = read("src/components/workflows/params/DynamicMcpToolField.tsx");
  assert.match(panel, /instagramSourceNodeId/);
  const contract = getNodeContract("instagramMcpTool");
  assert.ok(
    contract.edgeCases?.some((c) =>
      /Source binding is node config/i.test(c)
    )
  );
  // Config field is not an execution edge and does not schedule WorkflowItems.
  const srcMod = read("src/modules/workflows/instagramMcpSource.ts");
  assert.match(srcMod, /instagramSourceFieldState/);
});

check("IG-UI-FIX-6 source binding does not carry WorkflowItems", () => {
  // A mistaken main→main Instagram→MCP edge is execution (items), distinct from source config.
  const mainEdge = validateTypedConnection({
    sourceType: "instagram",
    targetType: "instagramMcpTool",
    sourceHandle: "main",
    targetHandle: "main",
  });
  assert.equal(mainEdge.ok, true);
  if (mainEdge.ok) {
    assert.equal(mainEdge.connectionKind, "execution");
    assert.equal(mainEdge.dataType, "workflow-items");
  }
  // Source config itself has no port / no WorkflowItem payload.
  const ig = getNodeContract("instagram");
  assert.equal(
    ig.outputs.some((p) => p.connectionKind === "auxiliary"),
    false
  );
});

check("IG-UI-FIX-7 normal Instagram main output remains main execution/data", () => {
  const toAi = validateTypedConnection({
    sourceType: "instagram",
    targetType: "ai",
    sourceHandle: "main",
    targetHandle: "main",
  });
  assert.equal(toAi.ok, true);
  if (toAi.ok) {
    assert.equal(toAi.connectionKind, "execution");
    assert.equal(toAi.dataType, "workflow-items");
  }
  const ig = getNodeContract("instagram");
  const main = ig.outputs.find((p) => p.id === "main");
  assert.ok(main);
  assert.equal(main?.kind, "main");
});

check("IG-UI-FIX-8 Instagram MCP→AI Agent remains auxiliary ai_tool", () => {
  const tool = validateTypedConnection({
    sourceType: "instagramMcpTool",
    targetType: "aiAgent",
    sourceHandle: "tool",
    targetHandle: "tools",
  });
  assert.equal(tool.ok, true);
  if (tool.ok) {
    assert.equal(tool.connectionKind, "auxiliary");
    assert.equal(tool.dataType, "ai-tool");
  }
  const nodes = [
    { id: "mcp", type: "instagramMcpTool" },
    { id: "agent", type: "aiAgent" },
  ];
  const edge = {
    source: "mcp",
    target: "agent",
    sourceHandle: "tool",
    targetHandle: "tools",
  };
  assert.equal(getEdgeConnectionKind(edge, nodes), "auxiliary");
  assert.equal(isAuxiliaryEdge(edge, nodes), true);
  const out = getNodeContract("instagramMcpTool").outputs.find(
    (p) => p.id === "tool"
  );
  assert.equal(out?.kind, "ai_tool");
  assert.equal(out?.connectionKind, "auxiliary");
});

check("IG-UI-FIX-9 Google Ads MCP connection regression green", () => {
  const gads = getNodeVisualCategory("googleAdsMcpTool");
  assert.equal(gads.label, "FILES / GOOGLE / EMAIL");
  assert.match(gads.borderClass, /amber/);
  const tool = validateTypedConnection({
    sourceType: "googleAdsMcpTool",
    targetType: "aiAgent",
    sourceHandle: "tool",
    targetHandle: "tools",
  });
  assert.equal(tool.ok, true);
  if (tool.ok) {
    assert.equal(tool.connectionKind, "auxiliary");
    assert.equal(tool.dataType, "ai-tool");
  }
  const contract = getNodeContract("googleAdsMcpTool");
  assert.ok(
    contract.edgeCases?.some((c) =>
      /Source binding is node config/i.test(c)
    )
  );
});

check("IG-UI-FIX-10 Meta Ads MCP connection regression green", () => {
  const meta = getNodeVisualCategory("metaAdsMcpTool");
  // Meta Ads MCP was already outside FILES_GOOGLE_EMAIL; leave bucket unchanged.
  assert.notEqual(meta.label, "SOCIAL / MCP");
  const canvas = read("src/components/workflows/WorkflowCanvas.tsx");
  assert.match(canvas, /metaAdsMcpTool:\s*WorkflowNode/);
  assert.match(canvas, /metaAds:\s*WorkflowNode/);
  const main = validateTypedConnection({
    sourceType: "metaAds",
    targetType: "metaAdsMcpTool",
    sourceHandle: "main",
    targetHandle: "main",
  });
  assert.equal(main.ok, true);
  if (main.ok) {
    assert.equal(main.connectionKind, "execution");
  }
});

console.log(`\n${passed} IG-UI-FIX checks passed`);
process.exit(process.exitCode || 0);
