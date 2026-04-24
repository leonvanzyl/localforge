"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShell } from "@/components/app-shell/shell-context";
import {
  PlusIcon,
  ActivityIcon,
  SettingsIcon,
} from "@/components/forge/icons";

export function ForgeSidebar() {
  const { projects, openNewProjectDialog } = useShell();
  const pathname = usePathname();

  // Determine the active project ID from the URL
  const activeProjectId = React.useMemo(() => {
    const match = pathname?.match(/\/projects\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [pathname]);

  const projectList = projects ?? [];

  return (
    <aside className="lf-sidebar">
      {/* Header */}
      <div className="side-head">
        <span className="title">Workspaces</span>
        <span className="count">{projectList.length}</span>
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
      <div className="new-ws" onClick={openNewProjectDialog}>
        <PlusIcon size={16} />
        new workspace
      </div>

      {/* Footer */}
      <div className="side-foot">
        <button className="btn icon-btn ghost">
          <ActivityIcon size={16} />
        </button>
        <div style={{ flex: 1 }} />
        <Link href="/settings" style={{ textDecoration: "none", color: "inherit" }}>
          <button className="btn icon-btn ghost">
            <SettingsIcon size={16} />
          </button>
        </Link>
      </div>
    </aside>
  );
}
