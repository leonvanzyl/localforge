"use client";

import React from "react";
import { HelpCircle } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import {
  PlayIcon,
  PauseIcon,
  ActivityIcon,
  KeyboardIcon,
  MoonIcon,
  SunIcon,
  MenuIcon,
} from "@/components/forge/icons";

type TopBarProps = {
  activeProject: {
    id: number;
    name: string;
    folderPath: string;
    status: string;
  } | null;
  /**
   * The effective model + provider the orchestrator will actually use for
   * the active project (per-project override or global default). Surfaced
   * as a small badge so users can see at a glance which model is wired up,
   * especially while a run is in flight.
   */
  activeModel: { model: string; provider: string } | null;
  isRunning: boolean;
  onStartAll: () => void;
  onPauseAll: () => void;
  onToggleDrawer: () => void;
  onToggleShortcuts: () => void;
  onToggleHelp: () => void;
  onToggleMobileMenu: () => void;
  drawerOpen: boolean;
};

export function TopBar({
  activeProject,
  activeModel,
  isRunning,
  onStartAll,
  onPauseAll,
  onToggleDrawer,
  onToggleShortcuts,
  onToggleHelp,
  onToggleMobileMenu,
  drawerOpen,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="topbar">
      {/* Mobile-only hamburger menu — opens the sidebar drawer below the
          tablet breakpoint. Hidden on desktop via CSS. */}
      <button
        type="button"
        className="btn icon-btn ghost tb-mobile-menu"
        onClick={onToggleMobileMenu}
        aria-label="Open navigation"
        data-testid="topbar-mobile-menu"
      >
        <MenuIcon size={18} />
      </button>

      {/* Brand */}
      <div className="brand">
        <span className="mark">L</span>
        <span className="name">LocalForge</span>
        <span className="sub">&mdash; local agents at work</span>
      </div>

      {/* Vertical divider */}
      <div
        className="tb-divider"
        style={{
          width: 1,
          height: 24,
          background: "var(--line)",
          margin: "0 4px",
        }}
      />

      {/* Workspace breadcrumb (only when a project is selected) */}
      {activeProject && (
        <div
          className={"ws-crumb " + (isRunning ? "" : "idle")}
          title={activeProject.folderPath}
        >
          <span className="dot" />
          <span className="nm">{activeProject.name}</span>
          <span className="pth">{activeProject.folderPath}</span>
        </div>
      )}

      {/* Effective model badge (ENH-006). Surfaces which model the
          orchestrator will actually use, so the user doesn't have to dig
          into settings to confirm it — especially during runs, where the
          confusion between global default and project override has caused
          real mistakes (e.g. expecting qwen but unknowingly running on the
          global default llama3.2). */}
      {activeProject && activeModel && (
        <div
          className={"tb-model " + (isRunning ? "running" : "")}
          data-testid="topbar-active-model"
          title={`${activeModel.provider} · ${activeModel.model}`}
        >
          <span className="tb-model-provider">{activeModel.provider}</span>
          <span className="tb-model-sep">·</span>
          <span className="tb-model-name">{activeModel.model}</span>
        </div>
      )}

      {/* Flex spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div className="tb-actions">
        {/* Run/Pause is project-scoped: hide it when no project is active so
            users on /settings or other non-project routes don't click a
            button that silently no-ops (BUG-004). */}
        {activeProject ? (
          isRunning ? (
            <button
              className="btn tb-run-btn"
              onClick={onPauseAll}
              aria-label="Pause all agents"
              title="Pause all agents"
            >
              <PauseIcon size={14} />
              <span className="tb-run-label">pause all</span>
            </button>
          ) : (
            <button
              className="btn primary tb-run-btn"
              onClick={onStartAll}
              aria-label="Run queue"
              title="Run queue"
            >
              <PlayIcon size={14} />
              <span className="tb-run-label">run queue</span>
            </button>
          )
        ) : null}

        <button
          className="btn icon-btn ghost"
          onClick={onToggleDrawer}
          aria-label="Toggle activity drawer"
          title="Toggle activity drawer"
        >
          <ActivityIcon size={16} />
        </button>

        <button
          type="button"
          className="btn icon-btn ghost"
          onClick={onToggleHelp}
          aria-label="Open help & tech guide"
          title="Help & tech guide"
        >
          <HelpCircle size={16} />
        </button>

        <button
          className="btn icon-btn ghost tb-shortcuts-btn"
          onClick={onToggleShortcuts}
          aria-label="Show keyboard shortcuts"
          title="Show keyboard shortcuts"
        >
          <KeyboardIcon size={16} />
        </button>

        <button
          className="btn icon-btn ghost"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
      </div>
    </div>
  );
}
