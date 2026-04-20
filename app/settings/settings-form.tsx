"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { GlobalSettingsShape } from "@/lib/settings";

type FormState = GlobalSettingsShape;

type ProviderDescriptor = {
  id: "lm_studio" | "ollama";
  label: string;
  installUrl: string;
};

const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  { id: "lm_studio", label: "LM Studio", installUrl: "https://lmstudio.ai" },
  { id: "ollama", label: "Ollama", installUrl: "https://ollama.com" },
];

function urlKeyFor(provider: string): "lm_studio_url" | "ollama_url" {
  return provider === "ollama" ? "ollama_url" : "lm_studio_url";
}

type ModelsProbe =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; models: string[] }
  | { status: "error"; message: string };

export function SettingsForm({ initial }: { initial: FormState }) {
  const [values, setValues] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [probe, setProbe] = useState<ModelsProbe>({ status: "idle" });
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runProbe = useCallback(
    (provider: string, url: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setProbe({ status: "loading" });
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/providers/${provider}/models?url=${encodeURIComponent(url)}`,
            { cache: "no-store" },
          );
          const data = (await res.json()) as {
            ok?: boolean;
            models?: string[];
            error?: string;
          };
          if (!res.ok || !data.ok) {
            setProbe({
              status: "error",
              message: data.error ?? `Probe failed (HTTP ${res.status})`,
            });
            return;
          }
          setProbe({ status: "ok", models: data.models ?? [] });
        } catch (err) {
          setProbe({
            status: "error",
            message: err instanceof Error ? err.message : "Probe failed",
          });
        }
      }, 400);
    },
    [],
  );

  useEffect(() => {
    runProbe(activeProvider, activeUrl);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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
      />

      <ModelField
        probe={probe}
        provider={activeProvider}
        model={values.model}
        onChange={(v) => update("model", v)}
      />

      <Field
        label="Working directory"
        id="working_directory"
        description="Absolute path where new project folders will be created on disk."
        value={values.working_directory}
        onChange={(v) => update("working_directory", v)}
        placeholder="/path/to/projects"
      />
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

function ProviderStatus({
  descriptor,
  probe,
}: {
  descriptor: ProviderDescriptor;
  probe: ModelsProbe;
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
    return (
      <div
        data-testid="settings-provider-status"
        data-provider-ok="false"
        className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">
          {descriptor.label} not detected
        </p>
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
          . Details: {probe.message}
        </p>
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
