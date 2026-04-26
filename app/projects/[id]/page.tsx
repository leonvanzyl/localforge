import { notFound } from "next/navigation";

import {
  getProject,
  isProjectFullyCompleted,
  reopenProjectIfHasOpenFeatures,
} from "@/lib/projects";
import { getActiveSessionForProject } from "@/lib/agent-sessions";
import { BootstrapperPanel } from "@/components/bootstrapper/bootstrapper-panel";
import { CompletedProjectView } from "@/components/celebration/completed-project-view";
import { CelebrationListener } from "@/components/celebration/celebration-listener";
import { ProjectView } from "@/components/forge/project-view";

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

  let project = getProject(numericId);
  if (!project) {
    notFound();
  }
  project = reopenProjectIfHasOpenFeatures(project.id) ?? project;

  // If there is an active bootstrapper session for this project, render the
  // AI chat panel instead of the kanban board. The session is created from
  // the New Project dialog when the user selects "Describe your project to
  // AI" (Feature #55).
  const bootstrapperSession = getActiveSessionForProject(
    project.id,
    "bootstrapper",
  );

  if (bootstrapperSession) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="project-page"
        data-project-id={project.id}
      >
        <CelebrationListener projectId={project.id} />
        <BootstrapperPanel
          sessionId={bootstrapperSession.id}
          projectId={project.id}
          projectName={project.name}
        />
      </div>
    );
  }

  if (project.status === "completed" && isProjectFullyCompleted(project.id)) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="project-page"
        data-project-id={project.id}
      >
        <CelebrationListener projectId={project.id} />
        <CompletedProjectView
          projectId={project.id}
          projectName={project.name}
        />
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}
      data-testid="project-page"
      data-project-id={project.id}
    >
      <CelebrationListener projectId={project.id} />
      <ProjectView
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          folderPath: project.folderPath,
          status: project.status,
        }}
      />
    </div>
  );
}
