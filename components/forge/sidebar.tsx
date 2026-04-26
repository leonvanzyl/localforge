"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShell } from "@/components/app-shell/shell-context";
import {
  PlusIcon,
  ActivityIcon,
  SettingsIcon,
  PanelLeftIcon,
} from "@/components/forge/icons";

const COLLAPSED_STORAGE_KEY = "localforge.sidebar.collapsed";

type ForgeSidebarProps = {
  /** Mobile drawer open state. Ignored on desktop. */
  mobileOpen?: boolean;
  /** Called to close the mobile drawer (e.g. after navigation). */
  onMobileClose?: () => void;
};

export function ForgeSidebar({ mobileOpen = false, onMobileClose }: ForgeSidebarProps) {
  const { projects, openNewProjectDialog } = useShell();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore storage failures */
      }
      return next;
    });
  }, []);

  // Determine the active project ID from the URL
  const activeProjectId = React.useMemo(() => {
    const match = pathname?.match(/\/projects\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [pathname]);

  const projectList = projects ?? [];

  // Tapping a workspace closes the mobile drawer so users see the board.
  // No-op on desktop where the prop is ignored.
  const handleWorkspaceClick = React.useCallback(() => {
    onMobileClose?.();
  }, [onMobileClose]);

  return (
    <aside
      className="lf-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      {/* Header */}
      <div className="side-head">
        <span className="title">Workspaces</span>
        <span className="count">{projectList.length}</span>
        <button
          type="button"
          className="btn icon-btn ghost side-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-collapse-toggle"
        >
          <PanelLeftIcon size={16} />
        </button>
        {/* Close button for the mobile drawer (hidden on desktop via CSS). */}
        <button
          type="button"
          className="btn icon-btn ghost side-mobile-close"
          onClick={onMobileClose}
          aria-label="Close navigation"
          title="Close navigation"
          data-testid="sidebar-mobile-close"
        >
          <PanelLeftIcon size={16} />
        </button>
      </div>

      {/* Project list */}
      <div className="ws-list">
        {projectList.map((p) => {
          const isActive = p.id === activeProjectId;
          const total = p.featureCount ?? 0;
          const completed = p.completedCount ?? 0;
          const backlog = total - completed;
          const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
              title={p.name}
              onClick={handleWorkspaceClick}
            >
              <div className={"ws-item " + (isActive ? "active" : "")}>
                <div className="ws-row">
                  <div className="ws-indicator" />
                  <div className="ws-name">{p.name}</div>
                </div>
                <div className="ws-path">{p.status}</div>
                <div className="ws-meta">
                  {total > 0 && (
                    <>
                      <span>{backlog} backlog</span>
                      <span>{completed} done</span>
                    </>
                  )}
                  {total === 0 && <span>no features</span>}
                </div>
                {total > 0 && (
                  <div className="ws-progress">
                    <div style={{ width: progress + "%" }} />
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {/* New workspace button */}
      <div
        className="new-ws"
        onClick={openNewProjectDialog}
        title="new workspace"
      >
        <PlusIcon size={16} />
        <span className="label">new workspace</span>
      </div>

      {/* Footer */}
      <div className="side-foot">
        <button className="btn icon-btn ghost" title="Activity">
          <ActivityIcon size={16} />
        </button>
        <div className="spacer" />
        <Link href="/settings" style={{ textDecoration: "none", color: "inherit" }}>
          <button className="btn icon-btn ghost" title="Settings">
            <SettingsIcon size={16} />
          </button>
        </Link>
      </div>
    </aside>
  );
}
