"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Workflow as WorkflowIcon } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import { workspaceApiService } from "@/lib/apiService";
import type { Workspace } from "@/lib/types";
import { workflowsApi } from "@/modules/workflows/api";
import type { Workflow } from "@/modules/workflows/types";

export default function WorkflowsPage() {
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workflows.map((wf) => (
            <div key={wf.id} className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <WorkflowIcon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Link
                      href={`/workflows/${wf.id}`}
                      className="font-medium hover:underline"
                    >
                      {wf.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {wf.status} · {wf.definition?.nodes?.length || 0} nodes
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDelete(wf.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/workflows/${wf.id}`}>Open builder</Link>
              </Button>
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
