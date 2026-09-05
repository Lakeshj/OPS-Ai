"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { workspaceApiService } from "@/lib/apiService";
import { UserRole, Workspace } from "@/lib/types";
import {
  LogOut,
  UserCog,
  FolderKanban,
  MessageSquare,
  KeyRound,
  LayoutDashboard,
  BarChart3,
  ScrollText,
  Images,
  Moon,
  Sun,
} from "lucide-react";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsible?: "offcanvas" | "icon" | "none";
};

const Sidebar: React.FC<SidebarProps> = ({ collapsible = "offcanvas" }) => {
  const { signOut, user, hasRole } = useAuth();
  const pathname = usePathname();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (!user) return;

      try {
        let userWorkspaces;

        if (hasRole(["Admin", "Project Manager"])) {
          userWorkspaces = await workspaceApiService.getAll();
        } else {
          userWorkspaces = await workspaceApiService.getByUserId(user.id);
        }

        setWorkspaces(userWorkspaces);
      } catch (error) {
        console.error("Error fetching workspaces:", error);
      }
    };

    fetchWorkspaces();
  }, [user, hasRole]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const mainNavItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboard size={20} />,
      href: "/dashboard",
      requiresRoles: ["Admin", "Project Manager", "Employee"],
    },
    {
      name: "Workspaces",
      icon: <FolderKanban size={20} />,
      href: "/projects",
      requiresRoles: ["Admin", "Project Manager", "Employee"],
    },
    {
      name: "Analytics",
      icon: <BarChart3 size={20} />,
      href: "/analytics",
      requiresRoles: ["Admin"],
    },
    {
      name: "User Management",
      icon: <UserCog size={20} />,
      href: "/users",
      requiresRoles: ["Admin"],
    },
    {
      name: "AI Assistants",
      icon: <KeyRound size={20} />,
      href: "/keyword-assistants",
      requiresRoles: ["Admin"],
    },
    {
      name: "AI Logs",
      icon: <ScrollText size={20} />,
      href: "/ai-logs",
      requiresRoles: ["Admin"],
    },
    {
      name: "Generated resources",
      icon: <Images size={20} />,
      href: "/generated-resources",
      requiresRoles: ["Admin"],
    },
  ];

  const initial = (user?.name?.[0] || "?").toUpperCase();

  return (
    <ShadcnSidebar
      collapsible={collapsible}
      className="app-main-sidebar border-r border-border bg-background dark:bg-gray-900"
    >
      <SidebarHeader
        className={cn(
          "border-b border-border bg-card dark:bg-gray-800",
          collapsed ? "flex items-center justify-center p-2" : "p-4"
        )}
      >
        <div
          className={cn(
            "flex w-full items-center",
            collapsed ? "flex-col gap-2" : "justify-between"
          )}
        >
          <div
            className={cn(
              "flex items-center",
              collapsed ? "justify-center" : "gap-3"
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
              <MessageSquare size={16} className="text-white" />
            </div>
            {!collapsed && (
              <h1 className="text-lg font-semibold text-foreground dark:text-white">
                OpsAi
              </h1>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDarkMode(!darkMode)}
            className="h-8 w-8 shrink-0 hover:bg-accent"
            title={darkMode ? "Light mode" : "Dark mode"}
          >
            {darkMode ? (
              <Sun size={16} className="text-foreground" />
            ) : (
              <Moon size={16} className="text-foreground" />
            )}
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent
        className={cn(
          "bg-card dark:bg-gray-800",
          collapsed && "items-center px-1"
        )}
      >
        <SidebarGroup className={collapsed ? "p-1" : undefined}>
          {!collapsed && (
            <SidebarGroupLabel className="font-semibold text-foreground dark:text-gray-300">
              Navigation
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems
                .filter((item) => hasRole(item.requiresRoles as UserRole[]))
                .map((item) => (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.name}
                      className="rounded-xl transition-all duration-300 hover:bg-accent dark:hover:bg-gray-700 data-[active=true]:bg-accent dark:data-[active=true]:bg-gray-600"
                    >
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2",
                          collapsed && "justify-center"
                        )}
                      >
                        <span className="text-foreground dark:text-gray-300">
                          {item.icon}
                        </span>
                        <span className="font-medium text-foreground dark:text-gray-300">
                          {item.name}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className={collapsed ? "p-1" : undefined}>
          {!collapsed && (
            <SidebarGroupLabel className="font-semibold text-foreground dark:text-gray-300">
              All Workspaces
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaces.length > 0 ? (
                workspaces.map((workspace) => (
                  <SidebarMenuItem key={workspace.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === `/projects/${workspace.id}`}
                      tooltip={workspace.name}
                      className="rounded-xl transition-all duration-300 hover:bg-accent dark:hover:bg-gray-700 data-[active=true]:bg-accent dark:data-[active=true]:bg-gray-600"
                    >
                      <Link
                        href={`/projects/${workspace.id}`}
                        className={cn(
                          "flex items-center gap-2",
                          collapsed && "justify-center"
                        )}
                      >
                        <MessageSquare
                          size={16}
                          className="shrink-0 text-foreground dark:text-gray-300"
                        />
                        <span className="truncate font-medium text-foreground dark:text-gray-300">
                          {workspace.name}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                !collapsed && (
                  <div className="px-3 py-2 text-xs text-muted-foreground dark:text-gray-500">
                    No workspaces available
                  </div>
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter
        className={cn(
          "border-t border-border bg-card dark:bg-gray-800",
          collapsed ? "items-center gap-2 p-2" : "p-4"
        )}
      >
        <div
          className={cn(
            "flex w-full items-center",
            collapsed ? "justify-center" : "mb-3 justify-between"
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-blue-500 text-sm font-medium text-white shadow-lg"
                aria-label={user?.name || "User"}
              >
                {initial}
              </div>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.role}</p>
              </TooltipContent>
            )}
          </Tooltip>
          {!collapsed && (
            <div className="min-w-0 flex-1 pl-3">
              <p className="truncate text-sm font-medium text-foreground dark:text-white">
                {user?.name}
              </p>
              <p className="text-xs text-muted-foreground dark:text-gray-400">
                {user?.role}
              </p>
            </div>
          )}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => signOut()}
              className={cn(
                "flex items-center justify-center transition-all duration-300",
                collapsed
                  ? "h-8 w-8 rounded-xl text-foreground hover:bg-accent dark:text-gray-300 dark:hover:bg-gray-700"
                  : "w-full gap-2 rounded-xl bg-gradient-to-r from-red-500 to-pink-600 px-3 py-2 text-sm font-medium text-white shadow-lg hover:from-red-600 hover:to-pink-700"
              )}
              aria-label="Sign out"
            >
              <LogOut size={16} />
              {!collapsed && <span>Sign Out</span>}
            </button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">Sign out</TooltipContent>
          )}
        </Tooltip>
      </SidebarFooter>
    </ShadcnSidebar>
  );
};

export default Sidebar;
