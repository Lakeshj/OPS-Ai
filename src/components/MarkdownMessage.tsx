"use client";

import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

const filenameFromUrl = (url: string, fallback: string) => {
  try {
    const path = new URL(url, "http://localhost").pathname;
    const base = path.split("/").pop();
    if (base) return decodeURIComponent(base);
  } catch {
    /* ignore */
  }
  return fallback;
};

const downloadUrlFor = (url: string) => {
  if (!url) return url;
  try {
    const parsed = new URL(url, "http://localhost");
    parsed.searchParams.set("download", "1");
    if (/^https?:\/\//i.test(url)) return parsed.toString();
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}download=1`;
  }
};

/** Turn raw HTML video tags into markdown links so they aren't shown as text. */
const normalizeMediaMarkdown = (raw: string) => {
  let text = String(raw || "");

  text = text.replace(
    /<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/video>/gi,
    (_match, src: string) => `[Generated video](${src})`
  );
  // Self-closing / leftover open tags
  text = text.replace(/<\/?video\b[^>]*>/gi, "");

  return text;
};

const isVideoUrl = (url: string) =>
  /\.(mp4|webm|ogg)(\?|$)/i.test(url) ||
  (/\/generated-media\//i.test(url) && /\.(mp4|webm|ogg)(\?|$)/i.test(url));

const MediaBlock = ({ children }: { children: ReactNode }) => (
  <div className="not-prose my-2 space-y-1">{children}</div>
);

const MediaDownloadButton = ({
  url,
  label,
  filename,
}: {
  url: string;
  label: string;
  filename: string;
}) => (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    className="mt-1 h-8 gap-1.5"
    asChild
  >
    <a
      href={downloadUrlFor(url)}
      download={filename}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </a>
  </Button>
);

const MarkdownMessageComponent = ({
  content,
  className,
}: MarkdownMessageProps) => {
  const markdown = useMemo(
    () => normalizeMediaMarkdown(content),
    [content]
  );

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        "prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-lg",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-code:rounded prose-code:bg-black/10 dark:prose-code:bg-white/10",
        "prose-code:px-1 prose-code:py-0.5",
        "prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Avoid <p><div> hydration errors around images/videos.
          p: ({ children }) => <div className="my-2">{children}</div>,
          a: ({ href, children, ...props }) => {
            const url = String(href || "");
            if (isVideoUrl(url)) {
              const filename = filenameFromUrl(url, "generated-video.mp4");
              return (
                <MediaBlock>
                  <video
                    controls
                    src={url}
                    className="max-h-80 w-full rounded-lg bg-black"
                  />
                  <MediaDownloadButton
                    url={url}
                    filename={filename}
                    label="Download video"
                  />
                </MediaBlock>
              );
            }
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const url = String(src || "");
            const filename = filenameFromUrl(url, "generated-image.png");
            return (
              <MediaBlock>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={alt || "Generated image"}
                  className="max-h-96 max-w-full rounded-lg object-contain"
                />
                {url ? (
                  <MediaDownloadButton
                    url={url}
                    filename={filename}
                    label="Download image"
                  />
                ) : null}
              </MediaBlock>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownMessage = memo(MarkdownMessageComponent);
