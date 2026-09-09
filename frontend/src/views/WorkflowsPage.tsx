"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  Copy,
  ExternalLink,
  MoreVertical,
  Move,
  Plus,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { workspaceApiService } from "@/lib/apiService";
import type { Workspace } from "@/lib/types";
import { workflowsApi } from "@/modules/workflows/api";
import type { Workflow } from "@/modules/workflows/types";
import { formatWorkflowListMeta } from "@/modules/workflows/workflowListMeta";
import { cn } from "@/lib/utils";

export default function WorkflowsPage() {
  const router = useRouter();
  const { user, hasRole } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [wf, ws] = await Promise.all([
        workflowsApi.list(),
        hasRole(["Admin", "Project Manager"])
          ? workspaceApiService.getAll()
          : workspaceApiService.getByUserId(user.id),
      ]);
      setWorkflows(wf);
      setWorkspaces(ws);
      if (!workspaceId && ws[0]) setWorkspaceId(ws[0].id);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleCreate = async () => {
    if (!name.trim() || !workspaceId) {
      toast.error("Name and workspace are required");
      return;
    }
    setCreating(true);
    try {
      const created = await workflowsApi.create({
        name: name.trim(),
        workspaceId,
      });
      toast.success("Workflow created");
      setOpen(false);
      setName("");
      window.location.href = `/workflows/${created.id}`;
    } catch (error) {
      console.error(error);
      toast.error("Failed to create workflow");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workflow?")) return;
    try {
      await workflowsApi.remove(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      toast.success("Deleted");
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete");
    }
  };

  const handleDuplicate = async (wf: Workflow) => {
    try {
      const created = await workflowsApi.create({
        name: `${wf.name} (copy)`,
        workspaceId: wf.workspaceId,
        description: wf.description || undefined,
        definition: wf.definition,
      });
      setWorkflows((prev) => [created, ...prev]);
      toast.success("Workflow duplicated");
    } catch (error) {
      console.error(error);
      toast.error("Failed to duplicate");
    }
  };

  const handleArchive = async (wf: Workflow) => {
    try {
      const updated = await workflowsApi.update(wf.id, { status: "archived" });
      setWorkflows((prev) =>
        prev.map((w) => (w.id === wf.id ? { ...w, status: updated.status } : w))
      );
      toast.success("Workflow archived");
    } catch (error) {
      console.error(error);
      toast.error("Failed to archive");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Build and run automation graphs powered by AI Core.
          </p>
        </div>
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New workflow
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : workflows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No workflows yet. Create one to open the visual builder.
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className={cn(
                "group flex items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-colors",
                "hover:bg-muted/40"
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => router.push(`/workflows/${wf.id}`)}
              >
                <div className="truncate text-base font-semibold leading-snug">
                  {wf.name}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {formatWorkflowListMeta(wf.updatedAt, wf.createdAt)}
                  {wf.status === "archived" ? " · archived" : ""}
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    aria-label="Workflow actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link href={`/workflows/${wf.id}`}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share…
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <Star className="mr-2 h-4 w-4" />
                    Favorite
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleDuplicate(wf)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <Move className="mr-2 h-4 w-4" />
                    Move
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={wf.status === "archived"}
                    onClick={() => void handleArchive(wf)}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => void handleDelete(wf.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Workspace</Label>
              <Select value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
