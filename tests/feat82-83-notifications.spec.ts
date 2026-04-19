import { test, expect, type Page } from "@playwright/test";

/**
 * Verification for:
 *   - Feature #82: Browser push notification on completion (Web Notifications
 *     API). Title "LocalForge", body mentions the feature name, falls back
 *     silently when permission is denied.
 *   - Feature #83: Audio cue on completion (Web Audio API). Modest volume,
 *     can be muted, no error when AudioContext unavailable.
 *
 * The SSE endpoint is mocked in-page via `addInitScript` so the test can
 * dispatch a synthetic `status` event and assert on the resulting calls
 * to `new Notification(...)` and `AudioContext.createOscillator()` without
 * needing a running orchestrator.
 */

type NotifyCall = { title: string; options: NotificationOptions | undefined };
type AudioEvent =
  | { kind: "ctor" }
  | { kind: "createOscillator" }
  | { kind: "freq"; value: number }
  | { kind: "gain"; value: number }
  | { kind: "resume" };

declare global {
  interface Window {
    __notifications: NotifyCall[];
    __audio: AudioEvent[];
    __audioUnsupported: boolean;
    __fireStatus: (payload: unknown) => void;
  }
}

async function installHarness(
  page: Page,
  opts: { permission: NotificationPermission; audioSupported: boolean },
) {
  await page.addInitScript(
    ({ permission, audioSupported }) => {
      window.__notifications = [];
      window.__audio = [];
      window.__audioUnsupported = !audioSupported;

      // --- Notification stub ---------------------------------------------
      class FakeNotification {
        static permission: NotificationPermission = permission;
        static async requestPermission(): Promise<NotificationPermission> {
          return FakeNotification.permission;
        }
        onclick: ((this: Notification, ev: Event) => unknown) | null = null;
        close() {
          /* noop */
        }
        constructor(title: string, options?: NotificationOptions) {
          window.__notifications.push({ title, options });
        }
      }
      Object.defineProperty(window, "Notification", {
        configurable: true,
        writable: true,
        value: FakeNotification as unknown as typeof Notification,
      });

      // --- AudioContext stub (or removal) --------------------------------
      if (!audioSupported) {
        // Remove both constructors so readiness check in playCompletionSound
        // short-circuits without throwing. Some browsers mark these props as
        // non-configurable on window, so fall back to a plain assignment when
        // defineProperty throws.
        try {
          Object.defineProperty(window, "AudioContext", {
            configurable: true,
            writable: true,
            value: undefined,
          });
        } catch {
          (window as unknown as { AudioContext?: unknown }).AudioContext =
            undefined;
        }
        try {
          Object.defineProperty(
            window as unknown as { webkitAudioContext?: unknown },
            "webkitAudioContext",
            { configurable: true, writable: true, value: undefined },
          );
        } catch {
          (
            window as unknown as { webkitAudioContext?: unknown }
          ).webkitAudioContext = undefined;
        }
      } else {
        class FakeOscillator {
          type = "sine";
          frequency = {
            _value: 0,
            get value() {
              return this._value;
            },
            set value(v: number) {
              this._value = v;
              window.__audio.push({ kind: "freq", value: v });
            },
          };
          connect() {
            /* noop */
          }
          start() {
            /* noop */
          }
          stop() {
            /* noop */
          }
        }
        class FakeGain {
          gain = {
            setValueAtTime: (_v: number, _t: number) => {
              /* noop */
            },
            exponentialRampToValueAtTime: (v: number, _t: number) => {
              window.__audio.push({ kind: "gain", value: v });
            },
          };
          connect() {
            /* noop */
          }
        }
        class FakeAudioContext {
          state: AudioContextState = "running";
          currentTime = 0;
          destination = {} as AudioDestinationNode;
          constructor() {
            window.__audio.push({ kind: "ctor" });
          }
          async resume() {
            window.__audio.push({ kind: "resume" });
          }
          createOscillator() {
            window.__audio.push({ kind: "createOscillator" });
            return new FakeOscillator() as unknown as OscillatorNode;
          }
          createGain() {
            return new FakeGain() as unknown as GainNode;
          }
        }
        Object.defineProperty(window, "AudioContext", {
          configurable: true,
          writable: true,
          value: FakeAudioContext as unknown as typeof AudioContext,
        });
      }

      // --- EventSource stub that exposes a manual dispatch -------------
      class FakeEventSource {
        static instances: FakeEventSource[] = [];
        listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
        url: string;
        onopen: ((ev: Event) => unknown) | null = null;
        onerror: ((ev: Event) => unknown) | null = null;
        onmessage: ((ev: MessageEvent) => unknown) | null = null;
        readyState = 1;
        withCredentials = false;
        CONNECTING = 0 as const;
        OPEN = 1 as const;
        CLOSED = 2 as const;
        static CONNECTING = 0 as const;
        static OPEN = 1 as const;
        static CLOSED = 2 as const;
        constructor(url: string) {
          this.url = url;
          FakeEventSource.instances.push(this);
        }
        addEventListener(event: string, cb: (ev: MessageEvent) => void) {
          if (!this.listeners.has(event)) this.listeners.set(event, new Set());
          this.listeners.get(event)!.add(cb);
        }
        removeEventListener(event: string, cb: (ev: MessageEvent) => void) {
          this.listeners.get(event)?.delete(cb);
        }
        close() {
          this.readyState = 2;
        }
        dispatchStatus(payload: unknown) {
          const evt = new MessageEvent("status", {
            data: JSON.stringify(payload),
          });
          for (const cb of this.listeners.get("status") ?? []) cb(evt);
        }
      }
      Object.defineProperty(window, "EventSource", {
        configurable: true,
        writable: true,
        value: FakeEventSource as unknown as typeof EventSource,
      });

      // Expose helper on window so the test can drive event dispatch from
      // the Node side via page.evaluate.
      window.__fireStatus = (payload: unknown) => {
        for (const es of FakeEventSource.instances) {
          es.dispatchStatus(payload);
        }
      };
    },
    { permission: opts.permission, audioSupported: opts.audioSupported },
  );
}

test.describe("Feature #82/#83 browser push & audio cue", () => {
  test("granted permission + sound on → notification fires AND audio plays", async ({
    page,
  }) => {
    await installHarness(page, { permission: "granted", audioSupported: true });
    await page.goto("/projects/31");

    // Wait for the controls cluster that proves AgentNotifications mounted.
    const controls = page.getByTestId("notification-controls");
    await expect(controls).toBeVisible({ timeout: 15_000 });
    await expect(controls).toHaveAttribute(
      "data-notification-permission",
      "granted",
    );
    await expect(controls).toHaveAttribute(
      "data-notification-sound-muted",
      "false",
    );

    // Dispatch a completed status event through the stubbed EventSource.
    await page.evaluate(() => {
      window.__fireStatus({
        type: "status",
        sessionId: 9999,
        featureId: 48,
        sessionStatus: "completed",
        featureName: "Feature #82/#83 smoke",
      });
    });

    // Feature #82: Notification constructed with LocalForge title + name in
    // body.
    await expect
      .poll(async () => page.evaluate(() => window.__notifications.length))
      .toBeGreaterThan(0);
    const notif = await page.evaluate(() => window.__notifications[0]);
    expect(notif.title).toBe("LocalForge");
    expect(notif.options?.body ?? "").toContain("Feature #82/#83 smoke");

    // Feature #83: AudioContext constructed, oscillator(s) created, gain
    // ramp reached the 0.15 target (reasonable volume, not full scale).
    const audio = await page.evaluate(() => window.__audio);
    expect(audio.some((a) => a.kind === "ctor")).toBe(true);
    expect(audio.filter((a) => a.kind === "createOscillator").length).toBe(2);
    const gains = audio
      .filter((a): a is { kind: "gain"; value: number } => a.kind === "gain")
      .map((a) => a.value);
    expect(Math.max(...gains)).toBeLessThanOrEqual(0.2);
  });

  test("denied permission suppresses push notification but toast/audio still fire", async ({
    page,
  }) => {
    await installHarness(page, { permission: "denied", audioSupported: true });
    await page.goto("/projects/31");

    const controls = page.getByTestId("notification-controls");
    await expect(controls).toBeVisible({ timeout: 15_000 });
    await expect(controls).toHaveAttribute(
      "data-notification-permission",
      "denied",
    );

    await page.evaluate(() => {
      window.__fireStatus({
        type: "status",
        sessionId: 9998,
        featureId: 48,
        sessionStatus: "completed",
        featureName: "Denied smoke",
      });
    });

    // Give the handler a moment to run.
    await page.waitForTimeout(200);

    // No browser push notification should have been constructed.
    const count = await page.evaluate(() => window.__notifications.length);
    expect(count).toBe(0);

    // But the audio cue still plays — fallback channel.
    const audio = await page.evaluate(() => window.__audio);
    expect(audio.some((a) => a.kind === "createOscillator")).toBe(true);
  });

  test("sound toggle mutes audio and persists across reload", async ({
    page,
  }) => {
    await installHarness(page, { permission: "granted", audioSupported: true });
    await page.goto("/projects/31");

    const toggle = page.getByTestId("notification-sound-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute("data-sound-muted", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-sound-muted", "true");

    // Fire a completion event while muted — audio calls must NOT happen.
    await page.evaluate(() => {
      window.__audio = [];
      window.__fireStatus({
        type: "status",
        sessionId: 9997,
        featureId: 48,
        sessionStatus: "completed",
        featureName: "Muted smoke",
      });
    });
    await page.waitForTimeout(200);
    const audio = await page.evaluate(() => window.__audio);
    expect(audio.length).toBe(0);

    // Reload and confirm the mute state persisted via localStorage.
    await page.reload();
    const toggleAfterReload = page.getByTestId("notification-sound-toggle");
    await expect(toggleAfterReload).toHaveAttribute(
      "data-sound-muted",
      "true",
    );
  });

  test("unsupported AudioContext does not throw — notification still fires", async ({
    page,
  }) => {
    let pageError: Error | null = null;
    page.on("pageerror", (err) => {
      pageError = err;
    });

    await installHarness(page, {
      permission: "granted",
      audioSupported: false,
    });
    await page.goto("/projects/31");

    const controls = page.getByTestId("notification-controls");
    await expect(controls).toBeVisible({ timeout: 15_000 });
    await expect(controls).toHaveAttribute(
      "data-notification-permission",
      "granted",
    );

    const state = await page.evaluate(() => ({
      notificationDefined: typeof Notification !== "undefined",
      notificationPermission:
        typeof Notification !== "undefined"
          ? Notification.permission
          : null,
      audioDefined: typeof AudioContext !== "undefined",
      fireStatusDefined: typeof window.__fireStatus === "function",
    }));
    expect(state.notificationDefined).toBe(true);
    expect(state.notificationPermission).toBe("granted");
    expect(state.audioDefined).toBe(false);
    expect(state.fireStatusDefined).toBe(true);

    await page.evaluate(() => {
      window.__fireStatus({
        type: "status",
        sessionId: 9996,
        featureId: 48,
        sessionStatus: "completed",
        featureName: "Audio-unsupported smoke",
      });
    });

    // Notification still fires — audio failure is silent.
    await expect
      .poll(async () => page.evaluate(() => window.__notifications.length))
      .toBeGreaterThan(0);
    expect(pageError).toBeNull();
  });
});
