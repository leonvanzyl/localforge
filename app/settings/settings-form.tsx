"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HardwarePanel } from "@/components/settings/hardware-panel";
import type { GlobalSettingsShape } from "@/lib/settings";

type FormState = GlobalSettingsShape;

type ProviderDescriptor = {
  id: "lm_studio" | "ollama";
  label: string;
  installUrl: string;
  defaultBaseUrl: string;
};

const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "lm_studio",
    label: "LM Studio",
    installUrl: "https://lmstudio.ai",
    defaultBaseUrl: "http://127.0.0.1:1234",
  },
  {
    id: "ollama",
    label: "Ollama",
    installUrl: "https://ollama.com",
    defaultBaseUrl: "http://127.0.0.1:11434",
  },
];

function urlKeyFor(provider: string): "lm_studio_url" | "ollama_url" {
  return provider === "ollama" ? "ollama_url" : "lm_studio_url";
}

// Mirrors ProviderFailureKind in lib/agent/providers/types.ts. Duplicated as
// a string-literal union here because that file is "server-only" — importing
// it into a client component would crash the build.
type ProbeFailureKind =
  | "not_running"
  | "timeout"
  | "dns"
  | "http_error"
  | "wrong_shape"
  | "unknown";

type ModelsProbe =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; models: string[] }
  | { status: "error"; message: string; kind: ProbeFailureKind };

type ScanHit = {
  providerId: "lm_studio" | "ollama";
  label: string;
  url: string;
  modelCount: number;
};

type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; hits: ScanHit[] };

export function SettingsForm({ initial }: { initial: FormState }) {
  const [values, setValues] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [probe, setProbe] = useState<ModelsProbe>({ status: "idle" });
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const router = useRouter();

  const activeProvider = values.provider;
  const activeUrlKey = urlKeyFor(activeProvider);
  const activeUrl = values[activeUrlKey];

  const activeDescriptor =
    PROVIDER_DESCRIPTORS.find((p) => p.id === activeProvider) ??
    PROVIDER_DESCRIPTORS[0];

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Debounced model probe — refires whenever the provider or the active URL
  // changes. Sharing the same effect means switching provider also triggers
  // a re-fetch against the *new* provider's URL without a separate hook.
  //
  // Stale-call protection: every probe holds an AbortController so that when
  // the deps change (e.g. user clicks "Switch to Ollama") any in-flight fetch
  // from the previous provider is aborted. Without this, the old fetch would
  // resolve after we've already moved to the new provider and call setProbe
  // with stale data — producing a brief flash of the wrong status and (under
  // React 19's strict checks in dev) a "state update on a component that
  // hasn't mounted yet" console warning.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeAbortRef = useRef<AbortController | null>(null);
  const runProbe = useCallback(
    (provider: string, url: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (probeAbortRef.current) probeAbortRef.current.abort();
      setProbe({ status: "loading" });
      const controller = new AbortController();
      probeAbortRef.current = controller;
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/providers/${provider}/models?url=${encodeURIComponent(url)}`,
            { cache: "no-store", signal: controller.signal },
          );
          const data = (await res.json()) as {
            ok?: boolean;
            models?: string[];
            error?: string;
            kind?: ProbeFailureKind;
          };
          if (controller.signal.aborted) return;
          if (!res.ok || !data.ok) {
            setProbe({
              status: "error",
              message: data.error ?? `Probe failed (HTTP ${res.status})`,
              kind: data.kind ?? "unknown",
            });
            return;
          }
          setProbe({ status: "ok", models: data.models ?? [] });
        } catch (err) {
          if (controller.signal.aborted) return;
          if (err instanceof Error && err.name === "AbortError") return;
          setProbe({
            status: "error",
            message: err instanceof Error ? err.message : "Probe failed",
            kind: "unknown",
          });
        }
      }, 400);
    },
    [],
  );

  // When the configured provider can't be reached, kick off a parallel scan
  // of every known provider's default port. If something else is responding
  // we surface a one-click "switch to <provider>" suggestion. The scan
  // fires once per error→error transition (i.e. once per failure cycle);
  // a recovery resets state so a future failure can scan again.
  const lastProbeStatusRef = useRef<ModelsProbe["status"]>("idle");
  useEffect(() => {
    const previous = lastProbeStatusRef.current;
    lastProbeStatusRef.current = probe.status;

    if (probe.status !== "error") {
      setScan({ status: "idle" });
      return;
    }
    // Already scanned for this failure cycle — don't refire on every
    // re-render while we remain in the error state.
    if (previous === "error") return;

    let cancelled = false;
    setScan({ status: "loading" });
    fetch("/api/providers/scan", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { hits?: ScanHit[] }) => {
        if (!cancelled) setScan({ status: "done", hits: data.hits ?? [] });
      })
      .catch(() => {
        if (!cancelled) setScan({ status: "done", hits: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [probe.status]);

  useEffect(() => {
    runProbe(activeProvider, activeUrl);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (probeAbortRef.current) probeAbortRef.current.abort();
    };
  }, [activeProvider, activeUrl, runProbe]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as {
        settings?: FormState;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      if (data.settings) setValues(data.settings);
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="settings-form"
      className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6 shadow-sm"
    >
      <div className="flex flex-col gap-2">
        <label
          htmlFor="provider"
          className="text-sm font-medium text-foreground"
        >
          Local model provider
        </label>
        <select
          id="provider"
          name="provider"
          data-testid="settings-provider-select"
          value={activeProvider}
          onChange={(e) => update("provider", e.target.value as FormState["provider"])}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PROVIDER_DESCRIPTORS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Pick the local server LocalForge should talk to for chat and model
          listings.
        </p>
      </div>

      <Field
        label={`${activeDescriptor.label} URL`}
        id={activeUrlKey}
        description={
          activeProvider === "lm_studio"
            ? "Base URL of your LM Studio HTTP server. Defaults to http://127.0.0.1:1234."
            : "Base URL of your Ollama HTTP server. Defaults to http://127.0.0.1:11434."
        }
        value={activeUrl}
        onChange={(v) => update(activeUrlKey, v)}
        placeholder={
          activeProvider === "lm_studio"
            ? "http://127.0.0.1:1234"
            : "http://127.0.0.1:11434"
        }
      />

      <ProviderStatus
        descriptor={activeDescriptor}
        probe={probe}
        scan={scan}
        onSwitchProvider={(providerId, url) => {
          const urlKey = urlKeyFor(providerId);
          // Update both the provider AND the matching url field together
          // so the probe re-fires against the right URL on the next render.
          setSaved(false);
          setValues((prev) => ({
            ...prev,
            provider: providerId,
            [urlKey]: url,
          }));
        }}
      />

      <ModelField
        probe={probe}
        provider={activeProvider}
        model={values.model}
        onChange={(v) => update("model", v)}
      />

      <HardwarePanel
        model={values.model}
        installedModels={probe.status === "ok" ? probe.models : undefined}
        onModelChange={(v) => update("model", v)}
      />

      <Field
        label="Working directory"
        id="working_directory"
        description="Absolute path where new project folders will be created on disk."
        value={values.working_directory}
        onChange={(v) => update("working_directory", v)}
        placeholder="/path/to/projects"
      />
      <div className="flex flex-col gap-2">
        <label
          htmlFor="max_concurrent_agents"
          className="text-sm font-medium text-foreground"
        >
          Max concurrent agents
        </label>
        <select
          id="max_concurrent_agents"
          name="max_concurrent_agents"
          data-testid="settings-max-concurrent-agents-select"
          value={values.max_concurrent_agents}
          onChange={(e) => update("max_concurrent_agents", e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Default number of coding agents allowed to run in parallel per
          project. Most local setups only have the VRAM for one. Individual
          projects can override this in their own settings.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="playwright_enabled"
          className="text-sm font-medium text-foreground"
        >
          Playwright verification
        </label>
        <select
          id="playwright_enabled"
          name="playwright_enabled"
          data-testid="settings-playwright-enabled-select"
          value={values.playwright_enabled}
          onChange={(e) => update("playwright_enabled", e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="false">Disabled (default)</option>
          <option value="true">Enabled</option>
        </select>
        <p className="text-xs text-muted-foreground">
          When enabled, every completed feature is verified by launching
          Chromium against http://localhost:&lt;dev port&gt; and a screenshot
          is captured. Many small local models can&apos;t drive a browser
          reliably, so this is off by default — the coding agent&apos;s own
          success signal becomes the outcome. Individual projects can
          override this in their own settings.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="playwright_headed"
          className="text-sm font-medium text-foreground"
        >
          Playwright headed browser
        </label>
        <select
          id="playwright_headed"
          name="playwright_headed"
          data-testid="settings-playwright-headed-select"
          value={values.playwright_headed}
          onChange={(e) => update("playwright_headed", e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="false">Headless (default)</option>
          <option value="true">Headed (visible window)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          When Playwright verification is enabled, runs post-run Chromium in a
          visible window (with a short slowMo) and tells the coding agent to use{" "}
          <code className="font-mono">playwright-cli open --headed</code>. On
          CI (<code className="font-mono">CI</code> env set), verification stays
          headless. Individual projects can override in project settings.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={pending}
          data-testid="settings-save-button"
        >
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {saved && (
          <span
            data-testid="settings-saved-indicator"
            className="text-sm text-green-500"
          >
            Saved.
          </span>
        )}
        {error && (
          <span
            role="alert"
            data-testid="settings-error"
            className="text-sm text-destructive"
          >
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function guidanceForKind(
  kind: ProbeFailureKind,
  descriptor: ProviderDescriptor,
): { headline: string; steps: React.ReactNode } {
  const lmStudioSteps = (
    <ol className="ml-4 mt-1 list-decimal space-y-0.5">
      <li>Open the LM Studio app</li>
      <li>Go to the <span className="font-medium">Local Server</span> tab and click <span className="font-medium">Start Server</span></li>
      <li>Make sure a model is loaded (top-left dropdown)</li>
      <li>If you changed the port in LM Studio, update the URL above</li>
    </ol>
  );
  const ollamaSteps = (
    <ol className="ml-4 mt-1 list-decimal space-y-0.5">
      <li>Make sure the Ollama app is running, or run <code className="font-mono">ollama serve</code> in a terminal</li>
      <li>Pull a model with <code className="font-mono">ollama pull gemma3:4b</code> if you have none yet</li>
      <li>If you set <code className="font-mono">OLLAMA_HOST</code> to a custom port, update the URL above</li>
    </ol>
  );

  switch (kind) {
    case "not_running":
      return {
        headline: `${descriptor.label} isn't running`,
        steps: descriptor.id === "lm_studio" ? lmStudioSteps : ollamaSteps,
      };
    case "timeout":
      return {
        headline: `${descriptor.label} took too long to respond`,
        steps: (
          <p className="mt-1">
            The server didn&apos;t reply within 5 seconds. It may be hung — try
            restarting {descriptor.label}, or check that the URL above points
            at the right host.
          </p>
        ),
      };
    case "dns":
      return {
        headline: "Hostname couldn't be resolved",
        steps: (
          <p className="mt-1">
            The host portion of the URL above doesn&apos;t resolve. For a
            local-only setup the URL should usually be{" "}
            <code className="font-mono">{descriptor.defaultBaseUrl}</code>.
          </p>
        ),
      };
    case "http_error":
      return {
        headline: `${descriptor.label} responded but rejected the request`,
        steps: (
          <p className="mt-1">
            Something is listening at this URL, but it&apos;s not responding
            the way {descriptor.label} should. Double-check the URL — you may
            be pointing at a different service.
          </p>
        ),
      };
    case "wrong_shape":
      return {
        headline: "That URL doesn't look like " + descriptor.label,
        steps: (
          <p className="mt-1">
            We got a response but the JSON didn&apos;t match what{" "}
            {descriptor.label} returns. The URL may be pointing at the wrong
            kind of server.
          </p>
        ),
      };
    default:
      return {
        headline: `${descriptor.label} not detected`,
        steps: (
          <p className="mt-1">
            Start it locally, or install it from{" "}
            <a
              href={descriptor.installUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {descriptor.installUrl.replace(/^https?:\/\//, "")}
            </a>
            .
          </p>
        ),
      };
  }
}

function ProviderStatus({
  descriptor,
  probe,
  scan,
  onSwitchProvider,
}: {
  descriptor: ProviderDescriptor;
  probe: ModelsProbe;
  scan: ScanState;
  onSwitchProvider: (
    providerId: "lm_studio" | "ollama",
    url: string,
  ) => void;
}) {
  if (probe.status === "loading") {
    return (
      <p
        data-testid="settings-provider-status"
        className="text-xs text-muted-foreground"
      >
        Checking {descriptor.label}…
      </p>
    );
  }
  if (probe.status === "ok") {
    return (
      <p
        data-testid="settings-provider-status"
        data-provider-ok="true"
        className="text-xs text-green-500"
      >
        {descriptor.label} reachable — {probe.models.length} model
        {probe.models.length === 1 ? "" : "s"} available.
      </p>
    );
  }
  if (probe.status === "error") {
    const { headline, steps } = guidanceForKind(probe.kind, descriptor);
    // The scan can find the configured provider on its default URL too;
    // only suggest switching when we found a *different* provider responding.
    const altHits =
      scan.status === "done"
        ? scan.hits.filter((h) => h.providerId !== descriptor.id)
        : [];
    return (
      <div
        data-testid="settings-provider-status"
        data-provider-ok="false"
        data-failure-kind={probe.kind}
        className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">{headline}</p>
        {steps}

        {altHits.length > 0 && (
          <div
            data-testid="settings-scan-suggestion"
            className="mt-3 rounded-md border border-border bg-background/60 p-2"
          >
            <p className="font-medium text-foreground">
              Found {altHits[0].label} responding instead
            </p>
            <p className="mt-0.5">
              <code className="font-mono">{altHits[0].url}</code> —{" "}
              {altHits[0].modelCount} model
              {altHits[0].modelCount === 1 ? "" : "s"} available.
            </p>
            <button
              type="button"
              data-testid="settings-scan-switch"
              onClick={() =>
                onSwitchProvider(altHits[0].providerId, altHits[0].url)
              }
              className="mt-2 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-muted/60"
            >
              Switch to {altHits[0].label}
            </button>
          </div>
        )}

        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground/80 hover:text-muted-foreground">
            Technical details
          </summary>
          <p className="mt-1 break-all">{probe.message}</p>
        </details>
      </div>
    );
  }
  return null;
}

function ModelField({
  probe,
  provider,
  model,
  onChange,
}: {
  probe: ModelsProbe;
  provider: string;
  model: string;
  onChange: (v: string) => void;
}) {
  const showDropdown =
    probe.status === "ok" && probe.models.length > 0;

  if (showDropdown) {
    const known = probe.models.includes(model);
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor="model" className="text-sm font-medium text-foreground">
          Model
        </label>
        <select
          id="model"
          name="model"
          data-testid="settings-model-select"
          value={known ? model : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {!known && (
            <option value="" disabled>
              {model
                ? `Unknown model: ${model}`
                : "Select a model…"}
            </option>
          )}
          {probe.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Models detected on the {provider === "ollama" ? "Ollama" : "LM Studio"}{" "}
          server.
        </p>
      </div>
    );
  }

  // Provider unreachable or returned zero models → fall back to free-text so
  // the user can still type a model name (e.g. if they know what will be
  // loaded once they start the server).
  return (
    <Field
      label="Model"
      id="model"
      description={
        probe.status === "error"
          ? "Provider unreachable — enter the model id you'll have loaded. Switch providers or fix the URL to pick from a list."
          : "Model identifier to use for coding + bootstrapper sessions."
      }
      value={model}
      onChange={onChange}
      placeholder="google/gemma-4-31b"
    />
  );
}

function Field({
  label,
  id,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  id: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        data-testid={`settings-${id}-input`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
