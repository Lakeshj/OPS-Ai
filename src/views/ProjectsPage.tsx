
import { useState, useEffect } from "react";
import Link from "next/link";
import { projectService, userService } from "@/lib/services";
import { workspaceDocumentApiService } from "@/modules/documents/api";
import { Workspace, User } from "@/lib/types";
import { WorkspaceDocumentField } from "@/components/WorkspaceDocumentField";
import { WorkspaceSummaryPanel } from "@/components/WorkspaceSummaryPanel";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  FolderPlus,
  Search,
  Users,
  CalendarDays,
  MessageCircle,
  Edit2,
  Trash2,
  MoreVertical
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const getDisplayAssignedUsers = (
  assignedUserIds: string[],
  users: User[],
  createdBy?: string
): User[] => {
  return users.filter(
    (user) =>
      assignedUserIds.includes(user.id) &&
      user.id !== createdBy &&
      user.role !== "Admin"
  );
};

const getDisplayAssignedUserIds = (
  assignedUserIds: string[],
  users: User[],
  createdBy?: string
): string[] => {
  if (users.length === 0) {
    return assignedUserIds.filter((id) => id !== createdBy);
  }
  return getDisplayAssignedUsers(assignedUserIds, users, createdBy).map(
    (user) => user.id
  );
};

interface TeamMemberPickerProps {
  users: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeUserId?: string;
}

const TeamMemberPicker = ({
  users,
  selectedIds,
  onChange,
  excludeUserId,
}: TeamMemberPickerProps) => {
  const [search, setSearch] = useState("");

  const filteredUsers = users.filter((user) => {
    if (user.id === excludeUserId) return false;
    if (user.role === "Admin") return false;
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      user.role.toLowerCase().includes(query)
    );
  });

  const toggleUser = (userId: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedIds, userId]);
      return;
    }
    onChange(selectedIds.filter((id) => id !== userId));
  };

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search by name, email, or role..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ScrollArea className="h-[220px] rounded-md border border-border dark:border-gray-700">
        <div className="p-2 space-y-1">
          {filteredUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No users found
            </p>
          ) : (
            filteredUsers.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60 dark:hover:bg-gray-700/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.includes(user.id)}
                  onCheckedChange={(checked) =>
                    toggleUser(user.id, checked === true)
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground dark:text-white truncate">
                    {user.name}
                  </p>
                  <p className="text-xs text-muted-foreground dark:text-gray-400">
                    {user.role} · {user.email}
                  </p>
                </div>
              </label>
            ))
          )}
        </div>
      </ScrollArea>
      <p className="text-xs text-muted-foreground dark:text-gray-400">
        {selectedIds.length} selected · Admins have access to all workspaces
      </p>
    </div>
  );
};

const ProjectsPage = () => {
  const { user: currentUser, hasRole } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [filteredWorkspaces, setFilteredWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editDialogTab, setEditDialogTab] = useState<
    "details" | "documents" | "summary"
  >("details");
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [formValues, setFormValues] = useState({
    name: "",
    description: "",
    assignedUsers: [] as string[],
  });

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        let fetchedWorkspaces: Workspace[] = [];

        if (currentUser) {
          if (hasRole(["Admin", "Project Manager"])) {
            const users = await userService.getAll();
            setAllUsers(users);
            fetchedWorkspaces = await projectService.getAll();
          } else {
            fetchedWorkspaces = await projectService.getByUserId(currentUser.id);
          }
        }

        setWorkspaces(fetchedWorkspaces);
        setFilteredWorkspaces(fetchedWorkspaces);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        toast.error("Failed to load workspaces");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [currentUser, hasRole]);

  useEffect(() => {
    // Filter workspaces when search query changes
    if (searchQuery.trim() === "") {
      setFilteredWorkspaces(workspaces);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = workspaces.filter(
        (workspace) =>
          workspace.name.toLowerCase().includes(query) ||
          workspace.description.toLowerCase().includes(query)
      );
      setFilteredWorkspaces(filtered);
    }
  }, [searchQuery, workspaces]);

  const uploadWorkspaceFiles = async (
    workspaceId: string,
    files: File[]
  ): Promise<number> => {
    let failedUploads = 0;

    for (const file of files) {
      try {
        await workspaceDocumentApiService.upload(workspaceId, file);
      } catch (error) {
        failedUploads += 1;
        console.error(`Failed to upload ${file.name}:`, error);
      }
    }

    return failedUploads;
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser) return;

    setIsSaving(true);
    try {
      const newWorkspace = await projectService.create({
        name: formValues.name,
        description: formValues.description,
        createdBy: currentUser.id,
        assignedUsers: [
          currentUser.id,
          ...formValues.assignedUsers.filter((id) => {
            if (id === currentUser.id) return false;
            const user = allUsers.find((u) => u.id === id);
            return user?.role !== "Admin";
          }),
        ],
      });

      const failedUploads = await uploadWorkspaceFiles(
        newWorkspace.id,
        pendingFiles
      );

      setWorkspaces([...workspaces, newWorkspace]);
      setFilteredWorkspaces([...filteredWorkspaces, newWorkspace]);
      if (failedUploads > 0) {
        toast.warning(
          `Workspace created, but ${failedUploads} document upload(s) failed`
        );
      } else {
        toast.success(
          pendingFiles.length > 0
            ? "Workspace and documents created successfully"
            : "Workspace created successfully"
        );
      }
      setIsCreateDialogOpen(false);
      setPendingFiles([]);
      setFormValues({
        name: "",
        description: "",
        assignedUsers: [],
      });
    } catch (error) {
      console.error("Failed to create workspace:", error);
      toast.error("Failed to create workspace");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editingWorkspace) return;

    setIsSaving(true);
    try {
      const updatedWorkspace = await projectService.update(editingWorkspace.id, {
        name: formValues.name,
        description: formValues.description,
        assignedUsers: [
          editingWorkspace.createdBy,
          ...formValues.assignedUsers.filter((id) => {
            if (id === editingWorkspace.createdBy) return false;
            const user = allUsers.find((u) => u.id === id);
            return user?.role !== "Admin";
          }),
        ],
      });

      if (updatedWorkspace) {
        const failedUploads = await uploadWorkspaceFiles(
          updatedWorkspace.id,
          pendingFiles
        );
        const updatedWorkspaces = workspaces.map(w => 
          w.id === editingWorkspace.id ? updatedWorkspace : w
        );
        setWorkspaces(updatedWorkspaces);
        setFilteredWorkspaces(updatedWorkspaces);
        if (failedUploads > 0) {
          toast.warning(
            `Workspace updated, but ${failedUploads} document upload(s) failed`
          );
        } else {
          toast.success(
            pendingFiles.length > 0
              ? "Workspace and documents updated successfully"
              : "Workspace updated successfully"
          );
        }
        setIsEditDialogOpen(false);
        setEditingWorkspace(null);
        setPendingFiles([]);
        setFormValues({
          name: "",
          description: "",
          assignedUsers: [],
        });
      }
    } catch (error) {
      console.error("Failed to update workspace:", error);
      toast.error("Failed to update workspace");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    if (!confirm(`Are you sure you want to delete "${workspace.name}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      const success = await projectService.delete(workspace.id);
      
      if (success) {
        const updatedWorkspaces = workspaces.filter(w => w.id !== workspace.id);
        setWorkspaces(updatedWorkspaces);
        setFilteredWorkspaces(updatedWorkspaces);
        toast.success("Workspace deleted successfully");
      }
    } catch (error) {
      console.error("Failed to delete workspace:", error);
      toast.error("Failed to delete workspace");
    }
  };

  const openEditDialog = (workspace: Workspace) => {
    setEditingWorkspace(workspace);
    setPendingFiles([]);
    setFormValues({
      name: workspace.name,
      description: workspace.description,
      assignedUsers: getDisplayAssignedUserIds(
        workspace.assignedUsers,
        allUsers,
        workspace.createdBy
      ),
    });
    setEditDialogTab("details");
    setIsEditDialogOpen(true);
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    setIsCreateDialogOpen(open);
    if (!open && !isSaving) setPendingFiles([]);
  };

  const handleEditDialogOpenChange = (open: boolean) => {
    setIsEditDialogOpen(open);
    if (!open && !isSaving) {
      setPendingFiles([]);
      setEditingWorkspace(null);
      setEditDialogTab("details");
    }
  };

  const canManageWorkspaceSummary = (workspace: Workspace | null) =>
    Boolean(
      workspace &&
        currentUser &&
        (currentUser.role === "Admin" ||
          (currentUser.role === "Project Manager" &&
            workspace.createdBy === currentUser.id))
    );

  const canCreateWorkspaces = hasRole(["Admin", "Project Manager"]);
  const canEditWorkspaces = hasRole(["Admin", "Project Manager"]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  const getAssignedTeamLabel = (workspace: Workspace): string => {
    const assigned = getDisplayAssignedUsers(
      workspace.assignedUsers,
      allUsers,
      workspace.createdBy
    );
    return assigned.map((user) => user.name).join(", ") || "No team members assigned";
  };

  return (
    <div className="p-6 space-y-6 bg-background dark:bg-gray-900 min-h-full">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground dark:text-white">Workspaces</h1>
          <p className="text-muted-foreground dark:text-gray-400 mt-1">
            Browse and manage your workspaces
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search workspaces..."
              className="pl-10 w-full sm:w-72 bg-card dark:bg-gray-800 border-border dark:border-gray-700"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          {canCreateWorkspaces && (
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={handleCreateDialogOpenChange}
            >
              <DialogTrigger asChild>
                <Button className="flex items-center bg-blue-500 hover:bg-blue-600">
                  <FolderPlus className="mr-2 h-4 w-4" />
                  New Workspace
                </Button>
              </DialogTrigger>
              <DialogContent className="workspace-create-dialog max-h-[90svh] overflow-y-auto bg-card dark:bg-gray-800 border-border dark:border-gray-700 sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-foreground dark:text-white">Create New Workspace</DialogTitle>
                  <DialogDescription className="text-muted-foreground dark:text-gray-400">
                    Add a new workspace and assign team members
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateWorkspace} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Workspace Name</Label>
                    <Input
                      id="name"
                      value={formValues.name}
                      onChange={(e) =>
                        setFormValues({ ...formValues, name: e.target.value })
                      }
                      placeholder="Website Redesign"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formValues.description}
                      onChange={(e) =>
                        setFormValues({
                          ...formValues,
                          description: e.target.value,
                        })
                      }
                      placeholder="A brief description of the workspace..."
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Assign Team Members</Label>
                    <TeamMemberPicker
                      users={allUsers}
                      selectedIds={formValues.assignedUsers}
                      onChange={(assignedUsers) =>
                        setFormValues({ ...formValues, assignedUsers })
                      }
                      excludeUserId={currentUser?.id}
                    />
                  </div>
                  <WorkspaceDocumentField
                    pendingFiles={pendingFiles}
                    onPendingFilesChange={setPendingFiles}
                    disabled={isSaving}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSaving}
                      onClick={() => handleCreateDialogOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSaving}>
                      {isSaving ? "Creating…" : "Create Workspace"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={handleEditDialogOpenChange}
      >
        <DialogContent className="workspace-edit-dialog max-h-[90svh] overflow-x-hidden overflow-y-auto bg-card dark:bg-gray-800 border-border dark:border-gray-700 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground dark:text-white">Edit Workspace</DialogTitle>
            <DialogDescription className="text-muted-foreground dark:text-gray-400">
              Update workspace details, documents, and system summary quality
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={editDialogTab}
            onValueChange={(value) =>
              setEditDialogTab(value as "details" | "documents" | "summary")
            }
            className="workspace-edit-tabs min-w-0 max-w-full overflow-x-hidden pt-2"
          >
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-lg border border-border bg-muted/80 p-1 dark:border-gray-600 dark:bg-gray-900">
              <TabsTrigger
                value="details"
                className="text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-none dark:text-gray-300 dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white"
              >
                Details
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                className="text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-none dark:text-gray-300 dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white"
              >
                Documents
              </TabsTrigger>
              <TabsTrigger
                value="summary"
                className="text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-none dark:text-gray-300 dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white"
              >
                Summary
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="min-w-0 overflow-x-hidden">
              <form onSubmit={handleEditWorkspace} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Workspace Name</Label>
                  <Input
                    id="name"
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues({ ...formValues, name: e.target.value })
                    }
                    placeholder="Website Redesign"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formValues.description}
                    onChange={(e) =>
                      setFormValues({
                        ...formValues,
                        description: e.target.value,
                      })
                    }
                    placeholder="A brief description of the workspace..."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Assign Team Members</Label>
                  <TeamMemberPicker
                    users={allUsers}
                    selectedIds={formValues.assignedUsers}
                    onChange={(assignedUsers) =>
                      setFormValues({ ...formValues, assignedUsers })
                    }
                    excludeUserId={currentUser?.id}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => handleEditDialogOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? "Updating…" : "Update Workspace"}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>

            <TabsContent
              value="documents"
              className="min-w-0 space-y-4 overflow-x-hidden pt-2"
            >
              <WorkspaceDocumentField
                workspaceId={editingWorkspace?.id}
                pendingFiles={pendingFiles}
                onPendingFilesChange={setPendingFiles}
                disabled={isSaving}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => handleEditDialogOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={isSaving || pendingFiles.length === 0}
                  onClick={async () => {
                    if (!editingWorkspace) return;
                    setIsSaving(true);
                    try {
                      const failedUploads = await uploadWorkspaceFiles(
                        editingWorkspace.id,
                        pendingFiles
                      );
                      if (failedUploads > 0) {
                        toast.warning(
                          `${failedUploads} document upload(s) failed`
                        );
                      } else {
                        toast.success("Documents uploaded successfully");
                      }
                      setPendingFiles([]);
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  {isSaving ? "Uploading…" : "Upload Documents"}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent
              value="summary"
              className="workspace-edit-summary-tab min-w-0 max-w-full overflow-x-hidden pt-2"
            >
              {editingWorkspace ? (
                <WorkspaceSummaryPanel
                  workspaceId={editingWorkspace.id}
                  canManage={canManageWorkspaceSummary(editingWorkspace)}
                  active={isEditDialogOpen && editDialogTab === "summary"}
                  compact
                />
              ) : null}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {filteredWorkspaces.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWorkspaces.map((workspace) => (
            <Card key={workspace.id} className="h-full bg-card dark:bg-gray-800 border-border dark:border-gray-700 hover:shadow-lg transition-all hover:border-blue-300 dark:hover:border-blue-600">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <Link href={`/projects/${workspace.id}`}>
                      <CardTitle className="text-foreground dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{workspace.name}</CardTitle>
                    </Link>
                  </div>
                  {canEditWorkspaces && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-accent dark:hover:bg-gray-700">
                          <MoreVertical size={16} className="text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-card dark:bg-gray-800 border-border dark:border-gray-700">
                        <DropdownMenuItem 
                          onClick={() => openEditDialog(workspace)}
                          className="hover:bg-accent dark:hover:bg-gray-700 text-foreground dark:text-white"
                        >
                          <Edit2 size={16} className="mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDeleteWorkspace(workspace)}
                          className="hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400"
                        >
                          <Trash2 size={16} className="mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <CardDescription className="line-clamp-2 text-muted-foreground dark:text-gray-400">
                  {workspace.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col space-y-3">
                  <div className="flex items-center text-sm">
                    <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="text-left">
                          <span className="truncate mr-1 text-muted-foreground dark:text-gray-400">
                            {getDisplayAssignedUserIds(
                              workspace.assignedUsers,
                              allUsers,
                              workspace.createdBy
                            ).length}{" "}
                            assigned
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs bg-card dark:bg-gray-800 border-border dark:border-gray-700">
                          <p className="text-foreground dark:text-white">
                            {getAssignedTeamLabel(workspace)}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex items-center text-sm">
                    <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground dark:text-gray-400">
                      Created on{" "}
                      {new Date(workspace.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <Badge
                      variant="outline"
                      className="flex items-center border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                    >
                      <MessageCircle className="h-3 w-3 mr-1" />
                      Open Workspace
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-card dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
          <div className="rounded-full bg-muted dark:bg-gray-700 p-3">
            <FolderPlus className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-medium text-foreground dark:text-white">No workspaces found</h3>
          <p className="mt-1 text-sm text-muted-foreground dark:text-gray-400">
            {searchQuery
              ? "No workspaces match your search criteria."
              : canCreateWorkspaces
              ? "Get started by creating a new workspace."
              : "You don't have any workspaces assigned yet. Ask your Admin or Project Manager to assign you to a workspace."}
          </p>
          {canCreateWorkspaces && searchQuery === "" && (
            <Button
              className="mt-4 bg-blue-500 hover:bg-blue-600"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              Create New Workspace
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;
