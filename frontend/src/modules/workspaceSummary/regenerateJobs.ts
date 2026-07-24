import { WorkspaceSummary } from "@/modules/shared/types";

type JobRecord = {
  promise: Promise<WorkspaceSummary>;
  startedAt: number;
};

const regenerateJobs = new Map<string, JobRecord>();

/**
 * Keeps regenerate running even if the summary panel unmounts
 * (e.g. user clicks another tab accidentally).
 */
export function runWorkspaceSummaryRegenerate(
  workspaceId: string,
  runner: () => Promise<WorkspaceSummary>
): Promise<WorkspaceSummary> {
  const existing = regenerateJobs.get(workspaceId);
  if (existing) return existing.promise;

  const promise = runner().finally(() => {
    regenerateJobs.delete(workspaceId);
  });

  regenerateJobs.set(workspaceId, {
    promise,
    startedAt: Date.now(),
  });

  return promise;
}

export function getWorkspaceSummaryRegenerateJob(workspaceId: string) {
  return regenerateJobs.get(workspaceId) || null;
}
