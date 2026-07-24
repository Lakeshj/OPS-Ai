"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ScrollText } from "lucide-react";
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
  adminAiLogsApi,
  type AiErrorLogRow,
  type AiModelStatusRow,
  type AiUsageLogRow,
} from "@/modules/adminAiLogs/api";

const formatTokens = (value: number) =>
  value > 0 ? value.toLocaleString() : "—";

const AiLogsPage = () => {
  const [models, setModels] = useState<AiModelStatusRow[]>([]);
  const [logs, setLogs] = useState<AiErrorLogRow[]>([]);
  const [usage, setUsage] = useState<AiUsageLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const usageSummary = useMemo(() => {
    const totalTokens = usage.reduce((sum, row) => sum + row.totalTokens, 0);
    const totalCached = usage.reduce((sum, row) => sum + row.cachedTokens, 0);
    return { totalTokens, totalCached, count: usage.length };
  }, [usage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [modelRows, errorRows, usageRows] = await Promise.all([
        adminAiLogsApi.listModels(),
        adminAiLogsApi.listErrors({ limit: 150 }),
        adminAiLogsApi.listUsage({ limit: 150 }),
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
              {!loading && usage.length > 0 ? (
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>
                    <strong className="text-foreground">{usageSummary.count}</strong>{" "}
                    recent events
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
              ) : usage.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No usage logged yet. Send a chat message to record model + tokens.
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
                        <th className="p-3 text-right font-medium">In</th>
                        <th className="p-3 text-right font-medium">Cached</th>
                        <th className="p-3 text-right font-medium">Out</th>
                        <th className="p-3 text-right font-medium">Total</th>
                        <th className="p-3 text-right font-medium">ms</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {usage.map((row) => (
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
                            {row.workspaceName || row.workspaceId}
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
