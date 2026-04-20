"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Project-specific settings dialog (Feature #35).
 *
 * The `settings` table stores global rows with `project_id = NULL` and
 * per-project overrides with a non-null `project_id`. This dialog lets the
 * user override the local-model provider, the provider's base URL, and/or
 * the model for a single project. Leaving a field blank falls back to the
 * corresponding global value.
 *
 * The API call to PUT /api/projects/:id/settings accepts an empty string
 * as a signal to clear that override, so "back to global default" is just
 * "clear the field and save".
 */

type ProviderId = "lm_studio" | "ollama";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  lm_studio: "LM Studio",
  ollama: "Ollama",
};

const PROVIDER_INSTALL_URLS: Record<ProviderId, string> = {
  lm_studio: "https://lmstudio.ai",
  ollama: "https://ollama.com",
};

function isProvider(value: unknown): value is ProviderId {
  return value === "lm_studio" || value === "ollama";
}

function urlKeyFor(provider: ProviderId): "lm_studio_url" | "ollama_url" {
  return provider === "ollama" ? "ollama_url" : "lm_studio_url";
}

type ProjectSettingsResponse = {
  overrides: {
    provider: string | null;
    lm_studio_url: string | null;
    ollama_url: string | null;
    model: string | null;
  };
  effective: {
    provider: string;
    lm_studio_url: string;
    ollama_url: string;
    model: string;
  };
  defaults: {
    provider: string;
    lm_studio_url: string;
    ollama_url: string;
    model: string;
  };
};

type ModelsProbe =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; models: string[] }
  | { status: "error"; message: string };

export type ProjectSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectName: string;
};

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ProjectSettingsDialogProps) {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<ProjectSettingsResponse | null>(null);
  // Overrides edited by the user. Empty string means "clear the override".
  const [provider, setProvider] = React.useState<string>("");
  const [lmStudioUrl, setLmStudioUrl] = React.useState("");
  const [ollamaUrl, setOllamaUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState<ModelsProbe>({ status: "idle" });

  // Fetch current overrides + defaults whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setSaved(false);
      try {
        const res = await fetch(`/api/projects/${projectId}/settings`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as Partial<ProjectSettingsResponse> & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || `Load failed (${res.status})`);
        }
        if (cancelled) return;
        const complete = payload as ProjectSettingsResponse;
        setData(complete);
        setProvider(complete.overrides.provider ?? "");
        setLmStudioUrl(complete.overrides.lm_studio_url ?? "");
        setOllamaUrl(complete.overrides.ollama_url ?? "");
        setModel(complete.overrides.model ?? "");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load project settings",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // The provider whose models we should probe = the override if set, else
  // the currently-effective provider (which already reflects the global).
  const effectiveProviderRaw =
    provider || data?.effective.provider || "lm_studio";
  const activeProvider: ProviderId = isProvider(effectiveProviderRaw)
    ? effectiveProviderRaw
    : "lm_studio";

  const effectiveUrl = (() => {
    if (activeProvider === "ollama") {
      return ollamaUrl || data?.effective.ollama_url || "";
    }
    return lmStudioUrl || data?.effective.lm_studio_url || "";
  })();

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!open || !data || !effectiveUrl) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setProbe({ status: "loading" });
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/providers/${activeProvider}/models?url=${encodeURIComponent(
            effectiveUrl,
          )}`,
          { cache: "no-store" },
        );
        const payload = (await res.json()) as {
          ok?: boolean;
          models?: string[];
          error?: string;
        };
        if (!res.ok || !payload.ok) {
          setProbe({
            status: "error",
            message: payload.error ?? `Probe failed (HTTP ${res.status})`,
          });
          return;
        }
        setProbe({ status: "ok", models: payload.models ?? [] });
      } catch (err) {
        setProbe({
          status: "error",
          message: err instanceof Error ? err.message : "Probe failed",
        });
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, data, activeProvider, effectiveUrl]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Empty strings clear the override on the server side, falling
          // back to the global default. Anything else sets it.
          provider,
          lm_studio_url: lmStudioUrl,
          ollama_url: ollamaUrl,
          model,
        }),
      });
      const payload = (await res.json()) as Partial<ProjectSettingsResponse> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || `Save failed (${res.status})`);
      }
      if (payload.overrides && payload.effective) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                overrides: payload.overrides!,
                effective: payload.effective!,
              }
            : prev,
        );
      }
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save project settings",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const urlKey = urlKeyFor(activeProvider);
  const urlValue = activeProvider === "ollama" ? ollamaUrl : lmStudioUrl;
  const setUrlValue =
    activeProvider === "ollama" ? setOllamaUrl : setLmStudioUrl;
  const urlDefault =
    activeProvider === "ollama"
      ? data?.defaults.ollama_url ?? ""
      : data?.defaults.lm_studio_url ?? "";
  const urlOverridden =
    activeProvider === "ollama"
      ? !!data?.overrides.ollama_url
      : !!data?.overrides.lm_studio_url;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
      labelledBy="project-settings-title"
    >
      <DialogCloseButton onClick={() => onOpenChange(false)} />
      <DialogHeader>
        <DialogTitle id="project-settings-title">Project settings</DialogTitle>
        <DialogDescription>
          Override the local-model provider, URL, or model for{" "}
          <span className="font-medium text-foreground">{projectName}</span>.
          Leave a field blank to use the global default.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} data-testid="project-settings-form">
        <DialogBody className="space-y-4">
          {loading && (
            <p
              data-testid="project-settings-loading"
              className="text-sm text-muted-foreground"
            >
              Loading current settings…
            </p>
          )}
          {!loading && data && (
            <>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="project-provider"
                  className="text-sm font-medium text-foreground"
                >
                  Provider
                </label>
                <select
                  id="project-provider"
                  name="project-provider"
                  data-testid="project-settings-provider-select"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={submitting}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">
                    Use global default ({PROVIDER_LABELS[
                      isProvider(data.defaults.provider)
                        ? data.defaults.provider
                        : "lm_studio"
                    ]})
                  </option>
                  <option value="lm_studio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {data.overrides.provider
                    ? "Project override is set. Choose 'Use global default' to clear."
                    : "Using the global default. Pick a provider to override."}
                </p>
              </div>
              <Field
                label={`${PROVIDER_LABELS[activeProvider]} URL`}
                id={`project-${urlKey}`}
                value={urlValue}
                onChange={setUrlValue}
                placeholder={urlDefault}
                disabled={submitting}
                description={
                  urlOverridden
                    ? "Project override is set. Clear to fall back to the global default."
                    : "Using the global default. Type a value to override."
                }
              />
              <ProviderProbeStatus
                provider={activeProvider}
                probe={probe}
              />
              <ModelField
                probe={probe}
                provider={activeProvider}
                model={model}
                onChange={setModel}
                placeholder={data.defaults.model}
                disabled={submitting}
                overridden={!!data.overrides.model}
              />
              <div
                data-testid="project-settings-effective"
                className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
              >
                <p className="font-medium text-foreground">
                  Currently effective
                </p>
                <p className="mt-1">
                  Provider:{" "}
                  <span>
                    {PROVIDER_LABELS[
                      isProvider(data.effective.provider)
                        ? data.effective.provider
                        : "lm_studio"
                    ]}
                  </span>
                </p>
                <p>
                  URL:{" "}
                  <span>
                    {
                      data.effective[
                        urlKeyFor(
                          isProvider(data.effective.provider)
                            ? data.effective.provider
                            : "lm_studio",
                        )
                      ]
                    }
                  </span>
                </p>
                <p>
                  Model: <span>{data.effective.model}</span>
                </p>
              </div>
            </>
          )}
          {error && (
            <p
              role="alert"
              data-testid="project-settings-error"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {saved && (
            <p
              data-testid="project-settings-saved"
              className="text-sm text-green-500"
            >
              Saved.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="project-settings-close"
          >
            Close
          </Button>
          <Button
            type="submit"
            disabled={loading || submitting}
            data-testid="project-settings-save"
          >
            {submitting ? "Saving…" : "Save settings"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ProviderProbeStatus({
  provider,
  probe,
}: {
  provider: ProviderId;
  probe: ModelsProbe;
}) {
  const label = PROVIDER_LABELS[provider];
  if (probe.status === "loading") {
    return (
      <p
        data-testid="project-settings-provider-status"
        className="text-xs text-muted-foreground"
      >
        Checking {label}…
      </p>
    );
  }
  if (probe.status === "ok") {
    return (
      <p
        data-testid="project-settings-provider-status"
        data-provider-ok="true"
        className="text-xs text-green-500"
      >
        {label} reachable — {probe.models.length} model
        {probe.models.length === 1 ? "" : "s"} available.
      </p>
    );
  }
  if (probe.status === "error") {
    return (
      <div
        data-testid="project-settings-provider-status"
        data-provider-ok="false"
        className="rounded-md border border-dashed border-border bg-muted/40 p-2 text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">{label} not detected</p>
        <p className="mt-0.5">
          Install from{" "}
          <a
            href={PROVIDER_INSTALL_URLS[provider]}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {PROVIDER_INSTALL_URLS[provider].replace(/^https?:\/\//, "")}
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
  placeholder,
  disabled,
  overridden,
}: {
  probe: ModelsProbe;
  provider: ProviderId;
  model: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  overridden: boolean;
}) {
  if (probe.status === "ok" && probe.models.length > 0) {
    const known = probe.models.includes(model);
    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor="project-model"
          className="text-sm font-medium text-foreground"
        >
          Model
        </label>
        <select
          id="project-model"
          name="project-model"
          data-testid="project-settings-model-select"
          value={known ? model : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">
            {overridden ? "Use global default" : `Use global default (${placeholder})`}
          </option>
          {probe.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {overridden
            ? "Project override is set. Choose 'Use global default' to clear."
            : `Models detected on the ${PROVIDER_LABELS[provider]} server.`}
        </p>
      </div>
    );
  }

  return (
    <Field
      label="Model"
      id="project-model"
      value={model}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      description={
        overridden
          ? "Project override is set. Clear to fall back to the global default."
          : probe.status === "error"
            ? "Provider unreachable — type a model id or fix the URL above."
            : "Using the global default. Type a value to override."
      }
    />
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  description,
  disabled,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        data-testid={`project-settings-${id}-input`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
