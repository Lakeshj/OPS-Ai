/**
 * Decide whether previewExpression may seed the editor session from a
 * production run when a referenced step is marked dirty.
 *
 * Healing an OLD run after a capability/config change reintroduces stale
 * GSC MCP opportunities into AI Preview — only heal when the run finished
 * AFTER the dirty mark (user re-executed with the current definition).
 */

const CONFIG_DIRTY_REASONS = new Set([
  "params",
  "disabled",
  "config_change",
  "edge_change",
  "insert_node",
  "node_deleted",
  "unpin",
  "pin_content",
  "legacy_invalidate",
]);

/**
 * @param {{
 *   dirtyMeta?: { dirty?: boolean, reason?: string, since?: string } | null,
 *   healRun?: { status?: string, finishedAt?: string, startedAt?: string, createdAt?: string } | null,
 * }} opts
 * @returns {boolean}
 */
const shouldHealStalePreviewFromRun = ({ dirtyMeta, healRun } = {}) => {
  if (!healRun || healRun.status !== "succeeded") return false;
  if (!dirtyMeta?.dirty) return true;

  const runFinished = Date.parse(
    healRun.finishedAt || healRun.startedAt || healRun.createdAt || ""
  );
  const dirtySince = Date.parse(dirtyMeta.since || "");

  // Config changed: only accept a run that completed after the change.
  if (CONFIG_DIRTY_REASONS.has(String(dirtyMeta.reason || ""))) {
    if (!Number.isFinite(runFinished) || !Number.isFinite(dirtySince)) {
      return false;
    }
    return runFinished > dirtySince;
  }

  // Downstream re_executed / unknown: still require run to be newer when since is known.
  if (Number.isFinite(dirtySince) && Number.isFinite(runFinished)) {
    return runFinished > dirtySince;
  }
  return true;
};

module.exports = {
  shouldHealStalePreviewFromRun,
  CONFIG_DIRTY_REASONS,
};
