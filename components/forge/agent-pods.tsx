"use client";

import React, { useState, useCallback } from "react";
import { Robot } from "@/components/forge/robot";
import { StopIcon, PlayIcon, ChatIcon } from "@/components/forge/icons";

/* ──────────────────── Types ──────────────────── */

export type AgentSlotData = {
  slotIndex: number;
  running: boolean;
  sessionId?: number;
  featureId?: number;
  featureTitle?: string;
};

export type LogLine = {
  prompt: string; // "$" or ">"
  text: string;
  cls: string; // "cmd", "dim", "grn", "red", "yel", or ""
};

export type AgentPodData = AgentSlotData & {
  logs: LogLine[];
  progress: number;
  mood: string;
};

export type AgentPodsProps = {
  projectId: number;
  slots: AgentPodData[];
  maxConcurrentAgents: number;
  onStartAgent: (slotIndex: number) => void;
  onStopAgent: (sessionId: number) => void;
  onExpandAgent: (sessionId: number) => void;
};

/* ──────────────────── Expand icon (inline) ──────────────────── */

const ExpandIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    fill="none"
  >
    <polyline points="15,3 21,3 21,9" />
    <polyline points="9,21 3,21 3,15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

/* ──────────────────── PodLog sub-component ──────────────────── */

function PodLog({ logs }: { logs: LogLine[] }) {
  const last = logs.slice(-4);
  return (
    <div className="pod-log">
      {last.map((l, i) => (
        <div key={i} className="log-line">
          <span className="log-prompt">{l.prompt}</span>
          <span className={l.cls}>
            {l.text}
            {i === last.length - 1 && <span className="cursor-blink" />}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────── AgentPods component ──────────────────── */

export function AgentPods({
  projectId,
  slots,
  maxConcurrentAgents,
  onStartAgent,
  onStopAgent,
  onExpandAgent,
}: AgentPodsProps) {
  const liveCount = slots.filter((s) => s.running).length;

  // Track which pods have a drag-over state
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, slotIndex: number) => {
      e.preventDefault();
      setDragOverSlot(slotIndex);
    },
    [],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOverSlot(null);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, slotIndex: number) => {
      e.preventDefault();
      setDragOverSlot(null);
      onStartAgent(slotIndex);
    },
    [onStartAgent],
  );

  return (
    <section className="pods-section">
      {/* Header */}
      <div className="pods-head">
        <h2 className="pods-title">
          <span className="em">Agents</span> at work{" "}
          <span
            className="hand"
            style={{ fontSize: 16, color: "var(--ink-3)", marginLeft: 4 }}
          >
            &middot; up to {maxConcurrentAgents} in parallel
          </span>
        </h2>
        <div className="pods-meta">{liveCount}/{maxConcurrentAgents} running</div>
      </div>

      {/* N-column grid — matches configured concurrency, falling back to
          the slot count so in-flight agents still render if the user just
          lowered the limit. */}
      <div
        className="pods"
        style={{
          gridTemplateColumns: `repeat(${Math.max(
            1,
            slots.length,
          )}, minmax(0, 1fr))`,
        }}
      >
        {slots.map((slot) => {
          const isDragOver = dragOverSlot === slot.slotIndex;
          const podClass = [
            "pod",
            slot.running ? "running" : "",
            !slot.running ? "idle" : "",
            isDragOver ? "drag-over" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={slot.slotIndex}
              className={podClass}
              onDragOver={(e) => handleDragOver(e, slot.slotIndex)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, slot.slotIndex)}
            >
              {slot.running ? (
                /* ─── Running pod ─── */
                <>
                  {/* Head */}
                  <div className="pod-head">
                    <div className="pod-avatar">
                      <Robot
                        seed={slot.slotIndex}
                        size={48}
                        running={true}
                      />
                    </div>
                    <div className="pod-id">
                      <div className="pod-name">
                        Agent {slot.slotIndex + 1}
                      </div>
                      <div className="pod-state live">{slot.mood}</div>
                    </div>
                    <span className="pod-status live">
                      <span className="bullet" />
                      live
                    </span>
                  </div>

                  {/* Body */}
                  <div className="pod-body">
                    <div className="pod-tag">working on</div>
                    <div className="pod-task">
                      {slot.featureTitle ?? "Unnamed feature"}
                    </div>
                    <div className="pod-meta">
                      {slot.featureId != null && (
                        <span>#{slot.featureId}</span>
                      )}
                    </div>
                    <div className="pod-progress">
                      <div
                        style={{ width: `${Math.min(slot.progress, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Terminal log */}
                  <PodLog logs={slot.logs} />

                  {/* Actions */}
                  <div className="pod-actions">
                    <button
                      className="btn xs danger"
                      onClick={() =>
                        slot.sessionId != null &&
                        onStopAgent(slot.sessionId)
                      }
                      title="Stop agent"
                    >
                      <StopIcon size={12} />
                      stop
                    </button>
                    <button
                      className="btn xs ghost"
                      onClick={() =>
                        slot.sessionId != null &&
                        onExpandAgent(slot.sessionId)
                      }
                      title="Expand logs"
                    >
                      <ExpandIcon size={12} />
                      expand
                    </button>
                    <button className="btn xs ghost" title="Chat with agent">
                      <ChatIcon size={12} />
                    </button>
                    <span className="spacer" />
                    <span className="tag">
                      {Math.round(slot.progress)}%
                    </span>
                  </div>
                </>
              ) : (
                /* ─── Idle pod ─── */
                <>
                  {/* Head */}
                  <div className="pod-head">
                    <div className="pod-avatar">
                      <Robot seed={slot.slotIndex} size={48} />
                    </div>
                    <div className="pod-id">
                      <div className="pod-name">
                        Agent {slot.slotIndex + 1}
                      </div>
                      <div className="pod-state">idle</div>
                    </div>
                    <span className="pod-status idle">idle</span>
                  </div>

                  {/* Body (centered idle state) */}
                  <div className="pod-body">
                    <Robot
                      seed={slot.slotIndex}
                      size={36}
                      style={{ opacity: 0.55 }}
                    />
                    <div className="pod-task">zzz... nothing assigned</div>
                    <div className="drop-hint">drop a card here</div>
                  </div>

                  {/* Actions */}
                  <div className="pod-actions">
                    <button
                      className="btn sm primary"
                      onClick={() => onStartAgent(slot.slotIndex)}
                    >
                      <PlayIcon size={12} />
                      assign next
                    </button>
                    <span className="spacer" />
                    <span className="tag">
                      slot {slot.slotIndex + 1}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
