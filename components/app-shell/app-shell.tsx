"use client";

import type { ReactNode } from "react";

import { ShellProvider } from "./shell-context";
import { ForgeAppShell } from "@/components/forge/app-shell";

/**
 * Top-level application chrome.
 *
 * Delegates to the redesigned ForgeAppShell which composes:
 * TopBar, ForgeSidebar, main content area, ActivityDrawer,
 * ShortcutsModal, NewProjectDialog, and AgentNotifications.
 *
 * ShellProvider is wrapped here so it remains above ForgeAppShell
 * (which consumes useShell internally).
 *
 * Rendered from the root layout so every route shares the shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellProvider>
      <ForgeAppShell>{children}</ForgeAppShell>
    </ShellProvider>
  );
}
