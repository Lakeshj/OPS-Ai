/**
 * Part 12B.1 — isolated repeat runner for flaky 10A-19 / 10C.1-17.
 * Does not start the embedded workflow worker; uses processOnce drain only.
 */
const assert = require("node:assert");

const runSuite = async (label, registerFn, filterNames, repeats = 1) => {
  const results = [];
  for (let i = 1; i <= repeats; i += 1) {
    let passed = 0;
    let failed = 0;
    const fails = [];
    const queue = [];
    const check = (name, fn) => {
      if (filterNames && !filterNames.some((f) => name.includes(f))) return;
      queue.push(async () => {
        try {
          await fn();
          passed += 1;
          console.log(`  ok  ${name}`);
        } catch (err) {
          failed += 1;
          fails.push(`${name}: ${err.message}`);
          console.error(`FAIL  ${name}\n      ${err.message}`);
        }
      });
    };
    const section = (name) =>
      queue.push(async () => console.log(`\n[${label} #${i}] ${name}`));
    registerFn({ check, section, assert });
    for (const job of queue) await job();
    results.push({ i, passed, failed, fails });
    console.log(
      `[${label} #${i}] passed=${passed} failed=${failed}${
        fails.length ? " :: " + fails.join(" | ") : ""
      }`
    );
  }
  return results;
};

const main = async () => {
  // Confirm no embedded worker interval is running from this process
  const worker = require("../services/workflowWorker.service");
  if (typeof worker.stopWorkflowWorker === "function") {
    worker.stopWorkflowWorker();
  }

  console.log("=== LIVE WORKER CHECK (this process) ===");
  console.log("stopWorkflowWorker invoked; using processOnce-only drains");

  const r19 = await runSuite(
    "10A-19",
    require("./smoke-workflow-subworkflow-10a").registerPart10ATests,
    ["TEST 10A-19"],
    5
  );
  const r17 = await runSuite(
    "10C.1-17",
    require("./smoke-workflow-subworkflow-10c1").registerPart10C1Tests,
    ["TEST 10C.1-17"],
    5
  );

  const summarize = (rows) => ({
    runs: rows.length,
    allPassed: rows.every((r) => r.failed === 0),
    totalFailed: rows.reduce((s, r) => s + r.failed, 0),
  });

  console.log("\n=== SUMMARY ===");
  console.log("10A-19:", JSON.stringify(summarize(r19)));
  console.log("10C.1-17:", JSON.stringify(summarize(r17)));

  const ok = summarize(r19).allPassed && summarize(r17).allPassed;
  process.exitCode = ok ? 0 : 1;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
