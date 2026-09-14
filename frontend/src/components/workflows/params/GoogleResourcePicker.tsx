"use client";

import React from "react";
import { ResourceLocatorField } from "./ResourceLocatorField";
import type { ExpressionFieldContext } from "../ExpressionField";

type Option = { id: string; label: string };

type Props = {
  kind: "gscSites" | "ga4Properties" | "gmailLabels" | "sheetTabs" | "aiModels" | "spreadsheetId";
  workspaceId?: string;
  credentialId: string;
  value: unknown;
  onChange: (value: unknown, extra?: Record<string, unknown>) => void;
  label: string;
  placeholder?: string;
  modes?: Array<"account" | "manual" | "expression">;
  accountModeLabel?: string;
  manualModeLabel?: string;
  mode?: string;
  displayName?: string;
  displayNameField?: string;
  multi?: boolean;
  spreadsheetId?: string;
  provider?: string;
  previewContext?: ExpressionFieldContext;
  /** @deprecated unused — kept so older call sites type-check */
  options?: Option[];
};

/** Thin wrapper around the shared resource locator (GSC/GA4 originally). */
export function GoogleResourcePicker(props: Props) {
  return <ResourceLocatorField {...props} />;
}
