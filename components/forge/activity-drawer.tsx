"use client";

import React from "react";
import { XIcon } from "@/components/forge/icons";

export type ActivityEvent = {
  id: string;
  kind: "good" | "warn" | "err" | "run";
  who: string;
  text: string;
  when: string;
};

export type ActivityDrawerProps = {
  open: boolean;
  events: ActivityEvent[];
  onClose: () => void;
};

export const ActivityDrawer: React.FC<ActivityDrawerProps> = ({
  open,
  events,
  onClose,
}) => {
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <aside className={"drawer " + (open ? "open" : "")}>
      <div className="drawer-head">
        <span className="t">Activity</span>
        <button className="btn icon-btn ghost" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <div className="drawer-body">
        {events.map((ev) => (
          <div key={ev.id} className={"event " + ev.kind + " fade-in"}>
            <div className="dot" />
            <div>
              <div className="t">
                <span className="who">{ev.who}</span> &middot; {ev.text}
              </div>
              <div className="when">{ev.when}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
