import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Workspace, ChatThread, ChatMessage, KeywordAssistant, ThreadFolder } from "@/lib/types";
import { projectService, keywordAssistantService } from "@/lib/services";
import { chatThreadApiService, chatMessageApiService, folderApiService } from "@/lib/apiService";
import { chatService } from "@/lib/chatService";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import {
  MoreHorizontal,
  FolderPlus,
  Folder,
  ChevronRight,
  ChevronDown,
  Edit,
  Trash,
  Plus,
  MessageCircle,
  Move,
  Check,
  X,
  Sparkles,
  Workflow,
} from "lucide-react";

import Sidebar from "@/components/Sidebar";
import { ChatInterface } from "@/components/ChatInterface";
import { workflowsApi } from "@/modules/workflows/api";
import type { Workflow as WorkflowItem } from "@/modules/workflows/types";

type WorkspaceMode = "chat" | "workflow";

const modeFromSearch = (raw: string | null): WorkspaceMode =>
  raw === "workflow" ? "workflow" : "chat";

const ProjectDetailPage = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = (params?.projectId as string) ?? "";
  const { user: currentUser, hasRole } = useAuth();
  const router = useRouter();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() =>
    modeFromSearch(searchParams.get("mode"))
  );
  const [folders, setFolders] = useState<ThreadFolder[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [currentThread, setCurrentThread] = useState<ChatThread | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);

  const [keywordAssistants, setKeywordAssistants] = useState<KeywordAssistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState<KeywordAssistant | undefined>();

  const [folderForm, setFolderForm] = useState({ name: "" });
  const [threadForm, setThreadForm] = useState({ name: "", folderId: "no-folder" });
  const [moveThreadForm, setMoveThreadForm] = useState({ threadId: "", folderId: "no-folder" });
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isCreateThreadOpen, setIsCreateThreadOpen] = useState(false);
  const [isMoveThreadOpen, setIsMoveThreadOpen] = useState(false);

  // Rename states
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingThread, setEditingThread] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Generate auto thread name based on first message
  const generateThreadName = (message: string): string => {
    const words = message.trim().split(/\s+/).slice(0, 4);
    return words.length > 0 ? words.join(' ') + '...' : 'New Chat';
  };

  // Reset workspace-local state when switching workspaces
  useEffect(() => {
    setWorkspace(null);
    setFolders([]);
    setThreads([]);
    setWorkflows([]);
    setCurrentThread(null);
    setSelectedWorkflow(null);
    setMessages([]);
    setWorkspaceMode(modeFromSearch(searchParams.get("mode")));
    // Only reset hard state when the workspace id changes — not when ?mode= updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: projectId only
  }, [projectId]);

  // Keep Chat/Workflow tab in sync with the URL (e.g. Back from workflow editor)
  useEffect(() => {
    setWorkspaceMode(modeFromSearch(searchParams.get("mode")));
  }, [searchParams]);

  const setWorkspaceModeAndUrl = useCallback(
    (mode: WorkspaceMode) => {
      setWorkspaceMode(mode);
      if (!projectId) return;
      const params = new URLSearchParams(searchParams.toString());
      if (mode === "workflow") params.set("mode", "workflow");
      else params.delete("mode");
      const qs = params.toString();
      router.replace(qs ? `/projects/${projectId}?${qs}` : `/projects/${projectId}`, {
        scroll: false,
      });
    },
    [projectId, router, searchParams]
  );

  // Load workspace data
  useEffect(() => {
    let cancelled = false;

    const fetchWorkspaceData = async () => {
      if (!projectId || !currentUser) return;

      setIsLoading(true);

      try {
        const workspaceData = await projectService.get(projectId);
        if (
          !workspaceData ||
          (!hasRole(["Admin", "Project Manager"]) &&
            !workspaceData.assignedUsers.includes(currentUser.id))
        ) {
          if (!cancelled) {
            toast.error("Workspace not found or access denied");
            router.push("/projects");
          }
          return;
        }

        if (!cancelled) {
          setWorkspace(workspaceData);

          const assistants = await keywordAssistantService.getAll();
          if (!cancelled) {
            setKeywordAssistants(assistants);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch workspace:", error);
          toast.error("Failed to load workspace details");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchWorkspaceData();

    return () => {
      cancelled = true;
    };
  }, [projectId, currentUser, hasRole, router]);

  // Load folders and threads
  useEffect(() => {
    const fetchThreadData = async () => {
      if (!projectId || !currentUser || isLoading) return;

      const canViewAll = hasRole(["Admin", "Project Manager"]);

      try {
        const loadedFolders = canViewAll
          ? await folderApiService.getByWorkspaceId(projectId)
          : await folderApiService.getByWorkspaceAndUser(projectId, currentUser.id);
        setFolders(loadedFolders);

        const loadedThreads = canViewAll
          ? await chatThreadApiService.getByWorkspaceId(projectId)
          : await chatThreadApiService.getByUserAndProject(currentUser.id, projectId);
        setThreads(loadedThreads);

        setCurrentThread((prevThread) => {
          if (!prevThread) return loadedThreads[0] || null;
          return (
            loadedThreads.find((thread) => thread.id === prevThread.id) ||
            loadedThreads[0] ||
            null
          );
        });
        if (loadedThreads.length === 0) {
          setMessages([]);
        }
      } catch (error) {
        console.error("Failed to fetch threads:", error);
        toast.error("Failed to load chat threads");
      }
    };

    void fetchThreadData();
  }, [projectId, currentUser, hasRole, isLoading]);

  // Load workflows for this workspace
  useEffect(() => {
    const fetchWorkflows = async () => {
      if (!projectId || !currentUser || isLoading) return;
      try {
        const items = await workflowsApi.list(projectId);
        setWorkflows(items);
        setSelectedWorkflow((prev) => {
          if (!prev) return items[0] || null;
          return items.find((w) => w.id === prev.id) || items[0] || null;
        });
      } catch (error) {
        console.error("Failed to fetch workflows:", error);
      }
    };
    void fetchWorkflows();
  }, [projectId, currentUser, isLoading]);

  const handleCreateWorkflow = async () => {
    if (!projectId) return;
    setIsCreatingWorkflow(true);
    try {
      const created = await workflowsApi.create({
        name: `Workflow ${new Date().toLocaleString()}`,
        workspaceId: projectId,
      });
      setWorkflows((prev) => [created, ...prev]);
      setSelectedWorkflow(created);
      toast.success("Workflow created");
      router.push(`/workflows/${created.id}`);
    } catch (error) {
      console.error(error);
      toast.error("Failed to create workflow");
    } finally {
      setIsCreatingWorkflow(false);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    try {
      await workflowsApi.remove(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      setSelectedWorkflow((prev) => (prev?.id === id ? null : prev));
      toast.success("Workflow deleted");
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete workflow");
    }
  };

  const handleRenameWorkflow = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty");
      return;
    }
    try {
      const updated = await workflowsApi.update(id, { name: trimmed });
      setWorkflows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, name: updated.name } : w))
      );
      setSelectedWorkflow((prev) =>
        prev?.id === id ? { ...prev, name: updated.name } : prev
      );
      setEditingWorkflow(null);
      setEditingName("");
      toast.success("Workflow renamed");
    } catch (error) {
      console.error(error);
      toast.error("Failed to rename workflow");
    }
  };

  // Load messages for current thread
  useEffect(() => {
    const fetchMessages = async () => {
      if (!currentThread) return;

      try {
        const threadMessages = await chatMessageApiService.getByThreadId(currentThread.id);
        setMessages(threadMessages);
      } catch (error) {
        console.error("Failed to fetch messages:", error);
      }
    };

    fetchMessages();
  }, [currentThread]);

  const handleCreateFolder = async () => {
    if (!currentUser || !projectId || !folderForm.name.trim()) return;

    try {
      const newFolder = await folderApiService.create({
        name: folderForm.name,
        workspaceId: projectId,
        createdBy: currentUser.id
      });

      setFolders([...folders, newFolder]);
      setFolderForm({ name: "" });
      setIsCreateFolderOpen(false);
      toast.success("Folder created");
    } catch (error) {
      toast.error("Failed to create folder");
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      const success = await folderApiService.delete(folderId);

      if (success) {
        // Remove threads that were in this folder from local state
        const updatedThreads = threads.filter(thread => thread.folderId !== folderId);
        setThreads(updatedThreads);

        // Remove the folder from local state
        setFolders(folders.filter(folder => folder.id !== folderId));

        // If current thread was in deleted folder, clear it
        if (currentThread && currentThread.folderId === folderId) {
          setCurrentThread(null);
          setMessages([]);
        }

        toast.success("Folder and all contents deleted");
      }
    } catch (error) {
      toast.error("Failed to delete folder");
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    try {
      const success = await chatThreadApiService.delete(threadId);

      if (success) {
        // Remove thread from local state
        const updatedThreads = threads.filter(thread => thread.id !== threadId);
        setThreads(updatedThreads);

        // If deleted thread was current, clear it
        if (currentThread?.id === threadId) {
          setCurrentThread(null);
          setMessages([]);
        }

        toast.success("Thread deleted");
      }
    } catch (error) {
      toast.error("Failed to delete thread");
    }
  };

  const handleRenameFolder = async (folderId: string, newName: string) => {
    if (!newName.trim()) return;

    try {
      const updatedFolder = await folderApiService.update(folderId, { name: newName.trim() });
      if (updatedFolder) {
        setFolders(folders.map(folder =>
          folder.id === folderId
            ? { ...updatedFolder, isExpanded: folder.isExpanded }
            : folder
        ));

        setEditingFolder(null);
        setEditingName("");
        toast.success("Folder renamed");
      }
    } catch (error) {
      toast.error("Failed to rename folder");
    }
  };

  const handleRenameThread = async (threadId: string, newName: string) => {
    if (!newName.trim()) return;

    try {
      const updatedThread = await chatThreadApiService.update(threadId, { name: newName.trim() });
      if (updatedThread) {
        setThreads(threads.map(thread =>
          thread.id === threadId ? updatedThread : thread
        ));

        if (currentThread?.id === threadId) {
          setCurrentThread(updatedThread);
        }

        setEditingThread(null);
        setEditingName("");
        toast.success("Thread renamed");
      }
    } catch (error) {
      toast.error("Failed to rename thread");
    }
  };

  const handleCreateThread = async () => {
    if (!currentUser || !projectId || !threadForm.name.trim()) return;

    try {
      const newThread = await chatThreadApiService.create({
        name: threadForm.name,
        workspaceId: projectId,
        createdBy: currentUser.id,
        folderId: threadForm.folderId === "no-folder" ? undefined : threadForm.folderId,
      });

      setThreads([...threads, newThread]);
      setCurrentThread(newThread);
      setMessages([]);
      setThreadForm({ name: "", folderId: "no-folder" });
      setIsCreateThreadOpen(false);
      toast.success("New thread created");
    } catch (error) {
      toast.error("Failed to create thread");
    }
  };

  const handleMoveThread = async () => {
    const threadId = moveThreadForm.threadId;
    const folderId = moveThreadForm.folderId === "no-folder" ? undefined : moveThreadForm.folderId;

    try {
      const updatedThread = await chatThreadApiService.update(threadId, { folderId });
      if (updatedThread) {
        setThreads(threads.map(thread =>
          thread.id === threadId ? updatedThread : thread
        ));

        setMoveThreadForm({ threadId: "", folderId: "no-folder" });
        setIsMoveThreadOpen(false);
        toast.success("Thread moved");
      }
    } catch (error) {
      toast.error("Failed to move thread");
    }
  };

  const toggleFolder = (folderId: string) => {
    setFolders(folders.map(folder =>
      folder.id === folderId ? { ...folder, isExpanded: !folder.isExpanded } : folder
    ));
  };

  const handleSendMessage = async (userPrompt: string) => {
    if (!userPrompt.trim() || !currentUser) return;

    let thread = currentThread;
    let persistedUserMessage: Awaited<
      ReturnType<typeof chatMessageApiService.create>
    > | null = null;

    try {
      // If no current thread, create a new one with auto-generated name
      if (!thread) {
        const autoName = generateThreadName(userPrompt);
        thread = await chatThreadApiService.create({
          name: autoName,
          workspaceId: projectId!,
          createdBy: currentUser.id,
        });

        setThreads(prev => [...prev, thread!]);
        setCurrentThread(thread);
      }

      persistedUserMessage = await chatMessageApiService.create({
        threadId: thread.id,
        content: userPrompt,
        isUserMessage: true,
      });

      setMessages(prev => [...prev, persistedUserMessage!]);
      setIsGenerating(true);

      // Generate AI response from server-resolved workspace/session memory
      const { response: aiResponse } = await chatService.generateResponse({
        prompt: userPrompt,
        threadId: thread.id,
        assistantId: selectedAssistant?.id,
      });

      const aiMessage = await chatMessageApiService.create({
        threadId: thread.id,
        content: aiResponse,
        isUserMessage: false,
      });

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      if (persistedUserMessage) {
        await chatMessageApiService.delete(persistedUserMessage.id);
        setMessages(prev =>
          prev.filter((message) => message.id !== persistedUserMessage!.id)
        );
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to generate response"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAssistantSelect = (assistant: KeywordAssistant) => {
    setSelectedAssistant(assistant);
    toast.success(`Selected ${assistant.name} assistant`);
  };

  if (isLoading) {
    return (
      <SidebarProvider className="workspace-shell h-svh overflow-hidden">
        <div className="workspace-frame flex h-full w-full overflow-hidden">
          <Sidebar collapsible="icon" />
        <SidebarInset className="workspace-main !min-h-0 h-full overflow-hidden">
            <div className="flex h-full items-center justify-center">
              <div className="h-12 w-12 animate-spin rounded-full border-t-2 border-b-2 border-blue-600" />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    );
  }

  if (!workspace) {
    return (
      <SidebarProvider className="workspace-shell h-svh overflow-hidden">
        <div className="workspace-frame flex h-full w-full overflow-hidden">
          <Sidebar collapsible="icon" />
          <SidebarInset className="workspace-main !min-h-0 h-full overflow-hidden">
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <h2 className="text-2xl font-bold text-foreground">Workspace not found</h2>
              <Button onClick={() => router.push("/projects")} className="mt-4">
                Back to Workspaces
              </Button>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider className="workspace-shell h-svh overflow-hidden">
      <div className="workspace-frame flex h-full w-full overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar collapsible="icon" />
        <SidebarInset className="workspace-main !min-h-0 h-full overflow-hidden">
          <div className="workspace-content flex h-full min-h-0">
            {/* Thread Sidebar */}
            <div className="workspace-thread-sidebar flex h-full w-80 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              {/* Header */}
              <div className="workspace-thread-header shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-3 flex items-center gap-2">
                  <SidebarTrigger className="text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" />
                  <h1 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{workspace.name}</h1>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700/60">
                  <Button
                    type="button"
                    size="sm"
                    variant={workspaceMode === "chat" ? "default" : "ghost"}
                    className="h-8 text-xs"
                    onClick={() => setWorkspaceModeAndUrl("chat")}
                  >
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    Chat
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={workspaceMode === "workflow" ? "default" : "ghost"}
                    className="h-8 text-xs"
                    onClick={() => setWorkspaceModeAndUrl("workflow")}
                  >
                    <Workflow className="mr-1 h-3.5 w-3.5" />
                    Workflow
                  </Button>
                </div>

                {workspaceMode === "chat" ? (
                <div className="flex gap-2">
                  <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="flex-1 text-xs">
                        <FolderPlus className="mr-1 h-3 w-3" />
                        New Folder
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-white dark:bg-gray-800">
                      <DialogHeader>
                        <DialogTitle>Create New Folder</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <Input
                          placeholder="Folder name"
                          value={folderForm.name}
                          onChange={(e) => setFolderForm({ name: e.target.value })}
                        />
                        <Button onClick={handleCreateFolder} className="w-full">
                          Create Folder
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={isCreateThreadOpen} onOpenChange={setIsCreateThreadOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="flex-1 text-xs">
                        <Plus className="mr-1 h-3 w-3" />
                        New Chat
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-white dark:bg-gray-800">
                      <DialogHeader>
                        <DialogTitle>Create New Chat Thread</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <Input
                          placeholder="Thread name"
                          value={threadForm.name}
                          onChange={(e) => setThreadForm({ ...threadForm, name: e.target.value })}
                        />
                        <Select
                          value={threadForm.folderId}
                          onValueChange={(value) => setThreadForm({ ...threadForm, folderId: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select folder (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="no-folder">No folder</SelectItem>
                            {folders.map(folder => (
                              <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button onClick={handleCreateThread} className="w-full">
                          Create Thread
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                ) : (
                  <Button
                    size="sm"
                    className="w-full text-xs"
                    onClick={handleCreateWorkflow}
                    disabled={isCreatingWorkflow}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {isCreatingWorkflow ? "Creating..." : "New Workflow"}
                  </Button>
                )}
              </div>

              {/* Thread / Workflow list */}
              <div className="workspace-thread-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {workspaceMode === "workflow" ? (
                  <div className="box-border space-y-1 p-3">
                    {workflows.map((wf) => (
                      <div
                        key={wf.id}
                        className={cn(
                          "group flex w-full min-w-0 max-w-full cursor-pointer items-start gap-2 rounded-xl p-2.5 text-sm transition-all hover:bg-gray-50 dark:hover:bg-gray-700",
                          selectedWorkflow?.id === wf.id
                            ? "bg-gray-100 dark:bg-gray-700"
                            : "bg-white dark:bg-gray-800"
                        )}
                        onClick={() =>
                          editingWorkflow !== wf.id && setSelectedWorkflow(wf)
                        }
                      >
                        <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
                        {editingWorkflow === wf.id ? (
                          <div
                            className="flex min-w-0 flex-1 items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="h-7 min-w-0 flex-1 text-xs"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void handleRenameWorkflow(wf.id, editingName);
                                } else if (e.key === "Escape") {
                                  setEditingWorkflow(null);
                                  setEditingName("");
                                }
                              }}
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => void handleRenameWorkflow(wf.id, editingName)}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { setEditingWorkflow(null); setEditingName(""); }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="line-clamp-2 break-words font-medium leading-snug text-gray-700 dark:text-gray-200">
                                {wf.name}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {wf.definition?.nodes?.length || 0} nodes ·{" "}
                                {wf.status}
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="mt-0.5 h-8 w-8 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                                  aria-label="Workflow actions"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="z-50">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingWorkflow(wf.id);
                                    setEditingName(wf.name);
                                  }}
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onSelect={(e) => e.preventDefault()}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Trash className="mr-2 h-4 w-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete &quot;{wf.name}&quot;? This cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => void handleDeleteWorkflow(wf.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
                    ))}
                    {workflows.length === 0 && (
                      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                        <Workflow className="mx-auto mb-2 h-8 w-8 text-gray-400 dark:text-gray-500" />
                        <p className="text-sm">No workflows yet</p>
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                          Create a workflow to open the visual builder
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                <div className="p-3 space-y-1">
                  {/* Threads without folders */}
                  {threads.filter(thread => !thread.folderId).map((thread) => (
                    <div
                      key={thread.id}
                      className={cn(
                        "group flex items-center justify-between p-3 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all cursor-pointer",
                        currentThread?.id === thread.id ? "bg-gray-100 dark:bg-gray-700" : "bg-white dark:bg-gray-800"
                      )}
                      onClick={() => !editingThread && setCurrentThread(thread)}
                    >
                      <div className="flex items-center min-w-0 flex-1">
                        <MessageCircle className="h-4 w-4 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" />
                        {editingThread === thread.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="h-6 text-xs"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleRenameThread(thread.id, editingName);
                                } else if (e.key === 'Escape') {
                                  setEditingThread(null);
                                  setEditingName("");
                                }
                              }}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRenameThread(thread.id, editingName);
                              }}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingThread(null);
                                setEditingName("");
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="truncate text-gray-700 dark:text-gray-200 font-medium">{thread.name}</span>
                        )}
                      </div>
                      {!editingThread && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 opacity-100 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-gray-100">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setMoveThreadForm({ threadId: thread.id, folderId: "no-folder" });
                                setIsMoveThreadOpen(true);
                              }}
                            >
                              <Move className="h-4 w-4 mr-2" />
                              Move to Folder
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingThread(thread.id);
                                setEditingName(thread.name);
                              }}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={(e) => e.preventDefault()}
                                >
                                  <Trash className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Thread</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this thread? This will also delete all messages in the thread. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteThread(thread.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  ))}

                  {/* Folders with threads */}
                  {folders.map((folder) => (
                    <div key={folder.id} className="space-y-1">
                      <div className="group flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg">
                        <button
                          onClick={() => !editingFolder && toggleFolder(folder.id)}
                          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200 flex-1 font-medium"
                        >
                          {folder.isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <Folder className="h-4 w-4" />
                          {editingFolder === folder.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <Input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="h-6 text-xs"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleRenameFolder(folder.id, editingName);
                                  } else if (e.key === 'Escape') {
                                    setEditingFolder(null);
                                    setEditingName("");
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRenameFolder(folder.id, editingName);
                                }}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingFolder(null);
                                  setEditingName("");
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-medium">{folder.name}</span>
                          )}
                        </button>
                        {!editingFolder && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 opacity-100 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-gray-100">
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingFolder(folder.id);
                                  setEditingName(folder.name);
                                }}
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onSelect={(e) => e.preventDefault()}
                                  >
                                    <Trash className="h-4 w-4 mr-2" />
                                    Delete Folder
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Folder</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete this folder? This will also delete all threads and messages inside the folder. This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteFolder(folder.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {folder.isExpanded && (
                        <div className="ml-6 space-y-1">
                          {threads
                            .filter(thread => thread.folderId === folder.id)
                            .map((thread) => (
                              <div
                                key={thread.id}
                                className={cn(
                                  "group flex items-center justify-between p-3 text-sm rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all cursor-pointer",
                                  currentThread?.id === thread.id ? "bg-gray-100 dark:bg-gray-700" : "bg-white dark:bg-gray-800"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!editingThread) setCurrentThread(thread);
                                }}
                              >
                                <div className="flex items-center min-w-0 flex-1">
                                  <MessageCircle className="h-4 w-4 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" />
                                  {editingThread === thread.id ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <Input
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        className="h-6 text-xs"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            handleRenameThread(thread.id, editingName);
                                          } else if (e.key === 'Escape') {
                                            setEditingThread(null);
                                            setEditingName("");
                                          }
                                        }}
                                      />
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRenameThread(thread.id, editingName);
                                        }}
                                      >
                                        <Check className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingThread(null);
                                          setEditingName("");
                                        }}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="truncate text-gray-700 dark:text-gray-200 font-medium">{thread.name}</span>
                                  )}
                                </div>
                                {!editingThread && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 opacity-100 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-gray-100">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setMoveThreadForm({ threadId: thread.id, folderId: thread.folderId || "no-folder" });
                                          setIsMoveThreadOpen(true);
                                        }}
                                      >
                                        <Move className="h-4 w-4 mr-2" />
                                        Move to Folder
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setEditingThread(thread.id);
                                          setEditingName(thread.name);
                                        }}
                                      >
                                        <Edit className="h-4 w-4 mr-2" />
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <DropdownMenuItem
                                            className="text-destructive"
                                            onSelect={(e) => e.preventDefault()}
                                          >
                                            <Trash className="h-4 w-4 mr-2" />
                                            Delete
                                          </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Delete Thread</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              Are you sure you want to delete this thread? This will also delete all messages in the thread. This action cannot be undone.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => handleDeleteThread(thread.id)}
                                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                              Delete
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {threads.length === 0 && (
                    <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                      <MessageCircle className="h-8 w-8 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                      <p className="text-sm">No chat threads yet</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create your first thread to get started</p>
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>

            {/* Main chat / workflow area */}
            <div className="workspace-chat-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {workspaceMode === "workflow" ? (
                selectedWorkflow ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 bg-white p-6 text-center dark:bg-gray-900">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/20">
                      <Workflow className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="mb-1 text-xl font-medium text-gray-800 dark:text-gray-100">
                        {selectedWorkflow.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedWorkflow.definition?.nodes?.length || 0} nodes ·{" "}
                        {selectedWorkflow.status}
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => router.push(`/workflows/${selectedWorkflow.id}`)}
                    >
                      Open workflow builder
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center bg-white p-4 text-center dark:bg-gray-900">
                    <Workflow className="mb-3 h-10 w-10 text-gray-400" />
                    <h3 className="mb-2 text-xl font-medium text-gray-700 dark:text-gray-200">
                      Select a workflow
                    </h3>
                    <p className="max-w-md text-gray-500 dark:text-gray-400">
                      Choose a workflow from the sidebar or create a new one. Chat and
                      Workflow stay separate under this workspace.
                    </p>
                  </div>
                )
              ) : currentThread ? (
                <>
                  {/* Chat header */}
                  <div className="workspace-chat-header shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-gray-900 dark:text-white">{currentThread.name}</h2>
                      {selectedAssistant && (
                        <div className="flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 dark:bg-purple-900/20">
                          <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          <span className="text-sm text-purple-700 dark:text-purple-300">{selectedAssistant.name}</span>
                          <button
                            onClick={() => setSelectedAssistant(undefined)}
                            className="text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chat Interface (includes messages + composer) */}
                  <div className="workspace-chat-body min-h-0 flex-1 overflow-hidden bg-white dark:bg-gray-900">
                    <ChatInterface
                      messages={messages}
                      onSendMessage={handleSendMessage}
                      isGenerating={isGenerating}
                      selectedAssistant={selectedAssistant}
                      onAssistantSelect={handleAssistantSelect}
                      availableAssistants={keywordAssistants}
                    />
                  </div>
                </>
              ) : (
                <div className="workspace-chat-empty flex h-full flex-col items-center justify-center bg-white p-4 text-center dark:bg-gray-900">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                    <MessageCircle className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                  </div>
                  <h3 className="mb-2 text-xl font-medium text-gray-700 dark:text-gray-200">Select a chat thread</h3>
                  <p className="max-w-md text-gray-500 dark:text-gray-400">
                    Choose a thread from the sidebar or create a new one to start chatting with AI assistants
                  </p>
                </div>
              )}
            </div>

            {/* Move Thread Dialog */}
            <Dialog open={isMoveThreadOpen} onOpenChange={setIsMoveThreadOpen}>
              <DialogContent className="bg-white dark:bg-gray-800">
                <DialogHeader>
                  <DialogTitle>Move Thread to Folder</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <Select
                    value={moveThreadForm.folderId}
                    onValueChange={(value) => setMoveThreadForm({ ...moveThreadForm, folderId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select destination folder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-folder">No folder (root level)</SelectItem>
                      {folders.map(folder => (
                        <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsMoveThreadOpen(false)} className="flex-1">
                      Cancel
                    </Button>
                    <Button onClick={handleMoveThread} className="flex-1">
                      Move Thread
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default ProjectDetailPage;
