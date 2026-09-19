/**
 * UX Phase B — pure workflow layout checks (no test framework).
 * Run: npx --yes tsx scripts/smoke-workflow-layout.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Edge, Node } from "@xyflow/react";
import {
  assertNoNodeOverlap,
  hasForwardCycle,
  inputPortOrder,
  layoutWorkflowGraph,
  measureNode,
  projectForwardEdges,
} from "../src/modules/workflows/workflowLayout";

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const n = (
  id: string,
  type: string,
  x = 0,
  y = 0,
  data: Record<string, unknown> = {}
): Node => ({
  id,
  type,
  position: { x, y },
  data: { label: id, ...data },
  measured: { width: 180, height: 72 },
});

const e = (
  id: string,
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null
): Edge => ({
  id,
  source,
  target,
  sourceHandle: sourceHandle ?? undefined,
  targetHandle: targetHandle ?? undefined,
});

async function main() {
  console.log("\nWorkflow layout (UX Phase B)");

  await check("linear graph increasing X", async () => {
    const nodes = [
      n("a", "trigger"),
      n("b", "set"),
      n("c", "filter"),
      n("d", "http"),
      n("e", "result"),
    ];
    const edges = [
      e("1", "a", "b"),
      e("2", "b", "c"),
      e("3", "c", "d"),
      e("4", "d", "e"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.positions.a.x < r.positions.b.x);
    assert.ok(r.positions.b.x < r.positions.c.x);
    assert.ok(r.positions.c.x < r.positions.d.x);
    assert.ok(r.positions.d.x < r.positions.e.x);
  });

  await check("branch nodes separate vertically", async () => {
    const nodes = [
      n("t", "trigger"),
      n("if", "condition"),
      n("a", "set"),
      n("b", "set"),
      n("m", "merge"),
    ];
    const edges = [
      e("1", "t", "if"),
      e("2", "if", "a", "true"),
      e("3", "if", "b", "false"),
      e("4", "a", "m", null, "input1"),
      e("5", "b", "m", null, "input2"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.notEqual(r.positions.a.y, r.positions.b.y);
  });

  await check("Merge 3 inputs: dynamic ports registered (no input3→input1 collapse)", () => {
    const merge = n("m", "merge", 0, 0, { numberOfInputs: 3 });
    // Drop measured so measureNode uses merge sizing path
    delete (merge as { measured?: unknown }).measured;
    assert.deepEqual(inputPortOrder(merge), ["input1", "input2", "input3"]);
    const size = measureNode(merge);
    assert.ok(size.height >= 100, `merge height ${size.height}`);
    assert.ok(size.height > 100, "3-input merge should be taller than default 100");
  });

  await check("Merge 3 inputs: Tidy keeps source Y order aligned with Input 1..3", async () => {
    const nodes = [
      n("t", "trigger"),
      n("s1", "gscMcpTool", 0, 0),
      n("s2", "gscMcpTool", 0, 80),
      n("s3", "gscMcpTool", 0, 160),
      n("m", "merge", 200, 80, { numberOfInputs: 3 }),
    ];
    // Avoid measured override so ELK sees taller merge
    for (const node of nodes) {
      if (node.type === "merge") delete (node as { measured?: unknown }).measured;
    }
    const edges = [
      e("1", "t", "s1"),
      e("2", "t", "s2"),
      e("3", "t", "s3"),
      e("4", "s1", "m", null, "input1"),
      e("5", "s2", "m", null, "input2"),
      e("6", "s3", "m", null, "input3"),
    ];
    const beforeHandles = edges.map((x) => ({
      id: x.id,
      targetHandle: x.targetHandle,
    }));
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Positions only — handles must not be rewritten
    assert.deepEqual(
      edges.map((x) => ({ id: x.id, targetHandle: x.targetHandle })),
      beforeHandles
    );
    // Input1 source above Input2 above Input3 (port order)
    assert.ok(
      r.positions.s1.y <= r.positions.s2.y,
      `input1 source y=${r.positions.s1.y} should be <= input2 y=${r.positions.s2.y}`
    );
    assert.ok(
      r.positions.s2.y <= r.positions.s3.y,
      `input2 source y=${r.positions.s2.y} should be <= input3 y=${r.positions.s3.y}`
    );
    assert.ok(r.positions.m.x > r.positions.s1.x);
  });

  await check("Merge positioned after both branch predecessors", async () => {
    const nodes = [
      n("t", "trigger"),
      n("if", "condition"),
      n("a", "set"),
      n("b", "set"),
      n("m", "merge"),
    ];
    const edges = [
      e("1", "t", "if"),
      e("2", "if", "a", "true"),
      e("3", "if", "b", "false"),
      e("4", "a", "m", null, "input1"),
      e("5", "b", "m", null, "input2"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.positions.m.x > r.positions.a.x);
    assert.ok(r.positions.m.x > r.positions.b.x);
  });

  await check("IF True above False (port order)", async () => {
    const nodes = [
      n("t", "trigger"),
      n("if", "condition"),
      n("a", "noop"),
      n("b", "noop"),
    ];
    const edges = [
      e("1", "t", "if"),
      e("2", "if", "a", "true"),
      e("3", "if", "b", "false"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(
      r.positions.a.y <= r.positions.b.y,
      `true branch y=${r.positions.a.y} should be <= false y=${r.positions.b.y}`
    );
  });

  await check("Switch outputs preserve rule order vertically", async () => {
    const rules = [
      { id: "rule_high", label: "High" },
      { id: "rule_med", label: "Medium" },
      { id: "rule_low", label: "Low" },
    ];
    const nodes = [
      n("t", "trigger"),
      n("sw", "switch", 0, 0, { rules, enableFallback: true }),
      n("h", "noop"),
      n("m", "noop"),
      n("l", "noop"),
      n("f", "noop"),
    ];
    const edges = [
      e("1", "t", "sw"),
      e("2", "sw", "h", "rule_high"),
      e("3", "sw", "m", "rule_med"),
      e("4", "sw", "l", "rule_low"),
      e("5", "sw", "f", "fallback"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.positions.h.y <= r.positions.m.y);
    assert.ok(r.positions.m.y <= r.positions.l.y);
    assert.ok(r.positions.l.y <= r.positions.f.y);
  });

  await check("disconnected components do not overlap", async () => {
    const nodes = [
      n("a1", "trigger", 0, 0),
      n("a2", "result", 100, 0),
      n("b1", "trigger", 50, 50),
      n("b2", "result", 150, 50),
      n("alone", "noop", 10, 10),
    ];
    const edges = [e("1", "a1", "a2"), e("2", "b1", "b2")];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(assertNoNodeOverlap(r.positions, nodes));
  });

  await check("Loop back-edge excluded from rank calculation", () => {
    const nodes = [
      n("t", "code"),
      n("L", "loop"),
      n("body", "noop"),
      n("after", "noop"),
    ];
    const edges = [
      e("1", "t", "L", null, "items"),
      e("2", "L", "body", "batch"),
      e("3", "body", "L", null, "continue"),
      e("4", "L", "after", "done"),
    ];
    const { forwardEdges, loopBackEdges } = projectForwardEdges(nodes, edges);
    assert.equal(loopBackEdges.length, 1);
    assert.equal(forwardEdges.length, 3);
    assert.equal(hasForwardCycle(nodes, forwardEdges), false);
    assert.equal(hasForwardCycle(nodes, edges), true);
  });

  await check("Loop body placed after Loop; Done outside body lane", async () => {
    const nodes = [
      n("t", "code"),
      n("L", "loop"),
      n("body", "set"),
      n("after", "result"),
    ];
    const edges = [
      e("1", "t", "L", null, "items"),
      e("2", "L", "body", "batch"),
      e("3", "body", "L", null, "continue"),
      e("4", "L", "after", "done"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.positions.body.x > r.positions.L.x);
    assert.ok(r.positions.after.x > r.positions.L.x);
  });

  await check("repeated layout deterministic", async () => {
    const nodes = [
      n("a", "trigger"),
      n("b", "http"),
      n("c", "result"),
    ];
    const edges = [e("1", "a", "b"), e("2", "b", "c")];
    const r1 = await layoutWorkflowGraph({ nodes, edges });
    const r2 = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r1.ok && r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    assert.deepEqual(r1.positions, r2.positions);
  });

  await check("node dimensions respected (no overlap)", async () => {
    const nodes = [
      n("a", "trigger"),
      n("b", "switch", 0, 0, {
        rules: [
          { id: "r1", label: "A" },
          { id: "r2", label: "B" },
        ],
      }),
      n("c", "noop"),
      n("d", "noop"),
    ];
    nodes[1].measured = { width: 220, height: 140 };
    const edges = [
      e("1", "a", "b"),
      e("2", "b", "c", "r1"),
      e("3", "b", "d", "r2"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(assertNoNodeOverlap(r.positions, nodes));
  });

  await check("invalid generic cycle returns safe failure", async () => {
    const nodes = [n("a", "noop"), n("b", "noop")];
    const edges = [e("1", "a", "b"), e("2", "b", "a")];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /invalid/i);
  });

  await check("controlled Loop cycle succeeds", async () => {
    const nodes = [
      n("t", "code"),
      n("L", "loop"),
      n("body", "noop"),
      n("after", "noop"),
    ];
    const edges = [
      e("1", "t", "L", null, "items"),
      e("2", "L", "body", "batch"),
      e("3", "body", "L", null, "continue"),
      e("4", "L", "after", "done"),
    ];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
  });

  await check("node IDs unchanged (positions only)", async () => {
    const nodes = [n("keep-me", "trigger"), n("also", "result")];
    const edges = [e("e1", "keep-me", "also")];
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(Object.keys(r.positions).sort(), ["also", "keep-me"]);
    assert.equal(nodes[0].id, "keep-me");
    assert.equal(edges[0].id, "e1");
  });

  await check("position change is orthogonal to execution signature keys", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "../../backend/services/workflowGraphInvalidation.service.js"),
      "utf8"
    );
    assert.ok(src.includes("computeNodeExecutionSignature"));
    assert.ok(src.includes("UI_ONLY_DATA_KEYS"));
    // Signature payload uses type/data/incoming — not node.position
    assert.ok(src.includes("incoming"));
    assert.ok(!/\bposition\b/.test(src));
  });

  await check("original graph retained conceptually on layout failure", async () => {
    const nodes = [n("a", "noop", 11, 22), n("b", "noop", 33, 44)];
    const edges = [e("1", "a", "b"), e("2", "b", "a")];
    const before = JSON.stringify(nodes.map((x) => x.position));
    const r = await layoutWorkflowGraph({ nodes, edges });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(nodes.map((x) => x.position)), before);
  });

  console.log(`\n${passed} layout checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
