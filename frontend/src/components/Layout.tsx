"use client";

import React from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import Sidebar from "./Sidebar";

type LayoutProps = {
  children: React.ReactNode;
  /** Sidebar open by default (false = icon rail). */
  defaultOpen?: boolean;
  /** Hide the app sidebar completely (full-width canvas). */
  hideSidebar?: boolean;
  /**
   * Floating / chrome SidebarTrigger overlays.
   * Disable on pages that already expose their own trigger (e.g. workflow editor)
   * so you don't get duplicate sidebar icons on both sides.
   */
  showFloatingSidebarTrigger?: boolean;
  /** Shadcn sidebar collapse mode. Prefer "icon" so the rail never fully vanishes. */
  sidebarCollapsible?: "offcanvas" | "icon" | "none";
};

const Layout: React.FC<LayoutProps> = ({
  children,
  defaultOpen = true,
  hideSidebar = false,
  showFloatingSidebarTrigger = true,
  // Icon rail (not offcanvas): collapsed still shows nav icons; cookie=false used to hide everything.
  sidebarCollapsible = "icon",
}) => {
  const showChromeTrigger = !hideSidebar && showFloatingSidebarTrigger;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <div className="flex min-h-screen w-full">
        {!hideSidebar && <Sidebar collapsible={sidebarCollapsible} />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {showChromeTrigger && (
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:hidden">
              <SidebarTrigger aria-label="Toggle sidebar" />
              <span className="text-sm font-medium text-muted-foreground">
                Menu
              </span>
            </div>
          )}
          {showChromeTrigger && (
            <div className="absolute left-3 top-3 z-20 hidden md:block">
              <SidebarTrigger
                className="border border-border bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-accent"
                aria-label="Toggle sidebar"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
};

export default Layout;
