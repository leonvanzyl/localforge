"use client";

import * as React from "react";
import { Bell, BellOff, BellRing, Volume2, VolumeX } from "lucide-react";
import { toast, Toaster } from "sonner";

/**
 * Global orchestrator notification listener + Sonner <Toaster />.
 *
 * Features covered:
 *   - #80  Toast on feature completion (green success toast, 5s auto-dismiss).
 *   - #81  Toast on feature failure (red destructive toast, 10s auto-dismiss).
 *   - #82  Browser push notification (Web Notifications API) on completion
 *          when the user has granted permission. Title is "LocalForge", body
 *          names the feature. Denied / unsupported platforms silently fall
 *          back to the toast alone.
 *   - #83  Audio cue (Web Audio API) on completion. A short two-tone beep
 *          plays at a modest volume; the user can mute it via a persistent
 *          toggle, and playback is guarded by `AudioContext` availability so
 *          unsupported browsers never throw.
 *
 * Mounted once at the app-shell layer. Opens a single EventSource against
 * `/api/agent/events` that receives orchestrator events for every running
 * session regardless of which project page the user is on.
 *
 * UX:
 *   - 5s auto-dismiss for success toasts, 10s for failure toasts
 *   - dedicated close button (X) on each toast
 *   - clicking anywhere on the toast body also dismisses immediately
 *     (implemented via a document-level delegated click handler that looks
 *     up the `[data-sonner-toast]` the click hit).
 *   - a persistent floating control cluster in the bottom-right corner lets
 *     the user grant notification permission and mute the audio cue.
 */

type StatusEvent = {
  type: "status";
  sessionId: number;
  featureId: number | null;
  sessionStatus: "in_progress" | "completed" | "failed" | "terminated";
  featureName?: string;
};

const SOUND_MUTE_STORAGE_KEY = "localforge.notifications.sound.muted";

type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

/**
 * Read the current Notifications API permission state. Returns "unsupported"
 * when running in an environment without the API (older browsers, or SSR).
 */
function readPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  const p = Notification.permission;
  if (p === "granted" || p === "denied" || p === "default") return p;
  return "default";
}

/**
 * Load the "sound muted" preference from localStorage. Defaults to false
 * (sound ON) so users get the audio cue out of the box.
 */
function readSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SOUND_MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared AudioContext reused across plays so we don't churn resources each
 * completion. Created lazily on the first real play — some browsers require
 * a user gesture before an AudioContext can produce output, so deferring
 * creation until the first event after Start-click lets the gesture "unlock"
 * playback naturally.
 */
let sharedAudioContext: AudioContext | null = null;

/**
 * Play a short, pleasant two-tone beep via Web Audio API. Volume ramps to
 * 0.15 (gain units) so the cue is audible but not obnoxious. All paths are
 * wrapped in try/catch so an unsupported AudioContext silently falls back to
 * "no sound" without throwing out of the SSE event handler.
 */
function playCompletionSound(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx: typeof AudioContext | undefined =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioContext) {
      sharedAudioContext = new Ctx();
    }
    // Some browsers auto-suspend the context when the tab is backgrounded;
    // resume it so the cue still plays when the user returns.
    if (sharedAudioContext.state === "suspended") {
      void sharedAudioContext.resume().catch(() => {
        /* ignore resume failures */
      });
    }
    const ctx = sharedAudioContext;
    const now = ctx.currentTime;

    // Two-tone ascending beep (E5 -> A5) — lasts ~220ms total.
    const tones = [
      { freq: 659.25, start: now, duration: 0.12 },
      { freq: 880.0, start: now + 0.12, duration: 0.1 },
    ];
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = tone.freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, tone.start);
      gain.gain.exponentialRampToValueAtTime(0.15, tone.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        tone.start + tone.duration,
      );
      osc.start(tone.start);
      osc.stop(tone.start + tone.duration + 0.01);
    }
  } catch {
    // Any unexpected AudioContext error is non-fatal — toast still fires.
  }
}

/**
 * Fire a Web Notifications API notification. Returns true if a notification
 * was actually created. Safe to call without checking permission — we
 * short-circuit on "denied" / "default" / "unsupported" so the caller
 * doesn't have to duplicate the guard.
 */
function fireBrowserNotification(featureName: string | null): boolean {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission !== "granted") return false;
  try {
    const body = featureName
      ? `Finished "${featureName}" successfully.`
      : "A feature just finished successfully.";
    const notification = new Notification("LocalForge", {
      body,
      tag: "localforge-feature-completed",
      // Don't auto-renotify if the same tag fires rapidly.
      renotify: false,
    });
    // Clicking the OS-level notification focuses the window so the user can
    // see which feature just completed on the kanban.
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore focus failure */
      }
      notification.close();
    };
    return true;
  } catch {
    // Some platforms throw if the permission changed between the check and
    // the construction (e.g. during an iframe isolation). The toast still
    // fires so the user isn't left without feedback.
    return false;
  }
}

export function AgentNotifications() {
  // Track which session status transitions we've already toasted so the SSE
  // reconnect (or replay) doesn't fire duplicates.
  const toastedRef = React.useRef<Set<string>>(new Set());

  const [permission, setPermission] =
    React.useState<NotificationPermissionState>("unsupported");
  const [soundMuted, setSoundMuted] = React.useState<boolean>(false);
  const [permissionError, setPermissionError] = React.useState<string | null>(
    null,
  );
  // Keep the latest mute state in a ref so the SSE listener (which has a
  // stable identity across renders) can read the current value without us
  // re-subscribing every time the user toggles the button.
  const soundMutedRef = React.useRef(false);

  // Hydrate permission + sound-mute state after mount (browser-only APIs).
  React.useEffect(() => {
    setPermission(readPermission());
    const muted = readSoundMuted();
    setSoundMuted(muted);
    soundMutedRef.current = muted;
  }, []);

  // Keep ref + localStorage in sync whenever the toggle flips.
  React.useEffect(() => {
    soundMutedRef.current = soundMuted;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SOUND_MUTE_STORAGE_KEY,
        soundMuted ? "1" : "0",
      );
    } catch {
      /* ignore storage quota / disabled storage */
    }
  }, [soundMuted]);

  const requestPermission = React.useCallback(async () => {
    setPermissionError(null);
    if (typeof Notification === "undefined") {
      setPermissionError("Notifications are not supported in this browser.");
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      if (result === "granted" || result === "denied" || result === "default") {
        setPermission(result);
      }
      if (result === "denied") {
        setPermissionError(
          "Notifications blocked. You can re-enable them from your browser's site settings.",
        );
      }
    } catch (err) {
      setPermissionError(
        err instanceof Error
          ? err.message
          : "Failed to request notification permission.",
      );
    }
  }, []);

  React.useEffect(() => {
    const es = new EventSource("/api/agent/events");

    es.addEventListener("status", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as StatusEvent;
        const key = `${data.sessionId}:${data.sessionStatus}`;
        if (toastedRef.current.has(key)) return;
        if (
          data.sessionStatus !== "completed" &&
          data.sessionStatus !== "failed"
        ) {
          return;
        }
        toastedRef.current.add(key);
        const name = data.featureName
          ? `"${data.featureName}"`
          : `feature #${data.featureId ?? "?"}`;

        if (data.sessionStatus === "completed") {
          toast.success(`Completed: ${name}`, {
            id: `session-${data.sessionId}-completed`,
            duration: 5000,
            closeButton: true,
          });
          // Feature #82: fire a Web Notifications API push if the user has
          // granted permission. Silent no-op otherwise so the toast above
          // remains the guaranteed feedback channel.
          fireBrowserNotification(data.featureName ?? null);
          // Feature #83: play a short audio cue unless the user has muted
          // it. Guarded by AudioContext availability so unsupported
          // browsers simply skip playback.
          if (!soundMutedRef.current) {
            playCompletionSound();
          }
        } else {
          // Feature #81: error toasts persist longer than success toasts (10s
          // vs 5s) so the user has enough time to notice the failure even if
          // they glance away briefly.
          toast.error(`Failed: ${name}`, {
            id: `session-${data.sessionId}-failed`,
            description:
              "The agent returned an error - feature demoted to backlog.",
            duration: 10000,
            closeButton: true,
          });
        }
      } catch {
        /* ignore malformed events */
      }
    });

    return () => {
      es.close();
    };
  }, []);

  // Click-to-dismiss: Sonner doesn't dismiss on body click by default. We
  // delegate from document and dismiss any toast whose surface was clicked
  // (excluding clicks on the built-in close button, which already dismiss).
  React.useEffect(() => {
    function onDocumentClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // If the user clicked the explicit close button, Sonner handles it.
      if (target.closest("[data-close-button]")) return;
      const toastEl = target.closest<HTMLElement>("[data-sonner-toast]");
      if (!toastEl) return;
      // Sonner writes data-id on each toast; dismiss by that id.
      const id = toastEl.dataset.id;
      if (id) toast.dismiss(id);
      else toast.dismiss();
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  return (
    <>
      <Toaster
        position="top-right"
        theme="system"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: "cursor-pointer",
          },
        }}
      />
      {/* Features #82/#83 control cluster. Rendered fixed bottom-right so it
          never covers the kanban board or the sidebar. */}
      <NotificationControls
        permission={permission}
        soundMuted={soundMuted}
        permissionError={permissionError}
        onRequestPermission={requestPermission}
        onToggleMute={() => setSoundMuted((prev) => !prev)}
      />
    </>
  );
}

/**
 * Fixed-position button cluster that lets the user:
 *   - Enable browser push notifications (when permission is "default") or
 *     see their current permission state (granted / denied / unsupported).
 *   - Toggle the audio cue on and off.
 *
 * The cluster is intentionally unobtrusive — two ~32px square buttons in the
 * bottom-right corner — so it doesn't compete with the kanban board for
 * attention but remains discoverable. `data-testid` attrs give the Playwright
 * specs stable hooks.
 */
function NotificationControls({
  permission,
  soundMuted,
  permissionError,
  onRequestPermission,
  onToggleMute,
}: {
  permission: NotificationPermissionState;
  soundMuted: boolean;
  permissionError: string | null;
  onRequestPermission: () => void | Promise<void>;
  onToggleMute: () => void;
}) {
  const permissionLabel =
    permission === "granted"
      ? "Browser notifications enabled"
      : permission === "denied"
        ? "Browser notifications blocked — update site permissions to re-enable"
        : permission === "unsupported"
          ? "Browser notifications not supported"
          : "Enable browser notifications";

  const soundLabel = soundMuted
    ? "Notification sound muted"
    : "Notification sound enabled";

  return (
    <div
      data-testid="notification-controls"
      data-notification-permission={permission}
      data-notification-sound-muted={soundMuted ? "true" : "false"}
      className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2"
    >
      {permissionError && permission !== "granted" && (
        <p
          role="alert"
          data-testid="notification-permission-error"
          className="max-w-xs rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          {permissionError}
        </p>
      )}
      <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          data-testid="notification-permission-button"
          data-permission={permission}
          aria-label={permissionLabel}
          title={permissionLabel}
          disabled={permission === "unsupported" || permission === "denied"}
          onClick={() => {
            if (permission === "default") void onRequestPermission();
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {permission === "granted" ? (
            <BellRing className="h-4 w-4" aria-hidden="true" />
          ) : permission === "denied" || permission === "unsupported" ? (
            <BellOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Bell className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          data-testid="notification-sound-toggle"
          data-sound-muted={soundMuted ? "true" : "false"}
          aria-label={soundLabel}
          aria-pressed={soundMuted ? "true" : "false"}
          title={soundLabel}
          onClick={onToggleMute}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {soundMuted ? (
            <VolumeX className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Volume2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
