export type ExpressionPreviewStatus =
  | "IDLE"
  | "LOADING"
  | "RESOLVED"
  | "NO_DATA"
  | "AMBIGUOUS"
  | "BROKEN_REFERENCE"
  | "UPSTREAM_NOT_EXECUTED"
  | "INVALID_EXPRESSION";

export type ExpressionPreviewResponse = {
  status: ExpressionPreviewStatus;
  value?: unknown;
  message?: string;
  reason?: string;
  targetNodeId?: string | null;
  itemIndex?: number;
  usesPinnedData?: boolean;
};

const REASON_MESSAGES: Record<string, string> = {
  TARGET_NOT_EXECUTED: "Run the referenced step to preview this value.",
  TARGET_NOT_IN_PATH: "This step isn't in the current item's upstream path.",
  PROVENANCE_MISSING:
    "OpsAi can't determine which upstream item corresponds to this item.",
  PROVENANCE_AMBIGUOUS:
    "Multiple upstream items match. Use $first, $last, or $all[index].",
  ITEM_INDEX_OUT_OF_RANGE: "That item index isn't available.",
  INVALID_REFERENCE: "This expression reference is invalid.",
};

export function previewStatusMessage(res: ExpressionPreviewResponse): string {
  if (res.message) return res.message;
  if (res.reason && REASON_MESSAGES[res.reason]) {
    return REASON_MESSAGES[res.reason];
  }
  switch (res.status) {
    case "UPSTREAM_NOT_EXECUTED":
      return "Run previous steps to preview values.";
    case "NO_DATA":
      return "No output available from this step yet.";
    case "BROKEN_REFERENCE":
      return "This expression reference could not be resolved.";
    case "AMBIGUOUS":
      return REASON_MESSAGES.PROVENANCE_AMBIGUOUS;
    case "INVALID_EXPRESSION":
      return "Invalid expression syntax.";
    default:
      return "";
  }
}

export function formatPreviewValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
