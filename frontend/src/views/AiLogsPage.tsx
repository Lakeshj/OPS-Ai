"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ScrollText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminAiLogsApi,
  type AiErrorLogRow,
  type AiModelStatusRow,
  type AiUsageLogRow,
} from "@/modules/adminAiLogs/api";

const formatTokens = (value: number) =>
  value > 0 ? value.toLocaleString() : "—";

type WorkspaceOption = { id: string; name: string };
type UserOption = { id: string; name: string };

const AiLogsPage = () => {
  const [models, setModels] = useState<AiModelStatusRow[]>([]);
  const [logs, setLogs] = useState<AiErrorLogRow[]>([]);
  const [usage, setUsage] = useState<AiUsageLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter state
  const [filterWorkspace, setFilterWorkspace] = useState<string>("all");
  const [filterUser, setFilterUser] = useState<string>("all");

  // Derived options from loaded usage rows
  const workspaceOptions = useMemo<WorkspaceOption[]>(() => {
    const map = new Map<string, string>();
    usage.forEach((row) => {
      if (row.workspaceId)
        map.set(row.workspaceId, row.workspaceName || row.workspaceId);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [usage]);

  const userOptions = useMemo<UserOption[]>(() => {
    const map = new Map<string, string>();
    usage.forEach((row) => {
      if (row.userId) map.set(row.userId, row.userName || row.userId);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [usage]);

  // Filtered rows (client-side on loaded data)
  const filteredUsage = useMemo(() => {
    return usage.filter((row) => {
      if (filterWorkspace !== "all" && row.workspaceId !== filterWorkspace)
        return false;
      if (filterUser !== "all" && row.userId !== filterUser) return false;
      return true;
    });
  }, [usage, filterWorkspace, filterUser]);

  const usageSummary = useMemo(() => {
    const totalTokens = filteredUsage.reduce(
      (sum, row) => sum + row.totalTokens,
      0
    );
    const totalCached = filteredUsage.reduce(
      (sum, row) => sum + row.cachedTokens,
      0
    );
    return { totalTokens, totalCached, count: filteredUsage.length };
  }, [filteredUsage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [modelRows, errorRows, usageRows] = await Promise.all([
        adminAiLogsApi.listModels(),
        adminAiLogsApi.listErrors({ limit: 150 }),
        adminAiLogsApi.listUsage({ limit: 500 }),
      ]);
      setModels(modelRows);
      setLogs(errorRows);
      setUsage(usageRows);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load AI logs"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefreshModels = async () => {
    setRefreshing(true);
    try {
      const result = await adminAiLogsApi.refreshModels();
      setModels(result.models);
      const failed = result.results.filter((row) => !row.available).length;
      toast.success(
        `Probed ${result.results.length} models · ${failed} unavailable`
      );
      const errorRows = await adminAiLogsApi.listErrors({ limit: 150 });
      setLogs(errorRows);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Model refresh failed"
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ScrollText className="h-7 w-7" />
            AI Logs
          </h1>
          <p className="mt-1 text-muted-foreground">
            Admin-only view of model usage, availability, and generation failures.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Reload
          </Button>
          <Button onClick={() => void handleRefreshModels()} disabled={refreshing}>
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Probe all models
          </Button>
        </div>
      </div>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="errors">Error logs</TabsTrigger>
          <TabsTrigger value="models">Model status</TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Model usage</CardTitle>
              <CardDescription>
                Each successful chat generation — model, bot, tokens, and latency.
                No @bot uses default OpenAI chat model (usually gpt-4o-mini).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filter bar */}
              {!loading && usage.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Workspace</span>
                    <Select value={filterWorkspace} onValueChange={setFilterWorkspace}>
                      <SelectTrigger className="h-8 w-44 text-sm">
                        <SelectValue placeholder="All workspaces" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All workspaces</SelectItem>
                        {workspaceOptions.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">User</span>
                    <Select value={filterUser} onValueChange={setFilterUser}>
                      <SelectTrigger className="h-8 w-40 text-sm">
                        <SelectValue placeholder="All users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All users</SelectItem>
                        {userOptions.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(filterWorkspace !== "all" || filterUser !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => {
                        setFilterWorkspace("all");
                        setFilterUser("all");
                      }}
                    >
                      <X className="h-3 w-3" />
                      Clear filters
                    </Button>
                  )}
                </div>
              )}

              {/* Summary counts */}
              {!loading && filteredUsage.length > 0 ? (
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>
                    <strong className="text-foreground">{usageSummary.count}</strong>{" "}
                    {filterWorkspace !== "all" || filterUser !== "all"
                      ? "filtered"
                      : "recent"}{" "}
                    events
                  </span>
                  <span>
                    <strong className="text-foreground">
                      {usageSummary.totalTokens.toLocaleString()}
                    </strong>{" "}
                    total tokens
                  </span>
                  <span>
                    <strong className="text-foreground">
                      {usageSummary.totalCached.toLocaleString()}
                    </strong>{" "}
                    cached tokens
                  </span>
                </div>
              ) : null}

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : filteredUsage.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {usage.length === 0
                    ? "No usage logged yet. Send a chat message to record model + tokens."
                    : "No results match the current filters."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">When</th>
                        <th className="p-3 text-left font-medium">Brand</th>
                        <th className="p-3 text-left font-medium">Model</th>
                        <th className="p-3 text-left font-medium">Bot</th>
                        <th className="p-3 text-left font-medium">Workspace</th>
                        <th className="p-3 text-left font-medium">User</th>
                        <th className="p-3 text-right font-medium">In</th>
                        <th className="p-3 text-right font-medium">Cached</th>
                        <th className="p-3 text-right font-medium">Out</th>
                        <th className="p-3 text-right font-medium">Total</th>
                        <th className="p-3 text-right font-medium">ms</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredUsage.map((row) => (
                        <tr key={row.id} className="align-top">
                          <td className="whitespace-nowrap p-3 text-muted-foreground">
                            {new Date(row.createdAt).toLocaleString()}
                          </td>
                          <td className="p-3">{row.provider}</td>
                          <td className="p-3 font-mono text-xs">{row.model}</td>
                          <td className="p-3">
                            {row.assistantName ? (
                              row.assistantName
                            ) : (
                              <span className="text-muted-foreground">
                                default chat
                              </span>
                            )}
                          </td>
                          <td className="max-w-[10rem] truncate p-3 text-muted-foreground">
                            {row.workspaceName || row.workspaceId || "—"}
                          </td>
                          <td className="max-w-[8rem] truncate p-3 text-muted-foreground">
                            {row.userName || "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {formatTokens(row.inputTokens)}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {formatTokens(row.cachedTokens)}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {formatTokens(row.outputTokens)}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {formatTokens(row.totalTokens)}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {row.latencyMs != null ? row.latencyMs : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent failures</CardTitle>
              <CardDescription>
                Captured when a bot/model call fails in chat or during probes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No AI errors logged yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">When</th>
                        <th className="p-3 text-left font-medium">Provider</th>
                        <th className="p-3 text-left font-medium">Model</th>
                        <th className="p-3 text-left font-medium">Status</th>
                        <th className="p-3 text-left font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {logs.map((row) => (
                        <tr key={row.id} className="align-top">
                          <td className="whitespace-nowrap p-3 text-muted-foreground">
                            {new Date(row.createdAt).toLocaleString()}
                          </td>
                          <td className="p-3">{row.provider}</td>
                          <td className="p-3 font-mono text-xs">{row.model}</td>
                          <td className="p-3">
                            {row.statusCode != null ? (
                              <Badge variant="destructive">{row.statusCode}</Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="max-w-xl p-3 text-muted-foreground">
                            {row.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Catalog availability</CardTitle>
              <CardDescription>
                Unavailable models are disabled in the bot model dropdown.
                Use “Probe all models” to re-check (uses API quota).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">Brand</th>
                        <th className="p-3 text-left font-medium">Group</th>
                        <th className="p-3 text-left font-medium">Model</th>
                        <th className="p-3 text-left font-medium">Tags</th>
                        <th className="p-3 text-left font-medium">Status</th>
                        <th className="p-3 text-left font-medium">Last error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {models.map((row) => (
                        <tr key={`${row.provider}-${row.id}`}>
                          <td className="p-3">{row.providerLabel}</td>
                          <td className="p-3 text-muted-foreground">
                            {row.group || "—"}
                          </td>
                          <td className="p-3 font-mono text-xs">{row.id}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {(row.tags || []).join(", ") ||
                              row.capabilities.join(", ")}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={row.available ? "secondary" : "destructive"}
                            >
                              {row.available ? "available" : "disabled"}
                            </Badge>
                          </td>
                          <td className="max-w-md p-3 text-muted-foreground">
                            {row.lastError || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AiLogsPage;
