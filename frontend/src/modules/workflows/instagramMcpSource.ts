export const INSTAGRAM_SOURCE_NONE = "Add and configure an Instagram node first.";
export const INSTAGRAM_SOURCE_MISSING =
  "The selected Instagram source is no longer in this workflow.";

export type InstagramSourceNodeRef = {
  id: string;
  type?: string;
  data?: { nodeType?: string; label?: string };
};

export type InstagramSourceOption = {
  id: string;
  label: string;
};

export type InstagramSourceFieldState = {
  showSelector: boolean;
  message: string | null;
  sources: InstagramSourceOption[];
};

export function instagramSourceFieldState(
  nodes: InstagramSourceNodeRef[] | undefined,
  savedSourceId: string
): InstagramSourceFieldState {
  const sources = (nodes || [])
    .filter((node) => (node.type || node.data?.nodeType) === "instagram")
    .map((node) => ({
      id: String(node.id),
      label: String(node.data?.label || "Instagram"),
    }));
  const saved = String(savedSourceId || "").trim();
  const savedOk = Boolean(saved && sources.some((row) => row.id === saved));
  if (sources.length === 0) {
    return {
      showSelector: false,
      message: saved ? INSTAGRAM_SOURCE_MISSING : INSTAGRAM_SOURCE_NONE,
      sources,
    };
  }
  if (sources.length === 1 && (!saved || savedOk)) {
    return { showSelector: false, message: null, sources };
  }
  if (saved && !savedOk) {
    return { showSelector: true, message: INSTAGRAM_SOURCE_MISSING, sources };
  }
  return { showSelector: true, message: null, sources };
}
