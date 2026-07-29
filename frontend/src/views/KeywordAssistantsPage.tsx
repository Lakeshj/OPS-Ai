
import { useState, useEffect } from "react";
import { keywordAssistantService } from "@/lib/services";
import {
  ASSISTANT_TEMPLATES,
  getTemplateByName,
} from "@/lib/keywordAssistantService";
import { KeywordAssistant } from "@/lib/types";
import { TaskTypeField } from "@/components/TaskTypeField";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SystemPromptsPanel } from "@/components/SystemPromptsPanel";
import { BotProviderModelFields } from "@/components/BotProviderModelFields";
import { BotQualityDialog } from "@/components/BotQualityDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  inferProviderFromModel,
  normalizeSelection,
  resolveDefaultSelection,
} from "@/modules/assistants/aiProviders";
import { 
  PlusCircle, 
  Edit, 
  Trash, 
  MoreHorizontal, 
  Search, 
  MessageSquare,
  Import,
  Copy,
  Bot,
  FileText,
  Sparkles,
} from "lucide-react";

const scoreBadgeClass = (score: number | null | undefined) => {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 80) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (score >= 60) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-400";
};

/** Keep card badge aligned with popup: weighted category average when present. */
const resolveDisplayQualityScore = (assistant: KeywordAssistant) => {
  const categories = assistant.qualityDetails?.categories;
  if (!categories || typeof categories !== "object") {
    return assistant.qualityScore == null
      ? null
      : Number(assistant.qualityScore);
  }

  const weights: Record<string, number> = {
    role_clarity: 20,
    prompt_quality: 25,
    capability_fit: 15,
    instruction_strength: 15,
    workspace_usefulness: 15,
    safety_guardrails: 10,
  };

  let totalWeight = 0;
  let weighted = 0;
  let maxScore = 0;
  const rows: { score: number; weight: number }[] = [];

  for (const [key, value] of Object.entries(categories)) {
    const score =
      typeof value === "number"
        ? value
        : value && typeof value === "object"
          ? Number((value as { score?: number }).score)
          : NaN;
    if (!Number.isFinite(score)) continue;
    maxScore = Math.max(maxScore, score);
    rows.push({ score, weight: weights[key] || 1 });
  }

  if (rows.length === 0) {
    return assistant.qualityScore == null
      ? null
      : Number(assistant.qualityScore);
  }

  const scale = maxScore > 0 && maxScore <= 10 ? 10 : 1;
  for (const row of rows) {
    weighted += row.score * scale * row.weight;
    totalWeight += row.weight;
  }

  return totalWeight > 0 ? Math.round(weighted / totalWeight) : null;
};

const QualityScoreTag = ({
  score,
  title,
  onClick,
}: {
  score?: number | null;
  title?: string;
  onClick?: () => void;
}) => {
  if (score == null) {
    return (
      <Badge
        variant="outline"
        className={`text-xs text-muted-foreground ${onClick ? "cursor-pointer hover:bg-muted" : ""}`}
        title={title}
        onClick={onClick}
      >
        No score
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className={`text-xs font-semibold tabular-nums ${scoreBadgeClass(score)} ${onClick ? "cursor-pointer hover:opacity-90" : ""}`}
      title={title || "View category scores"}
      onClick={onClick}
    >
      {Math.round(score)}/100
    </Badge>
  );
};

const KeywordAssistantsPage = () => {
  const { hasRole, canManageSystemPromptLifecycle } = useAuth();
  const isAdmin = hasRole("Admin");
  const [assistants, setAssistants] = useState<KeywordAssistant[]>([]);
  const [filteredAssistants, setFilteredAssistants] = useState<KeywordAssistant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [qualityAssistant, setQualityAssistant] =
    useState<KeywordAssistant | null>(null);
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [isImportMode, setIsImportMode] = useState(false);
  const [currentAssistant, setCurrentAssistant] = useState<KeywordAssistant | null>(null);
  const [currentCategory, setCurrentCategory] = useState<string>("all");
  
  const [formValues, setFormValues] = useState({
    name: "",
    taskType: "",
    capabilityType: "chat",
    provider: "openai",
    model: "gpt-4o-mini",
    promptTemplate: "",
    description: "",
    category: "General",
    tags: "",
  });
  
  useEffect(() => {
    const fetchAssistants = async () => {
      setIsLoading(true);
      try {
        const data = await keywordAssistantService.getAll();
        setAssistants(data);
        setFilteredAssistants(data);
      } catch (error) {
        console.error("Failed to fetch keyword assistants:", error);
        toast.error("Failed to load keyword assistants");
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchAssistants();
  }, []);
  
  useEffect(() => {
    let filtered = [...assistants];
    
    // Filter by search query
    if (searchQuery.trim() !== "") {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (assistant) =>
          assistant.name.toLowerCase().includes(query) ||
          assistant.taskType.toLowerCase().includes(query) ||
          assistant.description.toLowerCase().includes(query)
      );
    }
    
    // Filter by category
    if (currentCategory !== "all") {
      filtered = filtered.filter(
        (assistant) => assistant.taskType === currentCategory
      );
    }
    
    setFilteredAssistants(filtered);
  }, [searchQuery, currentCategory, assistants]);
  
  const handleCreateAssistant = async () => {
    try {
      const selection = normalizeSelection({
        capabilityType: formValues.capabilityType,
        provider: formValues.provider,
        model: formValues.model,
      });
      const newAssistant = await keywordAssistantService.create({
        name: formValues.name,
        taskType: formValues.taskType,
        capabilityType: selection.capabilityType,
        provider: selection.provider,
        model: selection.model,
        promptTemplate: formValues.promptTemplate,
        description: formValues.description,
      });
      
      setAssistants([...assistants, newAssistant]);
      setFilteredAssistants([...filteredAssistants, newAssistant]);
      toast.success("Keyword assistant created");
      setIsCreateMode(false);
      resetForm();
    } catch (error) {
      console.error("Failed to create keyword assistant:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create keyword assistant"
      );
    }
  };
  
  const openQualityDialog = (assistant: KeywordAssistant) => {
    setQualityAssistant(assistant);
    setIsQualityOpen(true);
  };

  const handleEvaluateQuality = async (assistant: KeywordAssistant) => {
    if (!isAdmin) return;
    setEvaluatingId(assistant.id);
    try {
      const updated = await keywordAssistantService.evaluate(assistant.id);
      setAssistants((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row))
      );
      setFilteredAssistants((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row))
      );
      setQualityAssistant(updated);
      toast.success(
        updated.qualityScore != null
          ? `Quality score: ${Math.round(updated.qualityScore)}/100`
          : "Evaluation finished"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to evaluate bot"
      );
    } finally {
      setEvaluatingId(null);
    }
  };

  const handleUpdateAssistant = async () => {
    if (!currentAssistant) return;
    
    try {
      const selection = normalizeSelection({
        capabilityType: formValues.capabilityType,
        provider: formValues.provider,
        model: formValues.model,
      });
      const updatedAssistant = await keywordAssistantService.update(
        currentAssistant.id,
        {
          name: formValues.name,
          taskType: formValues.taskType,
          capabilityType: selection.capabilityType,
          provider: selection.provider,
          model: selection.model,
          promptTemplate: formValues.promptTemplate,
          description: formValues.description,
        }
      );
      
      if (updatedAssistant) {
        const updated = assistants.map((a) =>
          a.id === updatedAssistant.id ? updatedAssistant : a
        );
        setAssistants(updated);
        setFilteredAssistants(
          filteredAssistants.map((a) =>
            a.id === updatedAssistant.id ? updatedAssistant : a
          )
        );
        toast.success("Keyword assistant updated");
      } else {
        toast.error("Failed to update keyword assistant");
      }
      
      setIsEditMode(false);
      setCurrentAssistant(null);
    } catch (error) {
      console.error("Failed to update keyword assistant:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to update keyword assistant"
      );
    }
  };
  
  const handleDeleteAssistant = async () => {
    if (!currentAssistant) return;
    
    try {
      const isDeleted = await keywordAssistantService.delete(currentAssistant.id);
      
      if (isDeleted) {
        setAssistants(assistants.filter((a) => a.id !== currentAssistant.id));
        setFilteredAssistants(
          filteredAssistants.filter((a) => a.id !== currentAssistant.id)
        );
        toast.success("Keyword assistant deleted");
      }
      
      setIsDeleteMode(false);
      setCurrentAssistant(null);
    } catch (error) {
      console.error("Failed to delete keyword assistant:", error);
      toast.error("Failed to delete keyword assistant");
    }
  };

  const handleImportTemplate = (templateName: string) => {
    const template = getTemplateByName(templateName);

    if (!template) {
      toast.error("Template not found");
      return;
    }

    setFormValues({
      name: template.name,
      taskType: template.taskType,
      capabilityType: "chat",
      provider: "openai",
      model: "gpt-4o-mini",
      promptTemplate: template.promptTemplate,
      description: template.description,
      category: template.category || "General",
      tags: "",
    });

    setIsImportMode(false);
    setIsCreateMode(true);
    toast.info("Template imported. Make any changes and save to create your assistant.");
  };
  
  const openEditDialog = (assistant: KeywordAssistant) => {
    setCurrentAssistant(assistant);
    const selection = normalizeSelection({
      capabilityType: assistant.capabilityType,
      provider: assistant.provider || inferProviderFromModel(assistant.model),
      model: assistant.model,
    });
    setFormValues({
      name: assistant.name,
      taskType: assistant.taskType,
      capabilityType: selection.capabilityType,
      provider: selection.provider,
      model: selection.model,
      promptTemplate: assistant.promptTemplate,
      description: assistant.description,
      category: "General",
      tags: "",
    });
    setIsEditMode(true);
  };
  
  const openDeleteDialog = (assistant: KeywordAssistant) => {
    setCurrentAssistant(assistant);
    setIsDeleteMode(true);
  };
  
  const resetForm = () => {
    const defaults = resolveDefaultSelection("chat", "openai");
    setFormValues({
      name: "",
      taskType: "",
      capabilityType: defaults.capability,
      provider: defaults.provider,
      model: defaults.model,
      promptTemplate: "",
      description: "",
      category: "General",
      tags: "",
    });
    setCurrentAssistant(null);
  };

  // Get unique task types for the filters
  const uniqueTaskTypes = ["all", ...new Set(assistants.map(a => a.taskType))];
  const existingTaskTypes = Array.from(
    new Set(
      assistants
        .map((assistant) => assistant.taskType)
        .filter((taskType) => Boolean(taskType?.trim()))
    )
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">AI Assistants</h1>
          <p className="text-muted-foreground mt-1">
            Manage employee bots and (admin) global platform system prompts
          </p>
        </div>
      </div>

      <Tabs defaultValue="bots" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="bots" className="gap-2">
            <Bot className="h-4 w-4" />
            Bots
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="system-prompts" className="gap-2">
              <FileText className="h-4 w-4" />
              System prompts
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="bots" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Day-to-day AI assistants for employees. Each bot has its own prompt,
              capability, and model â€” managed only in this tab.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search assistants..."
                  className="pl-10 w-full sm:w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="flex items-center">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Assistant
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setIsCreateMode(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create from scratch
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setIsImportMode(true)}>
                    <Import className="mr-2 h-4 w-4" />
                    Import from templates
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {uniqueTaskTypes.map((taskType) => (
              <Badge
                key={taskType}
                variant={currentCategory === taskType ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setCurrentCategory(taskType)}
              >
                {taskType === "all" ? "All Categories" : taskType}
              </Badge>
            ))}
          </div>
          
          <Tabs defaultValue="grid" className="w-full">
            <div className="flex justify-between items-center mb-4">
              <TabsList>
                <TabsTrigger value="grid">Grid View</TabsTrigger>
                <TabsTrigger value="list">List View</TabsTrigger>
              </TabsList>
              <p className="text-sm text-muted-foreground">
                {filteredAssistants.length} assistants
              </p>
            </div>
            
            <TabsContent value="grid">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : filteredAssistants.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAssistants.map((assistant) => (
                <Card key={assistant.id} className="h-full flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="truncate text-lg">
                        {assistant.name}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <QualityScoreTag
                          score={resolveDisplayQualityScore(assistant)}
                          title={
                            assistant.qualityFeedback ||
                            (assistant.qualityEvaluatedAt
                              ? `Evaluated ${new Date(assistant.qualityEvaluatedAt).toLocaleString()}`
                              : "Click to view quality details")
                          }
                          onClick={() => openQualityDialog(assistant)}
                        />
                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(assistant)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openQualityDialog(assistant)}>
                            <FileText className="mr-2 h-4 w-4" />
                            View quality
                          </DropdownMenuItem>
                          {isAdmin ? (
                            <DropdownMenuItem
                              disabled={evaluatingId === assistant.id}
                              onClick={() => void handleEvaluateQuality(assistant)}
                            >
                              <Sparkles className="mr-2 h-4 w-4" />
                              {evaluatingId === assistant.id
                                ? "Evaluatingâ€¦"
                                : "Evaluate quality"}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onClick={() => {
                            navigator.clipboard.writeText(assistant.promptTemplate);
                            toast.success("Prompt template copied to clipboard");
                          }}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Template
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => openDeleteDialog(assistant)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Badge variant="outline" className="bg-primary/5">
                        {assistant.taskType}
                      </Badge>
                      <Badge variant="secondary">
                        {assistant.capabilityType}
                      </Badge>
                      <Badge variant="outline">
                        {assistant.provider || "openai"}
                      </Badge>
                      <Badge variant="outline">{assistant.model}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <p className="text-sm text-muted-foreground mb-4">
                      {assistant.description}
                    </p>
                    {assistant.qualityFeedback ? (
                      <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                        {assistant.qualityFeedback}
                      </p>
                    ) : null}
                    <div className="bg-accent/50 rounded-md p-3 overflow-hidden">
                      <p className="text-sm font-mono truncate leading-relaxed">
                        {assistant.promptTemplate}
                      </p>
                    </div>
                  </CardContent>
                  <CardFooter className="border-t pt-3 text-xs text-muted-foreground">
                    <div className="flex justify-between w-full">
                      <span>
                        Created: {new Date(assistant.createdAt).toLocaleDateString()}
                      </span>
                      <span className="flex items-center">
                        <MessageSquare className="h-3 w-3 mr-1" />
                        {(assistant.promptTemplate.match(/{([^}]+)}/g) || []).length} variables
                      </span>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="rounded-full bg-muted p-3">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-medium">No keyword assistants found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchQuery || currentCategory !== "all"
                  ? "No assistants match your search criteria."
                  : "Get started by creating your first keyword assistant."}
              </p>
              {searchQuery === "" && currentCategory === "all" && (
                <Button
                  className="mt-4"
                  onClick={() => setIsCreateMode(true)}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Create First Assistant
                </Button>
              )}
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="list">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : filteredAssistants.length > 0 ? (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-3 font-medium text-sm">Name</th>
                    <th className="text-left p-3 font-medium text-sm">Type</th>
                    <th className="text-left p-3 font-medium text-sm">Quality</th>
                    <th className="text-left p-3 font-medium text-sm max-w-xs">Description</th>
                    <th className="text-left p-3 font-medium text-sm">Created</th>
                    <th className="p-3 font-medium text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAssistants.map((assistant) => (
                    <tr key={assistant.id} className="hover:bg-muted/30">
                      <td className="p-3">{assistant.name}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="bg-primary/5">
                          {assistant.taskType}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <QualityScoreTag
                          score={resolveDisplayQualityScore(assistant)}
                          title={assistant.qualityFeedback || undefined}
                          onClick={() => openQualityDialog(assistant)}
                        />
                      </td>
                      <td className="p-3 max-w-xs truncate">{assistant.description}</td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {new Date(assistant.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          {isAdmin ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Evaluate quality"
                              disabled={evaluatingId === assistant.id}
                              onClick={() => void handleEvaluateQuality(assistant)}
                            >
                              <Sparkles className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openEditDialog(assistant)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openDeleteDialog(assistant)}
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="rounded-full bg-muted p-3">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-medium">No keyword assistants found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchQuery || currentCategory !== "all"
                  ? "No assistants match your search criteria."
                  : "Get started by creating your first keyword assistant."}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="system-prompts">
            <SystemPromptsPanel />
          </TabsContent>
        )}
      </Tabs>
      
      {/* Create Assistant Dialog */}
      <Dialog open={isCreateMode} onOpenChange={setIsCreateMode}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create AI Assistant</DialogTitle>
            <DialogDescription>
              Create a new prompt template that users can access with @ in chat
            </DialogDescription>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateAssistant();
            }}
            className="space-y-4 pt-2"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="assistant-name">Assistant Name</Label>
                <Input
                  id="assistant-name"
                  value={formValues.name}
                  onChange={(e) =>
                    setFormValues({ ...formValues, name: e.target.value })
                  }
                  placeholder="E.g. SEO Content Writer"
                  required
                />
              </div>
              
              <TaskTypeField
                id="task-type"
                value={formValues.taskType}
                extraOptions={existingTaskTypes}
                onChange={(value) =>
                  setFormValues({ ...formValues, taskType: value })
                }
              />
            </div>

            <BotProviderModelFields
              idPrefix="create"
              capabilityType={formValues.capabilityType}
              provider={formValues.provider}
              model={formValues.model}
              onChange={(next) =>
                setFormValues((prev) => ({
                  ...prev,
                  capabilityType: next.capabilityType,
                  provider: next.provider,
                  model: next.model,
                }))
              }
            />
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="prompt-template">Prompt Template</Label>
                <span className="text-xs text-muted-foreground">
                  Use {"{placeholders}"} for variables
                </span>
              </div>
              <Textarea
                id="prompt-template"
                value={formValues.promptTemplate}
                onChange={(e) =>
                  setFormValues({
                    ...formValues,
                    promptTemplate: e.target.value,
                  })
                }
                placeholder="E.g. Create SEO-optimized content about {topic} for {audience}..."
                required
                rows={5}
                className="font-mono text-sm"
              />
              
              <div className="flex flex-wrap gap-2 mt-2">
                {(formValues.promptTemplate.match(/{([^}]+)}/g) || []).map((variable, i) => (
                  <Badge key={i} variant="secondary" className="bg-primary/10">
                    {variable}
                  </Badge>
                ))}
                {!(formValues.promptTemplate.match(/{([^}]+)}/g) || []).length && (
                  <span className="text-xs text-muted-foreground">
                    No variables detected. Consider adding some using {"{variable}"} syntax.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formValues.description}
                onChange={(e) =>
                  setFormValues({
                    ...formValues,
                    description: e.target.value,
                  })
                }
                placeholder="Brief description of what this assistant does"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma separated)</Label>
              <Input
                id="tags"
                value={formValues.tags}
                onChange={(e) =>
                  setFormValues({
                    ...formValues,
                    tags: e.target.value,
                  })
                }
                placeholder="E.g. marketing, social media, content"
              />
            </div>
            
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateMode(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Create Assistant</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* Edit Assistant Dialog */}
      <Dialog open={isEditMode} onOpenChange={setIsEditMode}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit AI Assistant</DialogTitle>
            <DialogDescription>
              Update the keyword assistant details
            </DialogDescription>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleUpdateAssistant();
            }}
            className="space-y-4 pt-2"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-assistant-name">Assistant Name</Label>
                <Input
                  id="edit-assistant-name"
                  value={formValues.name}
                  onChange={(e) =>
                    setFormValues({ ...formValues, name: e.target.value })
                  }
                  required
                />
              </div>
              
              <TaskTypeField
                id="edit-task-type"
                value={formValues.taskType}
                extraOptions={existingTaskTypes}
                onChange={(value) =>
                  setFormValues({ ...formValues, taskType: value })
                }
              />
            </div>

            <BotProviderModelFields
              idPrefix="edit"
              capabilityType={formValues.capabilityType}
              provider={formValues.provider}
              model={formValues.model}
              onChange={(next) =>
                setFormValues((prev) => ({
                  ...prev,
                  capabilityType: next.capabilityType,
                  provider: next.provider,
                  model: next.model,
                }))
              }
            />
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="edit-prompt-template">Prompt Template</Label>
                <span className="text-xs text-muted-foreground">
                  Use {"{placeholders}"} for variables
                </span>
              </div>
              <Textarea
                id="edit-prompt-template"
                value={formValues.promptTemplate}
                onChange={(e) =>
                  setFormValues({
                    ...formValues,
                    promptTemplate: e.target.value,
                  })
                }
                required
                rows={5}
                className="font-mono text-sm"
              />
              
              <div className="flex flex-wrap gap-2 mt-2">
                {(formValues.promptTemplate.match(/{([^}]+)}/g) || []).map((variable, i) => (
                  <Badge key={i} variant="secondary" className="bg-primary/10">
                    {variable}
                  </Badge>
                ))}
                {!(formValues.promptTemplate.match(/{([^}]+)}/g) || []).length && (
                  <span className="text-xs text-muted-foreground">
                    No variables detected. Consider adding some using {"{variable}"} syntax.
                  </span>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={formValues.description}
                onChange={(e) =>
                  setFormValues({
                    ...formValues,
                    description: e.target.value,
                  })
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-tags">Tags (comma separated)</Label>
              <Input
                id="edit-tags"
                value={formValues.tags}
                onChange={(e) =>
                  setFormValues({
                    ...formValues,
                    tags: e.target.value,
                  })
                }
                placeholder="E.g. marketing, social media, content"
              />
            </div>
            
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditMode(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* Delete Assistant Dialog */}
      <Dialog open={isDeleteMode} onOpenChange={setIsDeleteMode}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Keyword Assistant</DialogTitle>
            <DialogDescription>
              This action cannot be undone
            </DialogDescription>
          </DialogHeader>
          <p>
            Are you sure you want to delete{" "}
            <span className="font-medium">{currentAssistant?.name}</span>?
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsDeleteMode(false);
                setCurrentAssistant(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteAssistant}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Import Templates Dialog */}
      <Dialog open={isImportMode} onOpenChange={setIsImportMode}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import from Templates</DialogTitle>
            <DialogDescription>
              Choose a pre-built template to customize
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="seo" className="w-full">
            <TabsList className="grid grid-cols-3 mb-4">
              <TabsTrigger value="seo">SEO Templates</TabsTrigger>
              <TabsTrigger value="content">Content Templates</TabsTrigger>
              <TabsTrigger value="marketing">Marketing Templates</TabsTrigger>
            </TabsList>
            
            <TabsContent value="seo" className="max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ASSISTANT_TEMPLATES.SEO.map((template) => (
                  <Card key={template.name} className="cursor-pointer hover:border-primary transition-colors">
                    <CardHeader>
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      <CardDescription>{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-muted p-2 rounded text-xs font-mono line-clamp-2">
                        {template.promptTemplate}
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => handleImportTemplate(template.name)}
                      >
                        <Import className="mr-2 h-4 w-4" />
                        Import Template
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="content" className="max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ASSISTANT_TEMPLATES.Content.map((template) => (
                  <Card key={template.name} className="cursor-pointer hover:border-primary transition-colors">
                    <CardHeader>
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      <CardDescription>{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-muted p-2 rounded text-xs font-mono line-clamp-2">
                        {template.promptTemplate}
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => handleImportTemplate(template.name)}
                      >
                        <Import className="mr-2 h-4 w-4" />
                        Import Template
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="marketing" className="max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ASSISTANT_TEMPLATES.Marketing.map((template) => (
                  <Card key={template.name} className="cursor-pointer hover:border-primary transition-colors">
                    <CardHeader>
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      <CardDescription>{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-muted p-2 rounded text-xs font-mono line-clamp-2">
                        {template.promptTemplate}
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => handleImportTemplate(template.name)}
                      >
                        <Import className="mr-2 h-4 w-4" />
                        Import Template
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsImportMode(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BotQualityDialog
        assistant={qualityAssistant}
        open={isQualityOpen}
        onOpenChange={(open) => {
          setIsQualityOpen(open);
          if (!open) setQualityAssistant(null);
        }}
        canEvaluate={isAdmin}
        evaluating={
          qualityAssistant != null && evaluatingId === qualityAssistant.id
        }
        onEvaluate={() => {
          if (qualityAssistant) void handleEvaluateQuality(qualityAssistant);
        }}
      />
    </div>
  );
};

export default KeywordAssistantsPage;
