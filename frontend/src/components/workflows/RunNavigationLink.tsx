"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  href: string | null | undefined;
  label: string;
  disabledReason?: string | null;
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
};

/** Authorized run/workflow navigation control. */
export function RunNavigationLink({
  href,
  label,
  disabledReason,
  className,
  variant = "outline",
}: Props) {
  if (!href) {
    return (
      <span
        className={cn("text-[11px] italic text-muted-foreground", className)}
        title={disabledReason || undefined}
      >
        {disabledReason || label}
      </span>
    );
  }
  return (
    <Button
      asChild
      type="button"
      variant={variant}
      size="sm"
      className={cn("h-7 text-xs", className)}
    >
      <Link href={href}>{label}</Link>
    </Button>
  );
}
