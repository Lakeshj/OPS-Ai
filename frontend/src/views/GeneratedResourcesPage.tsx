"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Film,
  ImageIcon,
  Images,
  RefreshCw,
  Trash2,
} from "lucide-react";
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
  generatedMediaApi,
  type GeneratedMediaItem,
  type GeneratedMediaStats,
} from "@/modules/generatedMedia/api";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const GeneratedResourcesPage = () => {
  const [items, setItems] = useState<GeneratedMediaItem[]>([]);
  const [stats, setStats] = useState<GeneratedMediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await generatedMediaApi.list();
      setItems(data.items);
      setStats(data.stats);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load media"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((row) => row.kind === filter);
  }, [items, filter]);

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`Delete ${filename}? This cannot be undone.`)) return;
    setDeleting(filename);
    try {
      await generatedMediaApi.remove(filename);
      toast.success("Deleted");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Delete failed"
      );
    } finally {
      setDeleting(null);
    }
  };

  const handlePurge = async (kind: "all" | "image" | "video") => {
    const label =
      kind === "all" ? "all generated files" : `all ${kind} files`;
    if (
      !window.confirm(
        `Delete ${label}? Chat messages may still show broken media links.`
      )
    ) {
      return;
    }
    setDeleting(`purge:${kind}`);
    try {
      const result = await generatedMediaApi.purge(kind);
      toast.success(`Deleted ${result.deleted} file(s)`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Purge failed"
      );
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Images className="h-7 w-7" />
            Generated resources
          </h1>
          <p className="mt-1 text-muted-foreground">
            Browse, download, and delete AI-generated images and videos to free
            disk space.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => void handlePurge("image")}
            disabled={!!deleting || !stats?.imageCount}
          >
            Clear images
          </Button>
          <Button
            variant="outline"
            onClick={() => void handlePurge("video")}
            disabled={!!deleting || !stats?.videoCount}
          >
            Clear videos
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handlePurge("all")}
            disabled={!!deleting || !stats?.count}
          >
            Clear all
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total files</CardDescription>
            <CardTitle>{stats?.count ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {stats ? `${formatBytes(stats.totalBytes)} on disk` : "Loading…"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Images</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              {stats?.imageCount ?? "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Videos</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5" />
              {stats?.videoCount ?? "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs
        value={filter}
        onValueChange={(value) =>
          setFilter(value as "all" | "image" | "video")
        }
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="image">Images</TabsTrigger>
          <TabsTrigger value="video">Videos</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No generated {filter === "all" ? "media" : `${filter}s`} yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((item) => (
                <Card key={item.filename} className="overflow-hidden">
                  <div className="flex h-44 items-center justify-center bg-muted/40">
                    {item.kind === "video" ? (
                      <video
                        src={item.url}
                        controls
                        className="h-full w-full object-contain bg-black"
                      />
                    ) : item.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.url}
                        alt={item.filename}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {item.mimeType}
                      </span>
                    )}
                  </div>
                  <CardHeader className="space-y-1 pb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{item.kind}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </div>
                    <CardDescription className="truncate font-mono text-xs">
                      {item.filename}
                    </CardDescription>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleString()}
                    </p>
                  </CardHeader>
                  <CardContent className="flex gap-2 pb-4">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <a
                        href={`${item.url}${item.url.includes("?") ? "&" : "?"}download=1`}
                        download={item.filename}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Download
                      </a>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleting === item.filename}
                      onClick={() => void handleDelete(item.filename)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GeneratedResourcesPage;
