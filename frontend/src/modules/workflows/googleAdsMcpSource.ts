export const GOOGLE_ADS_SOURCE_NONE = "Add and configure a Google Ads node first.";
export const GOOGLE_ADS_SOURCE_MISSING =
  "The selected Google Ads source is no longer in this workflow.";

export type GoogleAdsSourceNodeRef = {
  id: string;
  type?: string;
  data?: { nodeType?: string; label?: string };
};

export type GoogleAdsSourceOption = {
  id: string;
  label: string;
};

export type GoogleAdsSourceFieldState = {
  showSelector: boolean;
  message: string | null;
  sources: GoogleAdsSourceOption[];
};

export function googleAdsSourceFieldState(
  nodes: GoogleAdsSourceNodeRef[] | undefined,
  savedSourceId: string
): GoogleAdsSourceFieldState {
  const sources = (nodes || [])
    .filter((node) => (node.type || node.data?.nodeType) === "googleAds")
    .map((node) => ({
      id: String(node.id),
      label: String(node.data?.label || "Google Ads"),
    }));
  const saved = String(savedSourceId || "").trim();
  const savedOk = Boolean(saved && sources.some((row) => row.id === saved));
  if (sources.length === 0) {
    return {
      showSelector: false,
      message: saved ? GOOGLE_ADS_SOURCE_MISSING : GOOGLE_ADS_SOURCE_NONE,
      sources,
    };
  }
  if (sources.length === 1 && (!saved || savedOk)) {
    return { showSelector: false, message: null, sources };
  }
  if (saved && !savedOk) {
    return { showSelector: true, message: GOOGLE_ADS_SOURCE_MISSING, sources };
  }
  return { showSelector: true, message: null, sources };
}
