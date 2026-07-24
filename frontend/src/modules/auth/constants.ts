import { UserRole } from "@/modules/shared/types";

export const ADMIN_ONLY_ROLES: UserRole[] = ["Admin"];

export const ADMIN_ROUTE_PREFIXES = [
  "/users",
  "/analytics",
  "/keyword-assistants",
  "/ai-logs",
  "/generated-resources",
] as const;
