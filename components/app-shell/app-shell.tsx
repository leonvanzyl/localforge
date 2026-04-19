"use client";

import type { ReactNode } from "react";

import { NewProjectDialog } from "./new-project-dialog";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";

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
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <Sidebar />
        {/* min-w-0 is critical: without it the main's content (e.g. the
            kanban's min-w-[280px] columns) would expand the flex item and
            squash the fixed-width sidebar on narrow viewports like
            tablets. min-w-0 lets flex-1 honour the remaining space. */}
        <main
          id="main-content"
          data-testid="main-content"
          role="main"
          className="flex min-h-screen min-w-0 flex-1 flex-col"
        >
          {children}
        </main>
      </div>
      <NewProjectDialog />
    </ShellProvider>
  );
}
