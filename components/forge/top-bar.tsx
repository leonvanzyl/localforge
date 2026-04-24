"use client";

import React from "react";
import { useTheme } from "@/components/theme/theme-provider";
import {
  PlayIcon,
  PauseIcon,
  ActivityIcon,
  KeyboardIcon,
  MoonIcon,
  SunIcon,
} from "@/components/forge/icons";

type TopBarProps = {
  activeProject: {
    id: number;
    name: string;
    folderPath: string;
    status: string;
  } | null;
  isRunning: boolean;
  onStartAll: () => void;
  onPauseAll: () => void;
  onToggleDrawer: () => void;
  onToggleShortcuts: () => void;
  drawerOpen: boolean;
};

export function TopBar({
  activeProject,
  isRunning,
  onStartAll,
  onPauseAll,
  onToggleDrawer,
  onToggleShortcuts,
  drawerOpen,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="topbar">
      {/* Brand */}
      <div className="brand">
        <span className="mark">L</span>
        <span className="name">LocalForge</span>
        <span className="sub">&mdash; local agents at work</span>
      </div>

      {/* Vertical divider */}
      <div
        style={{
          width: 1,
          height: 24,
          background: "var(--line)",
          margin: "0 4px",
        }}
      />

      {/* Workspace breadcrumb (only when a project is selected) */}
      {activeProject && (
        <div className={"ws-crumb " + (isRunning ? "" : "idle")}>
          <span className="dot" />
          <span className="nm">{activeProject.name}</span>
          <span className="pth">{activeProject.folderPath}</span>
        </div>
      )}

      {/* Flex spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div className="tb-actions">
        {isRunning ? (
          <button className="btn" onClick={onPauseAll}>
            <PauseIcon size={14} />
            pause all
          </button>
        ) : (
          <button className="btn primary" onClick={onStartAll}>
            <PlayIcon size={14} />
            run queue
          </button>
        )}

        <button className="btn icon-btn ghost" onClick={onToggleDrawer}>
          <ActivityIcon size={16} />
        </button>

        <button className="btn icon-btn ghost" onClick={onToggleShortcuts}>
          <KeyboardIcon size={16} />
        </button>

        <button className="btn icon-btn ghost" onClick={toggleTheme}>
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
      </div>
    </div>
  );
}
