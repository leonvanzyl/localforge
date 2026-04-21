"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Cog,
  FolderPlus,
  FolderKanban,
  Hammer,
  Menu,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useShell } from "./shell-context";

/**
 * Sidebar navigation for the LocalForge app shell.
 *
 * Claude Code desktop-inspired layout: the sidebar is visible on the left
 * at all desktop widths and collapses behind a hamburger menu on mobile.
 *
 * The project list and dialog state come from the ShellProvider context so
 * creating a project anywhere in the app immediately refreshes the sidebar.
 */
const COLLAPSED_STORAGE_KEY = "localforge.sidebar.collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { projects, openNewProjectDialog } = useShell();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Close mobile drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Load persisted collapse state (desktop only)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {
      // ignore storage failures
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  };

  const isSettings = pathname?.startsWith("/settings");

  return (
    <>
      {/* Mobile hamburger trigger - visible only below md */}
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
        data-testid="sidebar-toggle"
        onClick={() => setMobileOpen((v) => !v)}
        className="fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm md:hidden"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        aria-label="Primary navigation"
        role="navigation"
        data-testid="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-border bg-card text-card-foreground transition-[transform,width] duration-200",
          "md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-16" : "md:w-72",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 border-b border-border py-4",
            collapsed ? "px-3 justify-center" : "px-5",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Hammer className="h-4 w-4" aria-hidden="true" />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold tracking-tight">
                LocalForge
              </span>
              <span className="truncate text-xs text-muted-foreground">
                Local autonomous coding
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            data-testid="sidebar-collapse-toggle"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "hidden md:inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              collapsed ? "mt-2" : "ml-auto",
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <div
          className={cn(
            "flex items-center pb-2 pt-4",
            collapsed ? "justify-center px-2" : "justify-between px-5",
          )}
        >
          {!collapsed && (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Projects
            </h2>
          )}
          <button
            type="button"
            onClick={openNewProjectDialog}
            aria-label="Create new project"
            title={collapsed ? "New project" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              collapsed
                ? "h-9 w-9 justify-center p-0"
                : "px-2 py-1 text-xs",
            )}
            data-testid="sidebar-new-project"
          >
            <FolderPlus
              className={collapsed ? "h-4 w-4" : "h-3.5 w-3.5"}
              aria-hidden="true"
            />
            {!collapsed && <span>New</span>}
          </button>
        </div>

        <nav
          className={cn(
            "flex-1 overflow-y-auto pb-4",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {projects === null && !collapsed && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Loading projects…
            </p>
          )}
          {projects !== null && projects.length === 0 && !collapsed && (
            <div
              data-testid="sidebar-empty-state"
              className="mx-2 mt-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">No projects yet</p>
              <p className="mt-1 text-xs">
                Create your first project to start building with local models.
              </p>
            </div>
          )}
          {projects !== null && projects.length > 0 && (
            <ul className="space-y-1" data-testid="sidebar-project-list">
              {projects.map((p) => {
                const active = pathname === `/projects/${p.id}`;
                const total = p.featureCount ?? 0;
                const done = p.completedCount ?? 0;
                const fullyDone = total > 0 && done === total;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      data-testid={`sidebar-project-${p.id}`}
                      data-active={active ? "true" : "false"}
                      data-feature-total={total}
                      data-feature-done={done}
                      aria-label={
                        collapsed
                          ? `${p.name} — ${done} of ${total} features done`
                          : undefined
                      }
                      title={
                        collapsed
                          ? `${p.name} (${done}/${total})`
                          : undefined
                      }
                      className={cn(
                        "flex items-center gap-2 rounded-md text-sm transition-colors",
                        collapsed
                          ? "justify-center px-2 py-2"
                          : "justify-between px-3 py-2",
                        active
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-2",
                          collapsed && "justify-center",
                        )}
                      >
                        <FolderKanban
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                        {!collapsed && (
                          <span className="truncate">{p.name}</span>
                        )}
                      </span>
                      {!collapsed && (
                        <span
                          data-testid={`sidebar-project-progress-${p.id}`}
                          aria-label={`${done} of ${total} features done`}
                          title={`${done} of ${total} features done`}
                          className={cn(
                            "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            fullyDone
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : active
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-background/60 text-muted-foreground",
                          )}
                        >
                          {done}/{total}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div
          className={cn(
            "flex items-center border-t border-border py-3",
            collapsed
              ? "flex-col gap-2 px-2"
              : "gap-2 px-3",
          )}
        >
          <Link
            href="/settings"
            data-testid="sidebar-settings-link"
            aria-label="Open settings"
            title={collapsed ? "Settings" : undefined}
            className={cn(
              "flex items-center rounded-md text-sm",
              collapsed
                ? "h-9 w-9 justify-center"
                : "flex-1 gap-2 px-3 py-2",
              isSettings
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Cog className="h-4 w-4" aria-hidden="true" />
            {!collapsed && <span>Settings</span>}
          </Link>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
