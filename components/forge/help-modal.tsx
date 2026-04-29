"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import {
  Terminal,
  Database,
  Zap,
  FlaskConical,
  Radio,
  TestTube2,
  X,
  GripHorizontal,
} from "lucide-react";

type HelpModalProps = {
  open: boolean;
  onClose: () => void;
};

type Tab = "quickstart" | "techguide";

const QUICK_START_STEPS = [
  {
    title: "Install Node.js 20+",
    desc: (
      <>
        Download and install Node.js from{" "}
        <a href="https://nodejs.org/" target="_blank" rel="noopener noreferrer" className="help-link">
          nodejs.org
        </a>
        . Version 20 or higher is required.
      </>
    ),
  },
  {
    title: "Set up a local model server",
    desc: (
      <>
        LocalForge works with any <strong>OpenAI-compatible local server</strong>. Two great free options:{" "}
        <a href="https://lmstudio.ai/" target="_blank" rel="noopener noreferrer" className="help-link">
          LM Studio
        </a>{" "}
        (beginner-friendly GUI) or{" "}
        <a href="https://ollama.com/" target="_blank" rel="noopener noreferrer" className="help-link">
          Ollama
        </a>{" "}
        (lightweight CLI). Both run entirely on your own machine.
      </>
    ),
  },
  {
    title: "Load a model — LM Studio",
    desc: (
      <>
        Open LM Studio → <strong>Discover</strong> tab → search{" "}
        <code className="help-code">google/gemma-4-31b</code> → Download. Then go to the{" "}
        <strong>Local Server</strong> tab and click <strong>Start Server</strong> (default port 1234).
        Leave it running while using LocalForge.
      </>
    ),
  },
  {
    title: "Load a model — Ollama",
    desc: (
      <>
        Install Ollama, then run <code className="help-code">ollama pull gemma3:27b</code> (or any
        supported model). Ollama serves on{" "}
        <code className="help-code">http://127.0.0.1:11434</code> — update the URL in LocalForge{" "}
        <strong>Settings → LM Studio URL</strong> to match.
      </>
    ),
  },
  {
    title: "Clone & install LocalForge",
    desc: (
      <>
        <code className="help-code">git clone https://github.com/leonvanzyl/localforge.git</code>{" "}
        then <code className="help-code">cd localforge</code>,{" "}
        <code className="help-code">npm install</code>, and{" "}
        <code className="help-code">npm run db:migrate</code>.
      </>
    ),
  },
  {
    title: "Start LocalForge",
    desc: (
      <>
        Run <code className="help-code">npm run dev</code> and open{" "}
        <a href="http://localhost:7777" target="_blank" rel="noopener noreferrer" className="help-link">
          http://localhost:7777
        </a>{" "}
        in your browser.
      </>
    ),
  },
  {
    title: "Create a workspace",
    desc: "Click + New Workspace in the sidebar, give your project a name, and optionally describe the app you want to build.",
  },
  {
    title: "Run the queue",
    desc: "Features appear in the Backlog column. Click Run Queue in the top bar — LocalForge spawns an agent that writes code, runs tests, and moves cards to Completed one by one.",
  },
];

const TECH_CARDS = [
  {
    Icon: Terminal,
    name: "LM Studio / Ollama",
    version: "local model server",
    desc: "Runs AI models on your own hardware via an OpenAI-compatible API. LM Studio uses port 1234; Ollama uses port 11434. No cloud, no API keys.",
  },
  {
    Icon: Zap,
    name: "Pi Coding Agent",
    version: "@mariozechner/pi-coding-agent",
    desc: "Autonomous coding agent that reads a feature description, writes code, runs Playwright tests, and reports pass or fail.",
  },
  {
    Icon: FlaskConical,
    name: "Next.js 16 + React 19",
    version: "App Router",
    desc: "Powers both the UI and all API routes. No separate backend process — everything runs in one npm run dev.",
  },
  {
    Icon: Database,
    name: "SQLite + Drizzle ORM",
    version: "drizzle-orm",
    desc: "Lightweight local database at data/localforge.db. Schema in lib/db/schema.ts; migrations in drizzle/.",
  },
  {
    Icon: Radio,
    name: "Server-Sent Events",
    version: "SSE",
    desc: "Agent log output streams in real time to the Activity Drawer via /api/agent/events — no polling required.",
  },
  {
    Icon: TestTube2,
    name: "Playwright",
    version: "e2e testing",
    desc: "Each agent run ends with Playwright tests and screenshots. Run npx playwright test to verify features manually.",
  },
];

type Pos  = { x: number; y: number };
type Size = { w: number; h: number };

export function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;
  return <HelpModalContent onClose={onClose} />;
}

function HelpModalContent({ onClose }: { onClose: () => void }) {
  const [tab,     setTab]     = useState<Tab>("quickstart");
  const [pos,     setPos]     = useState<Pos | null>(null);
  const [size,    setSize]    = useState<Size | null>(null);
  const [visible, setVisible] = useState(false);

  const panelRef    = useRef<HTMLDivElement>(null);
  const dragStart   = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const resizeStart = useRef<{ mx: number; my: number; w: number; h: number  } | null>(null);

  // Fade in on mount via rAF so the CSS transition fires
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Global mouse move / up for drag and resize
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (dragStart.current) {
        const dx = e.clientX - dragStart.current.mx;
        const dy = e.clientY - dragStart.current.my;
        setPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
      }
      if (resizeStart.current) {
        const dw = e.clientX - resizeStart.current.mx;
        const dh = e.clientY - resizeStart.current.my;
        setSize({
          w: Math.max(400, resizeStart.current.w + dw),
          h: Math.max(300, resizeStart.current.h + dh),
        });
      }
    }
    function onUp() {
      if (dragStart.current || resizeStart.current) {
        document.body.style.cursor     = "";
        document.body.style.userSelect = "";
      }
      dragStart.current   = null;
      resizeStart.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  const startDrag = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input, textarea, select")) return;
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      px: pos?.x ?? rect.left,
      py: pos?.y ?? rect.top,
    };
    if (pos === null) setPos({ x: rect.left, y: rect.top });
    document.body.style.cursor     = "grabbing";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, [pos]);

  const startResize = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    resizeStart.current = {
      mx: e.clientX,
      my: e.clientY,
      w:  rect.width,
      h:  rect.height,
    };
    document.body.style.cursor     = "nwse-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const panelVars = {
    ...(pos  ? { "--panel-left": `${pos.x}px`, "--panel-top": `${pos.y}px` } : {}),
    ...(size ? { "--panel-width": `${size.w}px`, "--panel-height": `${size.h}px` } : {}),
  } as React.CSSProperties;

  return (
    <div
      className={"help-overlay " + (visible ? "open" : "")}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="help-panel"
        style={panelVars}
        data-dragged={pos !== null ? "true" : undefined}
        data-resized={size !== null ? "true" : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Help and Tech Guide"
      >
        {/* Drag handle / header */}
        <div className="help-header" onMouseDown={startDrag}>
          <div className="help-header-brand">
            <Image
              src="/LocalForgeLogo.png"
              alt="LocalForge logo"
              width={80}
              height={80}
              className="help-logo"
              priority
            />
            <div>
              <h2 className="help-title">Help &amp; Tech Guide</h2>
              <p className="help-subtitle">LocalForge — local agents at work</p>
            </div>
          </div>
          <div className="help-header-end">
            <GripHorizontal size={16} className="help-drag-hint" aria-hidden="true" />
            <button
              type="button"
              className="btn icon-btn ghost"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              aria-label="Close help"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="help-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "quickstart"}
            className={"help-tab " + (tab === "quickstart" ? "active" : "")}
            onClick={() => setTab("quickstart")}
          >
            Quick Start
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "techguide"}
            className={"help-tab " + (tab === "techguide" ? "active" : "")}
            onClick={() => setTab("techguide")}
          >
            Tech Guide
          </button>
        </div>

        {/* Body */}
        <div className="help-body" role="tabpanel">
          {tab === "quickstart" && (
            <div>
              {QUICK_START_STEPS.map((step, i) => (
                <div key={i} className="help-step">
                  <div className="help-step-num">{i + 1}</div>
                  <div className="help-step-content">
                    <div className="help-step-title">{step.title}</div>
                    <div className="help-step-desc">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "techguide" && (
            <div>
              <p className="help-intro">
                LocalForge is a local-first autonomous coding harness. Here&apos;s what&apos;s running under the hood:
              </p>
              <div className="tech-grid">
                {TECH_CARDS.map(({ Icon, name, version, desc }) => (
                  <div key={name} className="tech-card">
                    <div className="tech-card-head">
                      <Icon size={18} strokeWidth={1.75} className="tech-card-icon" aria-hidden="true" />
                      <span className="tech-card-name">{name}</span>
                    </div>
                    <span className="tag tech-card-version">{version}</span>
                    <p className="tech-card-desc">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          className="help-resize-handle"
          onMouseDown={startResize}
          title="Drag to resize"
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M11 5L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M11 9L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
}
