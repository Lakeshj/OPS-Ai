"use client";

import { MarkdownMessage } from "@/components/MarkdownMessage";
import { cn } from "@/lib/utils";

/** Prefer markdown rendering for AI/prose; keep JSON as monospace. */
export const looksLikeJsonBlob = (text: string) => {
  const t = text.trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
};

export const looksLikeMarkdownProse = (text: string) => {
  if (!text || looksLikeJsonBlob(text)) return false;
  return (
    /(\*\*[^*]+\*\*|__[^_]+__|^#{1,3}\s|^\s*[-*]\s|\n\s*\d+\.\s)/m.test(text) ||
    (text.includes("\n") && text.length > 80)
  );
};

/** Collapse markdown markers for one-line / clamped previews. */
export const plainPreview = (text: string) =>
  text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();

type Props = {
  text: string;
  className?: string;
  /** Tighter typography for expression / inspector previews. */
  compact?: boolean;
};

/**
 * Renders workflow AI / Result prose with markdown when appropriate.
 */
export function WorkflowProseContent({ text, className, compact }: Props) {
  if (!text) return null;
  if (looksLikeJsonBlob(text)) {
    return (
      <pre
        className={cn(
          "max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words",
          compact ? "font-mono text-[10px] leading-snug" : "text-sm leading-relaxed",
          className
        )}
      >
        {text}
      </pre>
    );
  }
  if (looksLikeMarkdownProse(text)) {
    return (
      <div
        className={cn(
          "max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain",
          className
        )}
      >
        <MarkdownMessage
          content={text}
          className={cn(
            "leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
            compact ? "text-[11px] prose-sm" : "text-sm"
          )}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain whitespace-pre-wrap",
        compact ? "text-[10px] leading-snug" : "text-sm leading-relaxed",
        className
      )}
    >
      {text}
    </div>
  );
}
