"use client";

import React from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import Sidebar from "./Sidebar";

type LayoutProps = {
  children: React.ReactNode;
  /** Sidebar open by default (false = icon rail). */
  defaultOpen?: boolean;
  /** Hide the app sidebar completely (full-width canvas). */
  hideSidebar?: boolean;
  /** Shadcn sidebar collapse mode. */
  sidebarCollapsible?: "offcanvas" | "icon" | "none";
};

const Layout: React.FC<LayoutProps> = ({
  children,
  defaultOpen = true,
  hideSidebar = false,
  sidebarCollapsible = "offcanvas",
}) => {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <div className="flex min-h-screen w-full">
        {!hideSidebar && <Sidebar collapsible={sidebarCollapsible} />}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </SidebarProvider>
  );
};

export default Layout;
