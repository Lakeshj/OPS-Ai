"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Workflows live inside a workspace (Chat | Workflow). Redirect old /workflows list. */
export default function WorkflowsRoute() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/projects");
  }, [router]);
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Opening workspaces… create workflows from inside a workspace.
    </div>
  );
}
