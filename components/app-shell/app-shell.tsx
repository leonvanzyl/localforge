"use client";

import type { ReactNode } from "react";

import { NewProjectDialog } from "./new-project-dialog";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { AgentNotifications } from "@/components/agent/agent-notifications";

/**
 * Top-level application chrome: sidebar on the left, main content on the
 * right, and a singleton "new project" dialog mounted once at the root so
 * both the sidebar's "New" button and the empty-state CTA can open it.
 *
 * Rendered from the root layout so every route shares the shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellProvider>
      <div className="flex h-screen w-full bg-background text-foreground">
        <Sidebar />
        {/* h-screen + min-h-0 on the flex item pins the shell row to the
            viewport height, so the sidebar's internal overflow-y-auto
            and the project page's nested overflow-hidden both bite
            instead of the whole document scrolling. min-w-0 still
            prevents wide content (kanban's min-w-[280px] columns) from
            squashing the fixed-width sidebar on narrow viewports. */}
        <main
          id="main-content"
          data-testid="main-content"
          role="main"
          className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {children}
        </main>
      </div>
      <NewProjectDialog />
      <AgentNotifications />
    </ShellProvider>
  );
}
