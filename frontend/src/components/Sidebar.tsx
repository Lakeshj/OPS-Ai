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
  Sun
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

const Sidebar: React.FC = () => {
  const { signOut, user, hasRole } = useAuth();
  const pathname = usePathname();
  const { state } = useSidebar();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (!user) return;
      
      try {
        let userWorkspaces;
        
        if (hasRole(['Admin', 'Project Manager'])) {
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
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
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

  return (
    <ShadcnSidebar className="app-main-sidebar border-r border-border bg-background dark:bg-gray-900">
      <SidebarHeader className="p-4 border-b border-border bg-card dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
              <MessageSquare size={16} className="text-white" />
            </div>
            {state === "expanded" && (
              <h1 className="text-lg font-semibold text-foreground dark:text-white">
                OpsAi
              </h1>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDarkMode(!darkMode)}
              className="h-8 w-8 hover:bg-accent"
            >
              {darkMode ? (
                <Sun size={16} className="text-foreground" />
              ) : (
                <Moon size={16} className="text-foreground" />
              )}
            </Button>
            {/* <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-8 w-8 hover:bg-accent"
            >
              {state === "expanded" ? (
                <ChevronLeft size={16} className="text-foreground" />
              ) : (
                <ChevronRight size={16} className="text-foreground" />
              )}
            </Button> */}
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent className="bg-card dark:bg-gray-800">
        <SidebarGroup>
          <SidebarGroupLabel className="text-foreground dark:text-gray-300 font-semibold">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems
                .filter((item) => hasRole(item.requiresRoles as UserRole[]))
                .map((item) => (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={pathname === item.href}
                      className="hover:bg-accent dark:hover:bg-gray-700 data-[active=true]:bg-accent dark:data-[active=true]:bg-gray-600 transition-all duration-300 rounded-xl"
                    >
                      <Link href={item.href} className="flex items-center gap-2">
                        <span className="text-foreground dark:text-gray-300">{item.icon}</span>
                        <span className="font-medium text-foreground dark:text-gray-300">{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-foreground dark:text-gray-300 font-semibold">All Workspaces</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaces.length > 0 ? (
                workspaces.map((workspace) => (
                  <SidebarMenuItem key={workspace.id}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={pathname === `/projects/${workspace.id}`}
                      className="hover:bg-accent dark:hover:bg-gray-700 data-[active=true]:bg-accent dark:data-[active=true]:bg-gray-600 transition-all duration-300 rounded-xl"
                    >
                      <Link href={`/projects/${workspace.id}`} className="flex items-center gap-2">
                        <MessageSquare size={16} className="text-foreground dark:text-gray-300" />
                        <span className="truncate text-foreground dark:text-gray-300 font-medium">{workspace.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-muted-foreground dark:text-gray-500">
                  No workspaces available
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="p-4 border-t border-border bg-card dark:bg-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white font-medium text-sm mr-3 shadow-lg">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            {state === "expanded" && (
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground dark:text-white truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground dark:text-gray-400">{user?.role}</p>
              </div>
            )}
          </div>
          {/* {state === "expanded" && (
            <button className="p-1.5 rounded-md hover:bg-accent dark:hover:bg-gray-700 text-muted-foreground dark:text-gray-400 hover:text-foreground transition-colors">
              <Settings size={16} />
            </button>
          )} */}
        </div>
        
        <button
          onClick={() => signOut()}
          className="w-full flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium bg-gradient-to-r from-red-500 to-pink-600 text-white hover:from-red-600 hover:to-pink-700 transition-all duration-300 shadow-lg"
        >
          <LogOut size={16} className="mr-2" />
          {state === "expanded" && "Sign Out"}
        </button>
      </SidebarFooter>
    </ShadcnSidebar>
  );
};

export default Sidebar;
