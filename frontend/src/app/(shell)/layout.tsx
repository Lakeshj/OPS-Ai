"use client";

import { usePathname } from "next/navigation";
import Layout from "@/components/Layout";
import AuthGuard from "@/components/AuthGuard";
import {
  ADMIN_ONLY_ROLES,
  ADMIN_ROUTE_PREFIXES,
} from "@/modules/auth/constants";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const requiresAdmin = ADMIN_ROUTE_PREFIXES.some((route) =>
    pathname.startsWith(route)
  );

  return (
    <AuthGuard allowedRoles={requiresAdmin ? ADMIN_ONLY_ROLES : undefined}>
      <Layout>{children}</Layout>
    </AuthGuard>
  );
}
