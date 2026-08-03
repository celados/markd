"use client";

import { Apple } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import { VERSION } from "@/lib/config";
import { ButtonLink } from "@/components/ui/button";

type DownloadLinkProps = {
  href: string;
  label: string;
  platform: "macos";
  format: "dmg";
  primary?: boolean;
};

export function DownloadLink({
  href,
  label,
  platform,
  format,
  primary = false,
}: DownloadLinkProps) {
  const track = useAnalytics();

  return (
    <ButtonLink
      href={href}
      size="md"
      variant={primary ? "primary" : "outline"}
      className="w-full sm:w-auto"
      onClick={() => track("download_started", { version: VERSION, platform, format })}
    >
      <Apple className="size-4" strokeWidth={1.8} aria-hidden />
      {label}
    </ButtonLink>
  );
}
