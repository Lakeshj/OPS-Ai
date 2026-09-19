const { spawn } = require("child_process");
const readline = require("readline");
const { PluginError, ERROR, normalizeResult } = require("../errors");
const { categorizeTool } = require("../registry/categories");

/**
 * Minimal MCP JSON-RPC client over stdio (CommonJS-friendly).
 */
const createStdioSession = async ({ command, args = [], env = {}, cwd, timeouts = {} }) => {
  const connectTimeoutMs = timeouts.connectTimeoutMs || 45000;
  const callTimeoutMs = timeouts.callTimeoutMs || 60000;

  const child = spawn(command, args, {
    cwd: cwd || undefined,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  const pending = new Map();
  let closed = false;
  let stderrBuf = "";

  child.stderr.on("data", (chunk) => {
    stderrBuf += String(chunk || "");
    if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const raw = String(line || "").trim();
    if (!raw) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id == null) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(
        new PluginError(
          msg.error.message || "MCP JSON-RPC error",
          ERROR.MCP_TOOL_FAILED,
          { rpc: msg.error }
        )
      );
    } else {
      waiter.resolve(msg.result);
    }
  });

  const failAll = (err) => {
    for (const waiter of pending.values()) waiter.reject(err);
    pending.clear();
  };

  child.on("error", (err) => {
    closed = true;
    failAll(
      new PluginError(
        `Failed to start MCP process: ${err.message}`,
        ERROR.MCP_UNAVAILABLE
      )
    );
  });

  child.on("exit", (code) => {
    closed = true;
    failAll(
      new PluginError(
        `MCP process exited (code=${code}). ${stderrBuf.slice(-500)}`,
        ERROR.MCP_UNAVAILABLE,
        { code, stderr: stderrBuf.slice(-1000) }
      )
    );
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(
          new PluginError("MCP session is closed", ERROR.MCP_UNAVAILABLE)
        );
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new PluginError(
            `MCP request timeout: ${method}`,
            ERROR.MCP_UNAVAILABLE,
            { method }
          )
        );
      }, method === "initialize" ? connectTimeoutMs : callTimeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: params || {},
      });
      try {
        child.stdin.write(`${payload}\n`);
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });

  try {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "opsai-gsc-mcp-plugin", version: "0.1.0" },
    });
    // notifications/initialized (no id)
    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        })}\n`
      );
    } catch {
      // ignore
    }
  } catch (err) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    async listTools() {
      const result = await request("tools/list", {});
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      return tools.map((t) => ({
        id: String(t.name),
        name: String(t.name),
        description: String(t.description || ""),
        inputSchema:
          t.inputSchema && typeof t.inputSchema === "object"
            ? t.inputSchema
            : { type: "object", properties: {} },
        category: categorizeTool(t.name),
        source: "external",
        externalName: String(t.name),
      }));
    },
    async callTool(name, args = {}) {
      try {
        const result = await request("tools/call", {
          name,
          arguments: args && typeof args === "object" ? args : {},
        });
        let data = result;
        if (Array.isArray(result?.content)) {
          const texts = result.content
            .filter((c) => c && c.type === "text")
            .map((c) => c.text);
          if (texts.length === 1) {
            try {
              data = JSON.parse(texts[0]);
            } catch {
              data = texts[0];
            }
          } else if (texts.length > 1) {
            data = texts;
          }
        }
        if (result?.isError) {
          return normalizeResult(name, {
            ok: false,
            error: {
              code: ERROR.MCP_TOOL_FAILED,
              message: typeof data === "string" ? data : "MCP tool returned isError",
            },
            raw: result,
          });
        }
        return normalizeResult(name, { data, raw: result });
      } catch (err) {
        return normalizeResult(name, {
          ok: false,
          error: {
            code: err.code || ERROR.MCP_TOOL_FAILED,
            message: err.message || "MCP tool call failed",
          },
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        rl.close();
      } catch {
        // ignore
      }
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    },
  };
};

const createStdioTransport = (config) => ({
  async connect(authEnv = {}) {
    const external = config.external || {};
    return createStdioSession({
      command: external.command || "npx",
      args: Array.isArray(external.args) ? external.args : [],
      cwd: external.cwd || undefined,
      env: authEnv,
      timeouts: {
        connectTimeoutMs: external.connectTimeoutMs,
        callTimeoutMs: external.callTimeoutMs,
      },
    });
  },
});

module.exports = { createStdioTransport, createStdioSession };
