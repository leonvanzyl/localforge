"use client";

import React, { useState, useEffect, useRef } from "react";
import { XIcon, StopIcon } from "@/components/forge/icons";
import { Robot } from "@/components/forge/robot";

/* ────────────────────────────────────────────
   NewProjectModal
   ──────────────────────────────────────────── */

export type NewProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; description?: string }) => void;
};

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  open,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setTimeout(() => nameRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), description: description.trim() || undefined });
  };

  return (
    <div className={"modal-bg " + (open ? "open" : "")} onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>New workspace</h2>
        <p className="hint">
          Point LocalForge at a project. We'll track features and deploy agents.
        </p>

        <label>Display name</label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My awesome project"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
        />

        <label>Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional short description"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
        />

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name.trim()}
            onClick={handleSubmit}
          >
            Create workspace
          </button>
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────
   AgentLogModal
   ──────────────────────────────────────────── */

export type AgentLogModalProps = {
  open: boolean;
  onClose: () => void;
  agent: {
    slotIndex: number;
    running: boolean;
    mood: string;
    logs: Array<{ prompt: string; text: string; cls: string }>;
    name?: string;
  } | null;
  featureTitle?: string;
};

export const AgentLogModal: React.FC<AgentLogModalProps> = ({
  open,
  onClose,
  agent,
  featureTitle,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [open, agent?.logs.length]);

  if (!agent) return null;

  return (
    <div className={"modal-bg " + (open ? "open" : "")} onClick={onClose}>
      <div
        className="modal-panel"
        style={{ width: "min(600px, 90vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Robot seed={agent.slotIndex} size={40} running={agent.running} />
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{agent.name ?? `Agent ${agent.slotIndex + 1}`}</h2>
            <span
              className="tag"
              style={{ color: agent.running ? "var(--accent)" : "var(--ink-3)" }}
            >
              {agent.running ? agent.mood || "working" : "idle"}
            </span>
          </div>
        </div>

        {/* Feature */}
        {featureTitle && (
          <div style={{ marginBottom: 12 }}>
            <span className="tag">working on</span>
            <div
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 15,
                fontWeight: 500,
                marginTop: 2,
              }}
            >
              {featureTitle}
            </div>
          </div>
        )}

        {/* Terminal output */}
        <div
          className="pod-log"
          style={{
            height: "auto",
            maxHeight: 320,
            overflowY: "auto",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          {agent.logs.map((log, i) => (
            <div key={i} className="log-line">
              <span className="log-prompt">{log.prompt}</span>
              <span className={log.cls}>{log.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Actions */}
        <div className="modal-actions">
          {agent.running && (
            <button className="btn danger" onClick={onClose}>
              <StopIcon size={14} />
              Stop agent
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────
   ShortcutsModal
   ──────────────────────────────────────────── */

export type ShortcutsModalProps = {
  open: boolean;
  onClose: () => void;
};

const shortcuts: Array<{ label: string; keys: string[] }> = [
  { label: "Switch workspace", keys: ["Ctrl", "1-9"] },
  { label: "New workspace", keys: ["Ctrl", "N"] },
  { label: "Run / pause all agents", keys: ["Ctrl", "Enter"] },
  { label: "Toggle activity drawer", keys: ["Ctrl", "\\"] },
  { label: "Toggle dark mode", keys: ["Ctrl", "D"] },
  { label: "Open shortcuts", keys: ["?"] },
  { label: "Close overlay", keys: ["Esc"] },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <div
      className={"shortcuts-overlay " + (open ? "open" : "")}
      onClick={onClose}
    >
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        {shortcuts.map((s) => (
          <div key={s.label} className="shortcut-row">
            <span className="label">{s.label}</span>
            <span className="keys">
              {s.keys.map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && <span style={{ color: "var(--ink-4)", margin: "0 1px" }}>+</span>}
                  <span className="kbd">{k}</span>
                </React.Fragment>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
