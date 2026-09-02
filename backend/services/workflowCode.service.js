const vm = require("node:vm");

/**
 * Runs a workflow Code node's JavaScript.
 *
 * Hardening notes, because this executes user-supplied code in-process:
 *  - `runInNewContext` gives the script its own intrinsics, so reaching the
 *    host `Function` through `({}).constructor.constructor` only yields the
 *    sandbox's own Function.
 *  - No host object is ever handed in. Data crosses the boundary as JSON text
 *    and results come back as a JSON string, so there is no live reference to
 *    anything in this process.
 *  - `require`, `process`, `globalThis.fetch` and timers are simply absent.
 *  - Code generation (eval / new Function) is disabled.
 *  - A wall-clock timeout interrupts runaway synchronous loops.
 *
 * This is a strong barrier, not a virtual machine: treat the ability to edit a
 * Code node as equivalent to running code on the server.
 */

const MAX_TIMEOUT_MS = 10000;
const DEFAULT_TIMEOUT_MS = 2000;
const MAX_OUTPUT_BYTES = 512 * 1024;

const toJsonLiteral = (value) =>
  JSON.stringify(value === undefined ? null : value).replace(
    /<\/script/gi,
    "<\\/script"
  );

const PRELUDE = `
  const __logs = [];
  const console = Object.freeze({
    log: (...args) => {
      if (__logs.length < 100) {
        __logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      }
    },
  });
`;

const buildScript = (code, mode) => {
  if (mode === "each") {
    // `item` and `index` arrive as parameters so each iteration sees its own.
    return `${PRELUDE}
      const __fn = function (item, index) {\n${code}\n};
      const __results = [];
      for (let __i = 0; __i < items.length; __i++) {
        const __r = __fn(items[__i], __i);
        if (__r !== undefined && __r !== null) __results.push(__r);
      }
      JSON.stringify({ result: __results, logs: __logs });
    `;
  }
  return `${PRELUDE}
    const __fn = function () {\n${code}\n};
    const __out = __fn();
    JSON.stringify({ result: __out === undefined ? null : __out, logs: __logs });
  `;
};

const runSandboxedCode = ({
  code,
  mode = "all",
  items = [],
  input = null,
  steps = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  const source = String(code || "").trim();
  if (!source) throw new Error("Code node has no code to run");

  const timeout = Math.min(
    Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 100),
    MAX_TIMEOUT_MS
  );

  // Only plain JSON data crosses into the sandbox.
  const bootstrap = `
    const items = ${toJsonLiteral(items)};
    const item = items.length === 1 ? items[0] : null;
    const input = ${toJsonLiteral(input)};
    const steps = ${toJsonLiteral(steps)};
  `;

  let raw;
  try {
    raw = vm.runInNewContext(
      `${bootstrap}\n${buildScript(source, mode)}`,
      Object.create(null),
      {
        timeout,
        displayErrors: true,
        contextCodeGeneration: { strings: false, wasm: false },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Script execution timed out/i.test(message)) {
      throw new Error(`Code node timed out after ${timeout}ms`);
    }
    throw new Error(`Code node failed: ${message}`);
  }

  if (typeof raw !== "string") {
    throw new Error("Code node returned a value that cannot be serialised");
  }
  if (raw.length > MAX_OUTPUT_BYTES) {
    throw new Error(
      `Code node returned too much data (${raw.length} bytes, limit ${MAX_OUTPUT_BYTES})`
    );
  }

  const { result, logs } = JSON.parse(raw);
  return { result, logs: Array.isArray(logs) ? logs : [] };
};

module.exports = { runSandboxedCode, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS };
