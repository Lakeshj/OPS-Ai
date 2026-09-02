"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Layout from "@/components/Layout";
import AuthGuard from "@/components/AuthGuard";
import WorkflowEditorPage from "@/views/WorkflowEditorPage";

function WorkflowEditorRouteInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [focusMode, setFocusMode] = useState(
    () => searchParams.get("focus") === "1"
  );

  useEffect(() => {
    setFocusMode(searchParams.get("focus") === "1");
  }, [searchParams]);

  const handleFocusModeChange = useCallback(
    (next: boolean) => {
      setFocusMode(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("focus", "1");
      else params.delete("focus");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <Layout
      defaultOpen={false}
      hideSidebar={focusMode}
      sidebarCollapsible="icon"
    >
      <WorkflowEditorPage
        focusMode={focusMode}
        onFocusModeChange={handleFocusModeChange}
      />
    </Layout>
  );
}

export default function WorkflowEditorRoute() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="p-6 text-sm text-muted-foreground">Loading editor...</div>
        }
      >
        <WorkflowEditorRouteInner />
      </Suspense>
    </AuthGuard>
  );
}
