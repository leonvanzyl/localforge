import { notFound } from "next/navigation";

import { getProject } from "@/lib/projects";
import { getActiveSessionForProject } from "@/lib/agent-sessions";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { ProjectHeaderActions } from "@/components/app-shell/project-header-actions";
import { BootstrapperPanel } from "@/components/bootstrapper/bootstrapper-panel";
import { AgentActivityPanel } from "@/components/agent/agent-activity-panel";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    notFound();
  }

  const project = getProject(numericId);
  if (!project) {
    notFound();
  }

  // If there is an active bootstrapper session for this project, render the
  // AI chat panel instead of the kanban board. The session is created from
  // the New Project dialog when the user selects "Describe your project to
  // AI" (Feature #55).
  const bootstrapperSession = getActiveSessionForProject(
    project.id,
    "bootstrapper",
  );

  return (
    <div
      className="flex flex-1 flex-col"
      data-testid="project-page"
      data-project-id={project.id}
    >
      <header
        data-testid="project-header"
        className="border-b border-border bg-card/60 px-6 py-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Project
            </p>
            <h1
              data-testid="project-title"
              className="truncate text-xl font-semibold tracking-tight text-foreground"
            >
              {project.name}
            </h1>
            {project.description && (
              <p className="mt-1 max-w-2xl truncate text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">
              {project.status}
            </span>
            <ProjectHeaderActions
              projectId={project.id}
              projectName={project.name}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {bootstrapperSession ? (
            <BootstrapperPanel
              sessionId={bootstrapperSession.id}
              projectId={project.id}
              projectName={project.name}
            />
          ) : (
            <KanbanBoard projectId={project.id} />
          )}
        </div>
        <AgentActivityPanel projectId={project.id} />
      </div>
    </div>
  );
}
