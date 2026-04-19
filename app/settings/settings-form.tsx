"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { GlobalSettingsShape } from "@/lib/settings";

type FormState = GlobalSettingsShape;

export function SettingsForm({ initial }: { initial: FormState }) {
  const [values, setValues] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

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
      <Field
        label="LM Studio URL"
        id="lm_studio_url"
        description="Base URL of your LM Studio HTTP server. Defaults to http://127.0.0.1:1234."
        value={values.lm_studio_url}
        onChange={(v) => update("lm_studio_url", v)}
        placeholder="http://127.0.0.1:1234"
      />
      <Field
        label="Model"
        id="model"
        description="Model identifier loaded in LM Studio (e.g. google/gemma-4-31b)."
        value={values.model}
        onChange={(v) => update("model", v)}
        placeholder="google/gemma-4-31b"
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
