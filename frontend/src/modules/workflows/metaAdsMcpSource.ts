export const META_ADS_SOURCE_NONE = "Add and configure a Meta Ads node first.";
export const META_ADS_SOURCE_MISSING =
  "The selected Meta Ads source is no longer in this workflow.";

export type MetaAdsSourceNodeRef = {
  id: string;
  type?: string;
  data?: { nodeType?: string; label?: string };
};

export type MetaAdsSourceOption = {
  id: string;
  label: string;
};

export type MetaAdsSourceFieldState = {
  showSelector: boolean;
  message: string | null;
  sources: MetaAdsSourceOption[];
};

export function metaAdsSourceFieldState(
  nodes: MetaAdsSourceNodeRef[] | undefined,
  savedSourceId: string
): MetaAdsSourceFieldState {
  const sources = (nodes || [])
    .filter((node) => (node.type || node.data?.nodeType) === "metaAds")
    .map((node) => ({
      id: String(node.id),
      label: String(node.data?.label || "Meta Ads"),
    }));
  const saved = String(savedSourceId || "").trim();
  const savedOk = Boolean(saved && sources.some((row) => row.id === saved));
  if (sources.length === 0) {
    return {
      showSelector: false,
      message: saved ? META_ADS_SOURCE_MISSING : META_ADS_SOURCE_NONE,
      sources,
    };
  }
  if (sources.length === 1 && (!saved || savedOk)) {
    return { showSelector: false, message: null, sources };
  }
  if (saved && !savedOk) {
    return { showSelector: true, message: META_ADS_SOURCE_MISSING, sources };
  }
  return { showSelector: true, message: null, sources };
}
