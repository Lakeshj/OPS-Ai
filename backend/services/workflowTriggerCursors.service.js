/**
 * Part 14D.5 — Durable poll cursors for polling triggers (Gmail Trigger).
 * Stored per workflow + node. Never written into workflow JSON or native export.
 */

const { pool } = require("../config/database");

const memory = new Map();
let useMemory = false;

const keyOf = (workflowId, nodeId) => `${workflowId}::${nodeId}`;

const withMemoryCursors = async (fn) => {
  const prev = useMemory;
  useMemory = true;
  try {
    return await fn();
  } finally {
    useMemory = prev;
  }
};

const resetMemoryCursors = () => memory.clear();

const parseCursor = (raw) => {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const getTriggerCursor = async (workflowId, nodeId) => {
  if (useMemory) {
    return memory.get(keyOf(workflowId, nodeId)) || null;
  }
  const [rows] = await pool.execute(
    `SELECT cursor_json FROM workflow_trigger_cursors WHERE workflow_id = ? AND node_id = ?`,
    [workflowId, nodeId]
  );
  if (!rows.length) return null;
  return parseCursor(rows[0].cursor_json);
};

const setTriggerCursor = async (workflowId, nodeId, cursor) => {
  const json = JSON.stringify(cursor || {});
  if (useMemory) {
    memory.set(keyOf(workflowId, nodeId), cursor || {});
    return;
  }
  await pool.execute(
    `INSERT INTO workflow_trigger_cursors (workflow_id, node_id, cursor_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE cursor_json = VALUES(cursor_json)`,
    [workflowId, nodeId, json]
  );
};

const deleteTriggerCursor = async (workflowId, nodeId) => {
  if (useMemory) {
    memory.delete(keyOf(workflowId, nodeId));
    return;
  }
  await pool.execute(
    `DELETE FROM workflow_trigger_cursors WHERE workflow_id = ? AND node_id = ?`,
    [workflowId, nodeId]
  );
};

module.exports = {
  withMemoryCursors,
  resetMemoryCursors,
  getTriggerCursor,
  setTriggerCursor,
  deleteTriggerCursor,
};
