"use client";

import * as React from "react";

/**
 * React context shared by the AppShell.
 *
 * Both the Sidebar and the main content area (including the empty-state
 * "Create Your First Project" CTA) need a single source of truth for:
 *   - whether the new-project dialog is open
 *   - the current project list, so the sidebar refreshes after creation
 *
 * The provider lives inside `AppShell` and wraps the entire app so any
 * client component under the root layout can consume it.
 */

export type ProjectListItem = {
  id: number;
  name: string;
  status: string;
  /** Total feature count for the project. May be 0. */
  featureCount?: number;
  /** Number of features in the "completed" status. May be 0. */
  completedCount?: number;
};

type ShellContextValue = {
  isNewProjectDialogOpen: boolean;
  openNewProjectDialog: () => void;
  closeNewProjectDialog: () => void;
  projects: ProjectListItem[] | null;
  refreshProjects: () => Promise<void>;
  setProjects: (p: ProjectListItem[]) => void;
};

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function useShell() {
  const ctx = React.useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used inside <AppShell>");
  }
  return ctx;
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [isNewProjectDialogOpen, setNewProjectDialogOpen] =
    React.useState(false);
  const [projects, setProjectsState] = React.useState<ProjectListItem[] | null>(
    null,
  );

  const refreshProjects = React.useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { projects: ProjectListItem[] };
      setProjectsState(data.projects ?? []);
    } catch {
      // leave previous list in place on failure; UI will stay usable.
    }
  }, []);

  React.useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const value = React.useMemo<ShellContextValue>(
    () => ({
      isNewProjectDialogOpen,
      openNewProjectDialog: () => setNewProjectDialogOpen(true),
      closeNewProjectDialog: () => setNewProjectDialogOpen(false),
      projects,
      refreshProjects,
      setProjects: setProjectsState,
    }),
    [isNewProjectDialogOpen, projects, refreshProjects],
  );

  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}
