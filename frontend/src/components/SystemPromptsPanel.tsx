"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit, FileText, PlusCircle, Trash, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { systemPromptsApiService } from "@/modules/systemPrompts/api";
import {
  getUseCaseLabel,
  type SystemPromptUseCase,
} from "@/modules/systemPrompts/useCases";
import {
  SCORING_CATEGORY_CATALOG,
  DEFAULT_WORKSPACE_SUMMARY_CATEGORIES,
  getScoringCategoryLabel,
} from "@/modules/systemPrompts/scoringCategories";
import {
  BOT_SCORING_CATEGORY_CATALOG,
  DEFAULT_BOT_DESIGN_CATEGORIES,
  getBotScoringCategoryLabel,
} from "@/modules/systemPrompts/botScoringCategories";
import { SystemPrompt } from "@/modules/shared/types";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const emptyForm = {
  useCaseKey: "workspace_summary",
  name: "",
  description: "",
  promptContent: "",
  model: "gpt-4o-mini",
  temperature: "0.1",
  maxTokens: "2000",
  scoringCategories: [...DEFAULT_WORKSPACE_SUMMARY_CATEGORIES] as string[],
  isActive: true,
};

const defaultsForUseCase = (key: string) =>
  key === "bot_design"
    ? [...DEFAULT_BOT_DESIGN_CATEGORIES]
    : [...DEFAULT_WORKSPACE_SUMMARY_CATEGORIES];

const formFromPrompt = (prompt: SystemPrompt) => {
  const defaults = defaultsForUseCase(prompt.useCaseKey);
  const configured = Array.isArray(prompt.config?.scoringCategories)
    ? (prompt.config.scoringCategories as string[])
    : defaults;
  return {
    useCaseKey: prompt.useCaseKey,
    name: prompt.name,
    description: prompt.description || "",
    promptContent: prompt.promptContent,
    model: String(prompt.config?.model || "gpt-4o-mini"),
    temperature: String(prompt.config?.temperature ?? 0.1),
    maxTokens: String(prompt.config?.maxTokens ?? 2000),
    scoringCategories: configured,
    isActive: prompt.isActive,
  };
};

const toPayload = (
  form: typeof emptyForm,
  useCases: SystemPromptUseCase[]
) => {
  const key = form.useCaseKey;
  const useCase = useCases.find((item) => item.key === key);
  return {
    useCaseKey: key,
    name: form.name.trim() || useCase?.label || key,
    description: form.description.trim() || useCase?.description || "",
    promptContent: form.promptContent,
    config: {
      model: form.model.trim() || "gpt-4o-mini",
      temperature: Number(form.temperature) || 0.1,
      maxTokens: Number(form.maxTokens) || 2000,
      feature: key,
      scoringCategories: form.scoringCategories,
    },
    isActive: form.isActive,
  };
};

export function SystemPromptsPanel() {
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [useCases, setUseCases] = useState<SystemPromptUseCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [current, setCurrent] = useState<SystemPrompt | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const existingUseCaseKeys = useMemo(
    () => new Set(prompts.map((prompt) => prompt.useCaseKey)),
    [prompts]
  );

  const availableUseCases = useMemo(
    () =>
      useCases.filter(
        (item) =>
          !existingUseCaseKeys.has(item.key) ||
          item.key === form.useCaseKey
      ),
    [useCases, existingUseCaseKeys, form.useCaseKey]
  );

  const load = async () => {
    setIsLoading(true);
    try {
      const [promptRows, useCaseRows] = await Promise.all([
        systemPromptsApiService.getAll(),
        systemPromptsApiService.listUseCases(),
      ]);
      setPrompts(promptRows);
      setUseCases(useCaseRows);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load system prompts"
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setCurrent(null);
    const firstFree =
      useCases.find((item) => !existingUseCaseKeys.has(item.key)) ||
      useCases[0];
    const key = firstFree?.key || "workspace_summary";
    setForm({
      ...emptyForm,
      useCaseKey: key,
      name: firstFree?.label || "",
      description: firstFree?.description || "",
      scoringCategories: defaultsForUseCase(key),
    });
    setIsCreateOpen(true);
  };

  const openEdit = (prompt: SystemPrompt) => {
    setCurrent(prompt);
    setForm(formFromPrompt(prompt));
    setIsEditOpen(true);
  };

  const toggleCategory = (key: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      scoringCategories: checked
        ? [...prev.scoringCategories, key]
        : prev.scoringCategories.filter((item) => item !== key),
    }));
  };

  const saveCreate = async () => {
    const key = form.useCaseKey;
    if (!key) {
      toast.error("Select a use case");
      return;
    }
    if (existingUseCaseKeys.has(key)) {
      toast.error(`Use case "${key}" already has a system prompt`);
      return;
    }
    if (
      (key === "workspace_summary" || key === "bot_design") &&
      form.scoringCategories.length === 0
    ) {
      toast.error("Select at least one scoring category");
      return;
    }
    setIsSaving(true);
    try {
      await systemPromptsApiService.create(toPayload(form, useCases));
      toast.success(
        key === "bot_design"
          ? "Bot design validator saved. Run Evaluate on a bot to score it."
          : "System prompt created."
      );
      setIsCreateOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create system prompt"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!current) return;
    const key = form.useCaseKey;
    if (
      (key === "workspace_summary" || key === "bot_design") &&
      form.scoringCategories.length === 0
    ) {
      toast.error("Select at least one scoring category");
      return;
    }
    setIsSaving(true);
    try {
      await systemPromptsApiService.update(
        current.id,
        toPayload(form, useCases)
      );
      toast.success(
        key === "bot_design"
          ? "Bot design validator saved."
          : "System prompt saved."
      );
      setIsEditOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save system prompt"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!current) return;
    setIsSaving(true);
    try {
      await systemPromptsApiService.remove(current.id);
      toast.success("System prompt deleted");
      setIsDeleteOpen(false);
      setCurrent(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete system prompt"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const activeUseCase = form.useCaseKey;
  const showScoring =
    activeUseCase === "workspace_summary" || activeUseCase === "bot_design";
  const scoringCatalog =
    activeUseCase === "bot_design"
      ? BOT_SCORING_CATEGORY_CATALOG
      : SCORING_CATEGORY_CATALOG;

  const formFields = (
    <>
      <div className="space-y-2">
        <Label>Use case</Label>
        <Select
          value={form.useCaseKey}
          onValueChange={(value) => {
            const meta = useCases.find((item) => item.key === value);
            setForm((prev) => ({
              ...prev,
              useCaseKey: value,
              name: meta?.label || prev.name,
              description: meta?.description || prev.description,
              scoringCategories: defaultsForUseCase(value),
            }));
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select use case" />
          </SelectTrigger>
          <SelectContent>
            {(isCreateOpen ? availableUseCases : useCases).map((item) => (
              <SelectItem
                key={item.key}
                value={item.key}
                disabled={
                  isCreateOpen &&
                  existingUseCaseKeys.has(item.key) &&
                  item.key !== form.useCaseKey
                }
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Choose a registered use case. One system prompt per use case. List
          comes from the backend.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sp-name">Name</Label>
        <Input
          id="sp-name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sp-description">Description</Label>
        <Input
          id="sp-description"
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sp-content">Prompt content</Label>
        <Textarea
          id="sp-content"
          value={form.promptContent}
          onChange={(event) =>
            setForm({ ...form, promptContent: event.target.value })
          }
          rows={12}
          className="font-mono text-sm"
          required
        />
        <p className="text-xs text-muted-foreground">
          Role and scoring rules live here. Selected categories below tell the
          model which scores to return (and what the summary UI shows).
        </p>
      </div>

      {showScoring && (
        <div className="space-y-3 rounded-md border p-3">
          <Label>Scoring categories</Label>
          <p className="text-xs text-muted-foreground">
            Admin selects which scores are required for this system prompt.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {scoringCatalog.map((item) => {
              const checked = form.scoringCategories.includes(item.key);
              return (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggleCategory(item.key, Boolean(value))
                    }
                  />
                  <span className="text-sm">
                    {item.label}
                    {item.weight != null ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({item.weight}%)
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="sp-model">Model</Label>
          <Input
            id="sp-model"
            value={form.model}
            onChange={(event) =>
              setForm({ ...form, model: event.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sp-temp">Temperature</Label>
          <Input
            id="sp-temp"
            value={form.temperature}
            onChange={(event) =>
              setForm({ ...form, temperature: event.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sp-tokens">Max tokens</Label>
          <Input
            id="sp-tokens"
            value={form.maxTokens}
            onChange={(event) =>
              setForm({ ...form, maxTokens: event.target.value })
            }
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.isActive}
          onCheckedChange={(checked) =>
            setForm({ ...form, isActive: Boolean(checked) })
          }
        />
        Active
      </label>
    </>
  );

  return (
    <div className="system-prompts-panel space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">System prompts</h2>
          <p className="text-sm text-muted-foreground">
            Global platform prompts by use case. Workspace Knowledge Evaluator
            drives summary scoring after regenerate.
          </p>
        </div>
        <Button
          onClick={openCreate}
          disabled={
            useCases.length > 0 &&
            useCases.every((item) => existingUseCaseKeys.has(item.key))
          }
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add system prompt
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-t-2 border-b-2 border-primary" />
        </div>
      ) : prompts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No system prompts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add Workspace Knowledge Evaluator to enable summary scoring.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {prompts.map((prompt) => {
            const categories = Array.isArray(prompt.config?.scoringCategories)
              ? (prompt.config.scoringCategories as string[])
              : [];
            return (
              <Card key={prompt.id} className="flex h-full flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-lg">
                        {prompt.name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {prompt.description || "No description"}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(prompt)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            setCurrent(prompt);
                            setIsDeleteOpen(true);
                          }}
                        >
                          <Trash className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Badge variant="secondary">
                      {getUseCaseLabel(prompt.useCaseKey, useCases)}
                    </Badge>
                    <Badge variant="outline">{prompt.useCaseKey}</Badge>
                    {prompt.config?.model ? (
                      <Badge variant="outline">
                        {String(prompt.config.model)}
                      </Badge>
                    ) : null}
                    {!prompt.isActive && (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {categories.map((key) => (
                        <Badge key={key} variant="outline" className="text-xs">
                          {prompt.useCaseKey === "bot_design"
                            ? getBotScoringCategoryLabel(key)
                            : getScoringCategoryLabel(key)}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-3 text-xs whitespace-pre-wrap">
                    {prompt.promptContent.slice(0, 420)}
                    {prompt.promptContent.length > 420 ? "…" : ""}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add system prompt</DialogTitle>
            <DialogDescription>
              Choose a use case, scoring categories, and prompt text.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">{formFields}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCreate} disabled={isSaving}>
              {isSaving ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit system prompt</DialogTitle>
            <DialogDescription>
              After saving, regenerate a workspace summary to refresh scores
              with this prompt and selected categories.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">{formFields}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete system prompt?</DialogTitle>
            <DialogDescription>
              {current
                ? `Delete “${current.name}” (${current.useCaseKey})? Summary evaluation will fall back until you add another workspace_summary prompt.`
                : "Delete this system prompt?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isSaving}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
