"use client";

import React from "react";

export type ActiveProject = {
  id: number;
  name: string;
  folderPath: string;
  status: string;
};

type ProjectContextValue = {
  activeProject: ActiveProject | null;
  isRunning: boolean;
  runningCount: number;
  /**
   * Monotonic counter that project-view subscribes to. Bump it from anywhere
   * (e.g. the top-bar "run queue" / "pause all" buttons) to force an
   * immediate orchestrator refresh instead of waiting for the 5s poll tick.
   */
  refreshTick: number;
  setActiveProject: (p: ActiveProject | null) => void;
  setIsRunning: (r: boolean) => void;
  setRunningCount: (n: number) => void;
  requestRefresh: () => void;
};

const ProjectContext = React.createContext<ProjectContextValue>({
  activeProject: null,
  isRunning: false,
  runningCount: 0,
  refreshTick: 0,
  setActiveProject: () => {},
  setIsRunning: () => {},
  setRunningCount: () => {},
  requestRefresh: () => {},
});

export function useActiveProject() {
  return React.useContext(ProjectContext);
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [activeProject, setActiveProject] =
    React.useState<ActiveProject | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);
  const [runningCount, setRunningCount] = React.useState(0);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const requestRefresh = React.useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  const value = React.useMemo<ProjectContextValue>(
    () => ({
      activeProject,
      isRunning,
      runningCount,
      refreshTick,
      setActiveProject,
      setIsRunning,
      setRunningCount,
      requestRefresh,
    }),
    [activeProject, isRunning, runningCount, refreshTick, requestRefresh],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
