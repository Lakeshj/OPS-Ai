"use client";

import { Suspense } from "react";
import ProjectDetailPage from "@/views/ProjectDetailPage";
import AuthGuard from "@/components/AuthGuard";

export default function ProjectDetailRoute() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="p-6 text-sm text-muted-foreground">
            Loading workspace…
          </div>
        }
      >
        <ProjectDetailPage />
      </Suspense>
    </AuthGuard>
  );
}
