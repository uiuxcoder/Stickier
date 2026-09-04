"use client";

import { useState } from "react";
import { Download, Loader2Icon } from "lucide-react";

type StickerDownloadLinkProps = {
  href: string;
  className?: string;
  iconSize?: number;
  "aria-label"?: string;
  title?: string;
  children?: React.ReactNode;
};

function filenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

// Downloads via fetch instead of a native <a download> so the button can show
// a spinner for the duration of the request instead of an instant, silent kick-off.
export function StickerDownloadLink({ href, className, iconSize, children, ...rest }: StickerDownloadLinkProps) {
  const [downloading, setDownloading] = useState(false);

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (downloading || !href || href === "#") return;
    setDownloading(true);
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filenameFromResponse(response, "stickier-stickers.zip");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.location.href = href;
    } finally {
      setDownloading(false);
    }
  }

  return (
    <a href={href} download className={className} aria-busy={downloading} onClick={handleClick} {...rest}>
      {downloading ? <Loader2Icon size={iconSize} className="sticker-download-spinner" aria-hidden="true" /> : <Download size={iconSize} aria-hidden="true" />}
      {children}
    </a>
  );
}
