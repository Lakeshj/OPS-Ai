"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { workflowsApi } from "@/modules/workflows/api";
import {
  applySuggestion,
  getExpressionSuggestions,
  parseExpressionAtCursor,
  type AutocompleteContext,
  type ExpressionSuggestion,
} from "@/modules/workflows/expressionAutocomplete";
import {
  formatPreviewValue,
  previewStatusMessage,
  type ExpressionPreviewResponse,
  type ExpressionPreviewStatus,
} from "@/modules/workflows/expressionPreview";
import type { WorkflowDefinition, WorkflowItem } from "@/modules/workflows/types";

export type ExpressionFieldContext = {
  workflowId?: string;
  nodeId?: string;
  itemIndex?: number;
  /** Part 9C — selected Loop body / Batch occurrence */
  runIndex?: number;
  definition?: WorkflowDefinition;
  input?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  stepItems?: Record<string, WorkflowItem[]>;
  inputItems?: WorkflowItem[];
  nodeLabels?: Record<string, string>;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  parameterName?: string;
  expressionContext?: ExpressionFieldContext;
  /** @deprecated use expressionContext */
  previewContext?: ExpressionFieldContext;
  className?: string;
};

const DEBOUNCE_MS = 300;

const AMBIGUITY_HINTS = ["$first", "$last", "$all[index]"];

export function ExpressionField({
  value,
  onChange,
  multiline,
  placeholder,
  parameterName,
  expressionContext,
  previewContext,
  className,
}: Props) {
  const ctx = expressionContext ?? previewContext;
  const Field = multiline ? Textarea : Input;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [preview, setPreview] = useState<ExpressionPreviewResponse | null>(null);
  const [previewStatus, setPreviewStatus] =
    useState<ExpressionPreviewStatus>("IDLE");
  const [suggestions, setSuggestions] = useState<ExpressionSuggestion[]>([]);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [parsedExpr, setParsedExpr] = useState<ReturnType<
    typeof parseExpressionAtCursor
  >>(null);

  const requestSeq = useRef(0);
  const hasExpression = value.includes("{{");

  const autocompleteCtx: AutocompleteContext = useMemo(
    () => ({
      definition: ctx?.definition,
      nodeId: ctx?.nodeId,
      currentItemIndex: ctx?.itemIndex ?? 0,
      input: ctx?.input,
      steps: ctx?.steps,
      stepItems: ctx?.stepItems,
      inputItems: ctx?.inputItems,
      nodeLabels: ctx?.nodeLabels,
    }),
    [ctx]
  );

  const updateSuggestions = useCallback(
    (cursor: number) => {
      const parsed = parseExpressionAtCursor(value, cursor);
      setParsedExpr(parsed);
      if (!parsed) {
        setSuggestions([]);
        setSuggestionOpen(false);
        return;
      }
      const next = getExpressionSuggestions(parsed, autocompleteCtx);
      setSuggestions(next);
      setSuggestionOpen(next.length > 0);
      setActiveSuggestion(0);
    },
    [value, autocompleteCtx]
  );

  const handleCursorActivity = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    updateSuggestions(el.selectionStart ?? value.length);
  }, [updateSuggestions, value.length]);

  useEffect(() => {
    if (!hasExpression) {
      setPreview(null);
      setPreviewStatus("IDLE");
      return;
    }
    if (!ctx?.workflowId || !ctx?.nodeId) {
      setPreviewStatus("IDLE");
      return;
    }

    const seq = ++requestSeq.current;
    setPreviewStatus("LOADING");

    const timer = window.setTimeout(() => {
      workflowsApi
        .previewExpression(ctx.workflowId!, ctx.nodeId!, {
          expression: value,
          itemIndex: ctx.itemIndex ?? 0,
          runIndex: ctx.runIndex,
          definition: ctx.definition,
          input: ctx.input,
        })
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setPreview(res);
          setPreviewStatus(res.status);
        })
        .catch((err) => {
          if (seq !== requestSeq.current) return;
          setPreview({
            status: "INVALID_EXPRESSION",
            message:
              err instanceof Error ? err.message : "Preview request failed",
          });
          setPreviewStatus("INVALID_EXPRESSION");
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    value,
    hasExpression,
    ctx?.workflowId,
    ctx?.nodeId,
    ctx?.itemIndex,
    ctx?.runIndex,
    ctx?.definition,
    ctx?.input,
  ]);

  const selectSuggestion = (suggestion: ExpressionSuggestion) => {
    if (!parsedExpr) return;
    const { nextValue, cursor } = applySuggestion(value, parsedExpr, suggestion);
    onChange(nextValue);
    setSuggestionOpen(false);
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
      updateSuggestions(cursor);
    });
  };

  const insertAmbiguityHint = (hint: string) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const snippet =
      hint === "$all[index]" ? "$all[0]" : hint.replace("[index]", "[0]");
    const next = `${before}${snippet}${after}`;
    onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!suggestionOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion(
        (i) => (i - 1 + suggestions.length) % suggestions.length
      );
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    } else if (e.key === "Escape") {
      setSuggestionOpen(false);
    }
  };

  const previewBody = useMemo(() => {
    if (!hasExpression) return null;
    if (previewStatus === "LOADING") {
      return (
        <span className="italic text-muted-foreground">Resolving…</span>
      );
    }
    if (previewStatus === "RESOLVED" && preview) {
      return (
        <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
          {formatPreviewValue(preview.value)}
        </pre>
      );
    }
    if (
      previewStatus === "NO_DATA" &&
      preview?.value !== undefined &&
      preview.value !== ""
    ) {
      return (
        <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
          {formatPreviewValue(preview.value)}
        </pre>
      );
    }
    const message = preview ? previewStatusMessage(preview) : "";
    if (!message) {
      return (
        <span className="italic text-muted-foreground">No preview yet</span>
      );
    }
    return <span className="text-amber-700 dark:text-amber-300">{message}</span>;
  }, [hasExpression, previewStatus, preview]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative isolate">
        <Field
          ref={inputRef as never}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            updateSuggestions(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={handleCursorActivity}
          onClick={handleCursorActivity}
          onFocus={handleCursorActivity}
          placeholder={placeholder}
          className={cn(
            "font-mono text-xs",
            hasExpression && "ring-1 ring-primary/20",
            multiline && "min-h-[72px]"
          )}
          rows={multiline ? 3 : undefined}
          data-parameter={parameterName}
        />

        {suggestionOpen && suggestions.length > 0 && (
          <div
            ref={listRef}
            className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-auto rounded-md border bg-popover py-1 shadow-md"
            role="listbox"
          >
            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.insert}-${i}`}
                type="button"
                role="option"
                aria-selected={i === activeSuggestion}
                className={cn(
                  "flex w-full flex-col px-2 py-1.5 text-left text-[11px]",
                  i === activeSuggestion && "bg-muted"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(s);
                }}
              >
                <span className="font-mono font-medium">{s.label}</span>
                {s.description && (
                  <span className="text-[10px] text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasExpression && (
        <div className="mt-1 rounded border border-dashed bg-muted/20 px-2 py-2 text-[10px]">
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <span className="font-medium">Preview</span>
            {preview?.usesPinnedData && (
              <span className="text-[9px] italic">uses pinned data</span>
            )}
          </div>
          {previewBody}
          {previewStatus === "AMBIGUOUS" && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {AMBIGUITY_HINTS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  className="rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] hover:bg-muted"
                  onClick={() => insertAmbiguityHint(hint)}
                >
                  {hint}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
