"use client";

import ProjectDetailPage from "@/views/ProjectDetailPage";
import AuthGuard from "@/components/AuthGuard";

export default function ProjectDetailRoute() {
  return (
    <AuthGuard>
      <ProjectDetailPage />
    </AuthGuard>
  );
}
