"use client";

import Image from "next/image";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useShell } from "./shell-context";

export function EmptyState() {
  const { openNewProjectDialog } = useShell();

  function openHelp() {
    window.dispatchEvent(new CustomEvent("help:open"));
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
        <div className="mt-8 flex justify-center">
          <Button
            size="lg"
            onClick={openNewProjectDialog}
            data-testid="empty-state-cta"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Create Your First Project
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
