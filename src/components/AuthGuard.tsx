"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { UserRole } from "@/modules/shared/types";

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const AuthGuard = ({ children, allowedRoles = [] }: AuthGuardProps) => {
  const { isAuthenticated, user, isLoading } = useAuth();
  const router = useRouter();
  const allowedRolesKey = allowedRoles.join("|");

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace("/");
      return;
    }

    if (
      allowedRoles.length > 0 &&
      user &&
      !allowedRoles.includes(user.role)
    ) {
      router.replace("/dashboard");
    }
  }, [isLoading, isAuthenticated, user, allowedRolesKey, allowedRoles, router]);

  if (isLoading) {
    return (
      <div
        className="flex justify-center items-center h-screen"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading</span>
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (
    allowedRoles.length > 0 &&
    user &&
    !allowedRoles.includes(user.role)
  ) {
    return null;
  }

  return <>{children}</>;
};

export default AuthGuard;
