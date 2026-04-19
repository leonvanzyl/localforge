import { listProjects } from "@/lib/projects";
import { EmptyState } from "@/components/app-shell/empty-state";
import { HomeSelectPrompt } from "@/components/app-shell/home-select-prompt";

// Querying the DB on every request is fine at this scale, and necessary so
// the empty state vs. select-project screen reflects the current project
// list (e.g. right after a DELETE).
export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = listProjects();
  if (projects.length === 0) {
    return <EmptyState />;
  }
  return <HomeSelectPrompt projectCount={projects.length} />;
}
