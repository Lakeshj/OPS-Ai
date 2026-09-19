const { createStdioTransport } = require("./transportStdio");
const { createNativeTransport } = require("./transportNative");
const { createMockTransport } = require("./transportMock");

const createConnectionManager = (config) => {
  const maxSessions = config?.external?.maxSessions || 8;
  const idleTtlMs = config?.external?.idleTtlMs || 300000;
  /** @type {Map<string, { session: any, lastUsed: number, authKey: string }>} */
  const sessions = new Map();

  const transportFor = () => {
    const kind = String(config.transport || "stdio");
    if (kind === "mock") return createMockTransport();
    if (kind === "native") return createNativeTransport();
    return createStdioTransport(config);
  };

  const sweep = async () => {
    const now = Date.now();
    for (const [key, entry] of sessions.entries()) {
      if (now - entry.lastUsed > idleTtlMs) {
        sessions.delete(key);
        try {
          await entry.session.close();
        } catch {
          // ignore
        }
      }
    }
  };

  return {
    async acquire(authKey, authEnv) {
      await sweep();
      const existing = sessions.get(authKey);
      if (existing) {
        existing.lastUsed = Date.now();
        return existing.session;
      }
      if (sessions.size >= maxSessions) {
        // Evict oldest
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [k, v] of sessions.entries()) {
          if (v.lastUsed < oldestAt) {
            oldestAt = v.lastUsed;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const old = sessions.get(oldestKey);
          sessions.delete(oldestKey);
          try {
            await old.session.close();
          } catch {
            // ignore
          }
        }
      }
      const transport = transportFor();
      try {
        const session = await transport.connect(authEnv);
        sessions.set(authKey, { session, lastUsed: Date.now(), authKey });
        return session;
      } catch (err) {
        if (config.mockWhenUnavailable !== false) {
          const mock = createMockTransport();
          const session = await mock.connect(authEnv);
          sessions.set(authKey, { session, lastUsed: Date.now(), authKey });
          return session;
        }
        throw err;
      }
    },
    async releaseAll() {
      for (const entry of sessions.values()) {
        try {
          await entry.session.close();
        } catch {
          // ignore
        }
      }
      sessions.clear();
    },
    size() {
      return sessions.size;
    },
  };
};

module.exports = { createConnectionManager };
