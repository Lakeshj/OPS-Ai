import { apiClient } from "@/modules/shared/apiClient";

export type GeneratedMediaItem = {
  filename: string;
  kind: "image" | "video" | "other";
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  publicPath: string;
  url: string;
};

export type GeneratedMediaStats = {
  count: number;
  totalBytes: number;
  imageCount: number;
  videoCount: number;
};

export const generatedMediaApi = {
  list: () =>
    apiClient.get<{ items: GeneratedMediaItem[]; stats: GeneratedMediaStats }>(
      "/admin/generated-media"
    ),

  remove: (filename: string) =>
    apiClient.delete(`/admin/generated-media/${encodeURIComponent(filename)}`),

  purge: (kind: "all" | "image" | "video" = "all") =>
    apiClient.delete<{ deleted: number; remaining: number }>(
      `/admin/generated-media/purge?kind=${encodeURIComponent(kind)}`
    ),
};
