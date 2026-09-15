"use client";

import React from "react";
import { Globe, Info, Layers, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CredentialSharingScope = "all" | "workspace" | "users";

const SHARING_OPTIONS: {
  value: CredentialSharingScope;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "all",
    label: "All users and projects",
    description:
      "Anyone who can edit workflows in this workspace can select and use this connection.",
    icon: Globe,
  },
  {
    value: "workspace",
    label: "This workspace only",
    description:
      "Only members of this workspace can use this connection in their workflows.",
    icon: Layers,
  },
  {
    value: "users",
    label: "Specific users",
    description:
      "Share with selected workspace members. Per-user sharing is coming soon.",
    icon: Users,
  },
];

type Props = {
  value: CredentialSharingScope;
  onChange: (value: CredentialSharingScope) => void;
  disabled?: boolean;
  className?: string;
};

export function CredentialSharingPanel({
  value,
  onChange,
  disabled = false,
  className,
}: Props) {
  const active =
    SHARING_OPTIONS.find((opt) => opt.value === value) || SHARING_OPTIONS[0];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p className="leading-relaxed">
          Sharing a credential allows people to use it in their workflows. They
          cannot access credential details, tokens, or secrets.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Share with
        </Label>
        <Select
          value={value}
          onValueChange={(next) => onChange(next as CredentialSharingScope)}
          disabled={disabled}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder="All users and projects" />
          </SelectTrigger>
          <SelectContent>
            {SHARING_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 opacity-70" />
                    {opt.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
          <active.icon className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-medium">{active.label}</p>
        </div>
        <p className="px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {active.description}
        </p>
      </div>

      {value === "users" ? (
        <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          Per-user sharing will be available in a future release. Use{" "}
          <span className="font-medium text-foreground">
            All users and projects
          </span>{" "}
          for now.
        </div>
      ) : null}
    </div>
  );
}
