"use client";

import { useEffect, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { adminAiSettingsApiService } from "@/modules/workspaceSummary/api";
import { AdminAiSettings } from "@/modules/shared/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AdminAiSettingsCard() {
  const [settings, setSettings] = useState<AdminAiSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    adminAiSettingsApiService
      .get()
      .then(setSettings)
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load AI settings"
        )
      );
  }, []);

  const save = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      setSettings(
        await adminAiSettingsApiService.update({
          summaryModel: settings.summaryModel,
          evaluationModel: settings.evaluationModel,
          evaluationPrompt: settings.evaluationPrompt,
        })
      );
      toast.success("Global AI settings saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save AI settings"
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <Card className="admin-ai-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5" />
          Workspace summary AI
        </CardTitle>
        <CardDescription>
          Global models and evaluation criteria used across all workspaces.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="summary-model">Summary model</Label>
            <Input
              id="summary-model"
              value={settings.summaryModel}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  summaryModel: event.target.value,
                })
              }
              placeholder="gpt-4o-mini"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="evaluation-model">Evaluation model</Label>
            <Input
              id="evaluation-model"
              value={settings.evaluationModel}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  evaluationModel: event.target.value,
                })
              }
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="evaluation-prompt">Global evaluation prompt</Label>
          <Textarea
            id="evaluation-prompt"
            value={settings.evaluationPrompt}
            onChange={(event) =>
              setSettings({
                ...settings,
                evaluationPrompt: event.target.value,
              })
            }
            className="min-h-32"
          />
        </div>
        <Button
          onClick={save}
          disabled={
            isSaving ||
            !settings.summaryModel.trim() ||
            !settings.evaluationModel.trim() ||
            !settings.evaluationPrompt.trim()
          }
        >
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Saving..." : "Save global settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
