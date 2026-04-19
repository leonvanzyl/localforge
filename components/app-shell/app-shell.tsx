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
        <main
          id="main-content"
          data-testid="main-content"
          role="main"
          className="flex min-h-screen w-full flex-1 flex-col"
        >
          {children}
        </main>
      </div>
      <NewProjectDialog />
    </ShellProvider>
  );
}
