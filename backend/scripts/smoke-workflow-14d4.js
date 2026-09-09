/**
 * Part 14D.4 — Real-world n8n export migration (SEO Report golden fixture).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const FIXTURE = path.join(
  __dirname,
  "../fixtures/n8n/seo-report-real-world.json"
);

const loadFixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

const registerPart14D4Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.4 Real n8n export compatibility");

  const importSvc = () => require("../services/n8nWorkflowImport.service");
  const workflowsSvc = () => require("../modules/workflows/workflows.service");

  const preview = () => importSvc().previewN8nImport(loadFixture());

  check("TEST 14D4-REAL-1 Real SEO n8n export: format detected correctly", () => {
    const p = preview();
    assertX.equal(p.ok, true);
    assertX.equal(p.format, "n8n");
    assertX.equal(p.report.format, "n8n");
  });

  check("TEST 14D4-REAL-2 Source node count preserved including annotations", () => {
    const fixture = loadFixture();
    const p = preview();
    assertX.equal(p.report.sourceNodeCount, fixture.nodes.length);
    assertX.equal(p.report.sourceNodeCount, 25);
    assertX.equal(
      p.report.annotationCount + p.report.executionNodeCount,
      p.report.sourceNodeCount
    );
  });

  check("TEST 14D4-REAL-3 Sticky Notes classified non-runtime", () => {
    const p = preview();
    const sticky = p.report.nodes.filter((n) =>
      String(n.sourceNodeType).includes("stickyNote")
    );
    assertX.equal(sticky.length, 2);
    for (const s of sticky) {
      assertX.equal(s.category, "ANNOTATION");
      assertX.equal(s.status, "IGNORED_NON_RUNTIME");
      assertX.equal(s.blocksRuntime, false);
      assertX.equal(s.mappedType, null);
    }
    assertX.ok(
      !p.report.runtimeBlockers.some((b) => /Branch/i.test(b.nodeName || ""))
    );
  });

  check("TEST 14D4-REAL-4 Schedule mapped", () => {
    const p = preview();
    const sched = p.report.nodes.find((n) =>
      String(n.sourceNodeType).includes("scheduleTrigger")
    );
    assertX.ok(sched);
    assertX.equal(sched.mappedType, "schedule");
    assertX.ok(
      p.definition.nodes.some(
        (n) => n.type === "schedule" && n.id === sched.mappedNodeId
      )
    );
  });

  check("TEST 14D4-REAL-5 HTTP Request mapped where parameters supported", () => {
    const p = preview();
    const https = p.report.nodes.filter((n) =>
      String(n.sourceNodeType).includes("httpRequest")
    );
    assertX.ok(https.length >= 2);
    for (const h of https) {
      assertX.equal(h.mappedType, "http");
      assertX.ok(["SUPPORTED", "PARTIAL", "NEEDS_SETUP"].includes(h.status));
    }
  });

  check("TEST 14D4-REAL-6 Merge input indexes preserved", () => {
    const p = preview();
    const byLabel = Object.fromEntries(
      p.definition.nodes.map((n) => [n.data.label, n.id])
    );
    const finalId = byLabel["GSC & GA4 Final Merge"];
    const mergerId = byLabel["Merger"];
    const gscMergeId = byLabel["GSC Merge"];
    const ga4MergeId = byLabel["GA4 Merge"];
    const keepId = byLabel["Keep Only One Final Report"];
    const modelId = byLabel["Message a model"];

    const finalEdges = p.definition.edges.filter((e) => e.target === finalId);
    const fromGsc = finalEdges.find((e) => e.source === gscMergeId);
    const fromGa4 = finalEdges.find((e) => e.source === ga4MergeId);
    assertX.equal(fromGsc?.targetHandle, "input1");
    assertX.equal(fromGsc?.data?.migration?.sourceTargetInputIndex, 0);
    assertX.equal(fromGa4?.targetHandle, "input2");
    assertX.equal(fromGa4?.data?.migration?.sourceTargetInputIndex, 1);

    const mergerEdges = p.definition.edges.filter((e) => e.target === mergerId);
    const fromFile = mergerEdges.find((e) => e.source === keepId);
    const fromAi = mergerEdges.find((e) => e.source === modelId);
    assertX.equal(fromFile?.targetHandle, "input1");
    assertX.equal(fromAi?.targetHandle, "input2");
  });

  check("TEST 14D4-REAL-7 Set nodes mapped only if semantics compatible", () => {
    const p = preview();
    const sets = p.report.nodes.filter((n) =>
      String(n.sourceNodeType).endsWith(".set")
    );
    assertX.equal(sets.length, 2);
    for (const s of sets) {
      assertX.equal(s.mappedType, "set");
      assertX.equal(s.status, "SUPPORTED");
    }
    const current = p.definition.nodes.find(
      (n) => n.data.label === "Add Current Period"
    );
    assertX.deepEqual(current.data.mappings, [
      { key: "period", value: "current" },
    ]);
  });

  check("TEST 14D4-REAL-8 Code nodes never executed", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/n8nWorkflowImport.service.js"),
      "utf8"
    );
    assertX.ok(!/\beval\s*\(/.test(src));
    assertX.ok(!/new\s+Function\s*\(/.test(src));
    assertX.ok(!/vm\.run|runInNewContext|runInThisContext/.test(src));
    assertX.ok(!/child_process|dynamic import/.test(src));

    // Preview must remain static even if Code body is hostile.
    const fixture = loadFixture();
    const hostile = structuredClone(fixture);
    const codeNode = hostile.nodes.find((n) => n.type === "n8n-nodes-base.code");
    codeNode.parameters.jsCode =
      'throw new Error("SHOULD_NOT_RUN"); require("fs"); eval("1")';
    const p = importSvc().previewN8nImport(hostile);
    assertX.equal(p.ok, true);
  });

  check("TEST 14D4-REAL-9 Code nodes become unsupported placeholders", () => {
    const p = preview();
    const codes = p.report.nodes.filter((n) =>
      String(n.sourceNodeType).includes("n8n-nodes-base.code")
    );
    assertX.ok(codes.length >= 8);
    for (const c of codes) {
      assertX.equal(c.mappedType, "migrationUnsupported");
      assertX.ok(c.reasons.includes("ARBITRARY_CODE_NOT_PORTABLE"));
    }
    assertX.equal(
      p.definition.nodes.filter((n) => n.type === "code").length,
      0
    );
  });

  check("TEST 14D4-REAL-10 Gmail marked unsupported if OpsAi Gmail unavailable", () => {
    const p = preview();
    assertX.equal(importSvc().OPSAI_AVAILABILITY.gmail, false);
    const gmail = p.report.nodes.find((n) =>
      String(n.sourceNodeType).includes("gmail")
    );
    assertX.ok(gmail);
    assertX.equal(gmail.mappedType, "migrationUnsupported");
    assertX.ok(gmail.reasons.includes("INTEGRATION_NOT_AVAILABLE"));
  });

  check("TEST 14D4-REAL-11 Google Analytics marked unsupported if unavailable", () => {
    const p = preview();
    assertX.equal(importSvc().OPSAI_AVAILABILITY.googleAnalytics, false);
    const gas = p.report.nodes.filter((n) =>
      String(n.sourceNodeType).includes("googleAnalytics")
    );
    assertX.ok(gas.length >= 3);
    for (const g of gas) {
      assertX.equal(g.mappedType, "migrationUnsupported");
      assertX.ok(g.reasons.includes("INTEGRATION_NOT_AVAILABLE"));
    }
  });

  check("TEST 14D4-REAL-12 Standalone OpenAI Message-a-model NOT mapped to aiChatModel", () => {
    const p = preview();
    const openai = p.report.nodes.find(
      (n) => n.sourceNodeName === "Message a model"
    );
    assertX.ok(openai);
    assertX.equal(openai.category, "UNSUPPORTED_EXECUTION");
    assertX.notEqual(openai.mappedType, "aiChatModel");
    assertX.equal(openai.mappedType, "migrationUnsupported");
    assertX.ok(
      openai.reasons.includes("STANDALONE_MODEL_INVOCATION_UNSUPPORTED")
    );
    assertX.ok(
      openai.reasons.includes("AI_AUXILIARY_MISCLASSIFICATION_FORBIDDEN")
    );
    assertX.ok(
      !p.definition.nodes.some((n) => n.type === "aiChatModel")
    );
  });

  check("TEST 14D4-REAL-13 OpenAI credential reference becomes unresolved setup metadata", () => {
    const p = preview();
    const cred = p.report.credentials.find(
      (c) => c.sourceNodeName === "Message a model"
    );
    assertX.ok(cred);
    assertX.equal(cred.opsAiCredentialId, null);
    assertX.equal(cred.status, "NEEDS_SETUP");
    assertX.equal(cred.configuredAtSource, true);
  });

  check("TEST 14D4-REAL-14 Gmail credential reference becomes unresolved setup metadata", () => {
    const p = preview();
    const cred = p.report.credentials.find((c) =>
      /gmail/i.test(c.sourceCredentialType || "")
    );
    assertX.ok(cred);
    assertX.equal(cred.opsAiCredentialId, null);
    assertX.equal(cred.status, "NEEDS_SETUP");
  });

  check("TEST 14D4-REAL-15 GA credential reference becomes unresolved setup metadata", () => {
    const p = preview();
    const cred = p.report.credentials.find(
      (c) => c.sourceNodeName === "Get GA4 Data"
    );
    assertX.ok(cred);
    assertX.equal(cred.opsAiCredentialId, null);
    assertX.equal(cred.status, "NEEDS_SETUP");
  });

  check("TEST 14D4-REAL-16 Date expressions classified correctly", () => {
    const p = preview();
    const dates = p.report.expressions.filter(
      (e) => e.status === "EXPRESSION_REVIEW_REQUIRED"
    );
    assertX.ok(dates.length >= 1);
    for (const d of dates) {
      assertX.equal(d.converted, null);
      assertX.ok(
        /\$today|\$now|toFormat|minus/i.test(String(d.source || ""))
      );
    }
  });

  check("TEST 14D4-REAL-17 Named-node / complex JS not blindly translated", () => {
    const { classifyExpression } = importSvc();
    const named = classifyExpression('={{ $items("Get GA4 Page Current Data") }}');
    assertX.ok(["UNSUPPORTED", "NEEDS_REVIEW"].includes(named.status));
    assertX.equal(named.converted, null);

    // Code jsCode must not appear as auto-converted expression findings.
    const p = preview();
    const fromCode = p.report.expressions.filter((e) =>
      /Generate SEO Report|Create Combined Excel/i.test(e.nodeName || "")
    );
    assertX.equal(fromCode.length, 0);
  });

  check("TEST 14D4-REAL-18 Fan-out from Schedule preserves all branches", () => {
    const p = preview();
    assertX.equal(p.report.fanOut.preserved, true);
    assertX.equal(p.report.fanOut.targetNames.length, 5);
    const sched = p.definition.nodes.find((n) => n.type === "schedule");
    const outs = p.definition.edges.filter((e) => e.source === sched.id);
    assertX.equal(outs.length, 5);
  });

  check("TEST 14D4-REAL-19 Graph preview succeeds despite unsupported placeholders", () => {
    const p = preview();
    assertX.equal(p.ok, true);
    assertX.equal(p.structureImportable, true);
    assertX.ok(p.definition.nodes.length >= 20);
    assertX.ok(p.definition.edges.length >= 20);
    workflowsSvc().validateDefinition(p.definition);
  });

  check("TEST 14D4-REAL-20 Runtime readiness = false", () => {
    const p = preview();
    assertX.equal(p.runtimeReady, false);
    assertX.equal(p.report.runtimeReady, false);
    assertX.equal(p.report.scores.RUNTIME_READINESS, false);
    assertX.equal(p.report.summary.runtimeReadiness, "not_ready");
  });

  check("TEST 14D4-REAL-21 Import as Draft succeeds", () => {
    const built = importSvc().buildDraftImport(loadFixture());
    assertX.equal(built.ok, true);
    assertX.equal(built.draft.status, "draft");
    assertX.ok(built.draft.name.includes("imported"));
    workflowsSvc().validateDefinition(built.draft.definition);
  });

  check("TEST 14D4-REAL-22 Imported draft cannot activate/run while unsupported remain", () => {
    const p = preview();
    assertX.throws(
      () => importSvc().assertMigrationRunnable(p.definition),
      (err) => err.code === "MIGRATION_RUNTIME_BLOCKED"
    );
  });

  check("TEST 14D4-REAL-23 Source active/source IDs do not control target OpsAi state", () => {
    const fixture = loadFixture();
    assertX.equal(fixture.active, true);
    const built = importSvc().buildDraftImport(fixture);
    assertX.equal(built.draft.status, "draft");
    const defJson = JSON.stringify(built.draft.definition);
    assertX.ok(!defJson.includes(fixture.id));
    assertX.ok(!defJson.includes(fixture.versionId));
    assertX.equal(built.report.authority.freshOpsAiStatus, "draft");
    assertX.equal(built.report.authority.sourceActiveIgnored, true);
  });

  check("TEST 14D4-REAL-24 No source credential secret is imported", () => {
    const fixture = loadFixture();
    const p = preview();
    const defJson = JSON.stringify(p.definition);
    for (const node of fixture.nodes) {
      if (!node.credentials) continue;
      for (const ref of Object.values(node.credentials)) {
        if (ref?.id) {
          assertX.ok(
            !defJson.includes(`"credentialId":"${ref.id}"`),
            `source cred id ${ref.id} must not become OpsAi credentialId`
          );
        }
      }
    }
    for (const c of p.report.credentials) {
      assertX.equal(c.opsAiCredentialId, null);
    }
  });

  check("TEST 14D4-REAL-25 Full migration remains deterministic across repeated preview calls", () => {
    const a = preview();
    const b = preview();
    assertX.equal(a.fingerprint, b.fingerprint);
    assertX.deepEqual(
      a.definition.nodes.map((n) => n.id),
      b.definition.nodes.map((n) => n.id)
    );
    assertX.deepEqual(
      a.definition.edges.map((e) => [e.source, e.target, e.targetHandle || null]),
      b.definition.edges.map((e) => [e.source, e.target, e.targetHandle || null])
    );
  });

  check("TEST 14D4-REAL-extra N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN guard", () => {
    const p = preview();
    const poisoned = structuredClone(p.definition);
    poisoned.nodes.push({
      id: "evil_code",
      type: "code",
      data: {
        label: "Evil",
        code: "return $input.all()",
        migration: { sourceNodeType: "n8n-nodes-base.code" },
      },
    });
    const violation = importSvc().assertNoImportedCodeExecution(poisoned);
    assertX.ok(violation);
    assertX.equal(violation.code, "N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN");
  });

  check("TEST 14D4-REAL-extra scores separate structural vs runtime", () => {
    const p = preview();
    assertX.equal(p.report.scores.STRUCTURAL_COMPATIBILITY, true);
    assertX.equal(typeof p.report.scores.NODE_CONVERSION_COMPATIBILITY, "number");
    assertX.equal(p.report.scores.RUNTIME_READINESS, false);
    assertX.ok(p.report.scores.NODE_CONVERSION_COMPATIBILITY < 1);
  });

  check("TEST 14D4-REAL-extra import service never executes fixture Code via vm", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/n8nWorkflowImport.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("sanitizeCodePreview"));
    assertX.ok(src.includes("ARBITRARY_CODE_NOT_PORTABLE"));
    assertX.ok(!src.includes("runInNewContext"));
  });
};

module.exports = { registerPart14D4Tests };
