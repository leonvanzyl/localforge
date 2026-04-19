import Link from "next/link";
import { FolderPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div
      data-testid="home-welcome"
      className="flex flex-1 items-center justify-center bg-background p-8 text-foreground"
    >
      <div className="w-full max-w-xl rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">LocalForge</h1>
        <p className="mt-4 text-muted-foreground">
          Autonomous coding harness powered by local LLMs. Describe your app
          and watch local agents build it feature-by-feature on your own
          hardware.
        </p>
        <div
          data-testid="button-row"
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link href="/projects/new">
            <Button data-testid="primary-button">
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              Get Started
            </Button>
          </Link>
          <Link href="/settings">
            <Button data-testid="secondary-button" variant="secondary">
              Learn More
            </Button>
          </Link>
          <Link href="/settings">
            <Button data-testid="outline-button" variant="outline">
              View Docs
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
