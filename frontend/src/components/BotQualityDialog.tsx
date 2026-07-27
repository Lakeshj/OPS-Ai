"use client";

import { KeywordAssistant } from "@/modules/shared/types";
import { getBotScoringCategoryLabel } from "@/modules/systemPrompts/botScoringCategories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";

type CategoryScore = {
  score?: number | null;
  feedback?: string;
  label?: string;
};

type QualityDetails = {
  score?: number | null;
  feedback?: string;
  categories?: Record<string, CategoryScore | number>;
  strengths?: string[];
  gaps?: string[];
  recommendations?: string[];
  confidence?: string | null;
  confidenceReason?: string | null;
};

const scoreTone = (score: number | null | undefined) => {
  if (score == null) return "secondary" as const;
  if (score >= 80) return "default" as const;
  if (score >= 60) return "secondary" as const;
  return "destructive" as const;
};

const scoreBarClass = (score: number) => {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-rose-500";
};

const normalizeCategory = (
  value: CategoryScore | number | undefined
): { score: number; feedback: string; label?: string } | null => {
  if (value == null) return null;
  if (typeof value === "number") {
    return { score: value, feedback: "No category feedback provided." };
  }
  return {
    score: Number(value.score) || 0,
    feedback: value.feedback || "No category feedback provided.",
    label: value.label,
  };
};

interface BotQualityDialogProps {
  assistant: KeywordAssistant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEvaluate?: boolean;
  evaluating?: boolean;
  onEvaluate?: () => void;
}

export function BotQualityDialog({
  assistant,
  open,
  onOpenChange,
  canEvaluate = false,
  evaluating = false,
  onEvaluate,
}: BotQualityDialogProps) {
  if (!assistant) return null;

  const details = (assistant.qualityDetails || null) as QualityDetails | null;
  const categoriesMap = details?.categories || {};
  const categoryKeys =
    Object.keys(categoriesMap).length > 0
      ? Object.keys(categoriesMap)
      : [];

  const categories = categoryKeys
    .map((key) => ({
      key,
      label:
        (typeof categoriesMap[key] === "object" &&
          categoriesMap[key]?.label) ||
        getBotScoringCategoryLabel(key),
      data: normalizeCategory(categoriesMap[key]),
    }))
    .filter((row) => row.data != null);

  const overall =
    assistant.qualityScore != null
      ? Math.round(Number(assistant.qualityScore))
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {assistant.name}
            <Badge variant={scoreTone(overall)}>
              Overall {overall != null ? `${overall}/100` : "—"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Bot design quality scores from the AI Assistant Design Validator.
            {assistant.qualityEvaluatedAt
              ? ` Last evaluated ${new Date(
                  assistant.qualityEvaluatedAt
                ).toLocaleString()}.`
              : " Not evaluated yet."}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          {(assistant.qualityFeedback || details?.feedback) && (
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              {assistant.qualityFeedback || details?.feedback}
            </p>
          )}

          <div>
            <h3 className="mb-3 font-semibold">Category scores</h3>
            {categories.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {categories.map(({ key, label, data }) => (
                  <div
                    key={key}
                    className="rounded-md border bg-muted/30 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      <Badge variant={scoreTone(data!.score)}>
                        {data!.score}/100
                      </Badge>
                    </div>
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${scoreBarClass(
                          data!.score
                        )}`}
                        style={{ width: `${data!.score}%` }}
                      />
                    </div>
                    <p className="break-words text-xs text-muted-foreground">
                      {data!.feedback}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No category breakdown yet. Run Evaluate quality to score this
                bot.
              </p>
            )}
          </div>

          {details && (
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Strengths", details.strengths],
                ["Gaps", details.gaps],
                ["Recommendations", details.recommendations],
              ].map(([label, items]) => (
                <div key={label as string}>
                  <h4 className="text-sm font-medium">{label}</h4>
                  <ul className="mt-1 list-disc space-y-1 break-words pl-4 text-xs text-muted-foreground">
                    {(items as string[] | undefined)?.length ? (
                      (items as string[]).map((item) => (
                        <li key={item}>{item}</li>
                      ))
                    ) : (
                      <li>None provided</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {details?.confidence && (
            <p className="text-xs text-muted-foreground">
              Confidence: <strong>{details.confidence}</strong>
              {details.confidenceReason
                ? ` — ${details.confidenceReason}`
                : ""}
            </p>
          )}
        </section>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canEvaluate ? (
            <Button disabled={evaluating} onClick={onEvaluate}>
              <Sparkles className="mr-2 h-4 w-4" />
              {evaluating ? "Evaluating…" : "Evaluate quality"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
