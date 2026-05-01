"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Sparkles, Kanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useShell } from "./shell-context";

export function EmptyState() {
  const { openNewProjectDialog, refreshProjects } = useShell();
  const router = useRouter();
  const [loadingExample, setLoadingExample] = React.useState(false);

  function openHelp() {
    window.dispatchEvent(new CustomEvent("help:open"));
  }

  async function handleLoadExample() {
    setLoadingExample(true);
    try {
      const res = await fetch("/api/projects/load-example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ example: "retro-todo" }),
      });
      const data = await res.json();
      if (!res.ok || !data.project) {
        throw new Error(data.error || "Failed to load example");
      }
      await refreshProjects();
      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } catch {
      setLoadingExample(false);
    }
  }

  return (
    <section
      data-testid="empty-state"
      className="flex flex-1 items-center justify-center p-8"
    >
      <div className="mx-auto w-full max-w-xl text-center">
        <div className="mx-auto flex justify-center">
          <div
            className="logo-fire-wrap"
            onClick={openHelp}
            title="Open Help & Tech Guide"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openHelp();
              }
            }}
            aria-label="Open Help & Tech Guide"
          >
            <Image
              src="/LocalForgeLogo.png"
              alt="LocalForge"
              width={138}
              height={138}
              className="logo-fire-img"
              priority
            />
            <span className="spark" />
            <span className="spark" />
            <span className="spark" />
            <span className="spark" />
            <span className="spark" />
          </div>
        </div>
        <h1
          data-testid="empty-state-title"
          className="mt-6 text-3xl font-semibold tracking-tight text-foreground"
        >
          Welcome to LocalForge
        </h1>
        <p
          data-testid="empty-state-description"
          className="mt-3 text-base text-muted-foreground"
        >
          Describe an app and watch local AI agents build it feature by
          feature — no cloud, no API keys, just your machine. Get started by
          creating your first project.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button
            size="lg"
            onClick={openNewProjectDialog}
            data-testid="empty-state-cta"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Create Your First Project
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={handleLoadExample}
            disabled={loadingExample}
            data-testid="empty-state-example-cta"
          >
            <Kanban className="h-4 w-4" aria-hidden="true" />
            {loadingExample ? "Loading…" : "Try an Example"}
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Ensure LM Studio is running locally on
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono">
            http://127.0.0.1:1234
          </code>
          before starting the orchestrator.
        </p>
      </div>
    </section>
  );
}
