"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Cog, FolderPlus, FolderKanban, Hammer, Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
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
export function Sidebar() {
  const pathname = usePathname();
  const { projects, openNewProjectDialog } = useShell();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-border bg-card text-card-foreground transition-transform duration-200",
          "md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Hammer className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">
              LocalForge
            </span>
            <span className="text-xs text-muted-foreground">
              Local autonomous coding
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Projects
          </h2>
          <button
            type="button"
            onClick={openNewProjectDialog}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid="sidebar-new-project"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            New
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {projects === null && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Loading projects…
            </p>
          )}
          {projects !== null && projects.length === 0 && (
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
                return (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      data-testid={`sidebar-project-${p.id}`}
                      data-active={active ? "true" : "false"}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FolderKanban
                          className={cn(
                            "h-4 w-4",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{p.name}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="border-t border-border px-3 py-3">
          <Link
            href="/settings"
            data-testid="sidebar-settings-link"
            aria-label="Open settings"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
              isSettings
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Cog className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
        </div>
      </aside>
    </>
  );
}
