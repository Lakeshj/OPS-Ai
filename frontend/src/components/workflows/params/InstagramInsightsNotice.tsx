"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import type { WorkflowCredential } from "@/modules/workflows/types";
import {
  credentialHasInsightsPermission,
  insightsPermissionBlockedMessage,
} from "@/modules/workflows/instagramPermissions";

type Props = {
  credential?: WorkflowCredential | null;
  onReconnect?: () => void;
};

export function InstagramInsightsNotice({ credential, onReconnect }: Props) {
  const status = credentialHasInsightsPermission(credential);
  if (status !== false) return null;

  return (
    <div
      className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2"
      data-instagram-insights-permission="missing"
      role="status"
    >
      <p className="text-[11px] text-amber-950 dark:text-amber-100">
        {insightsPermissionBlockedMessage()}
      </p>
      {onReconnect ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-instagram-insights-reconnect="true"
          onClick={onReconnect}
        >
          Reconnect Instagram
        </Button>
      ) : null}
    </div>
  );
}
