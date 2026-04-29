"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  compareToAvailable,
  estimateModelVram,
  pickBestFit,
  suggestSizesForBudget,
  type FitStatus,
} from "@/lib/models/vram-estimates";

type GpuInfo = {
  vendor: string;
  model: string;
  vramMB: number;
};

type HardwareInfo =
  | {
      available: true;
      platform: NodeJS.Platform;
      isAppleSilicon: boolean;
      gpus: GpuInfo[];
      totalVramMB: number;
      totalSystemRamMB: number;
    }
  | {
      available: false;
      platform: NodeJS.Platform;
      reason: string;
    };

function formatGB(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`;
}

function statusToTone(status: FitStatus): {
  className: string;
  label: string;
} {
  switch (status) {
    case "fits":
      return {
        className:
          "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
        label: "Fits comfortably",
      };
    case "tight":
      return {
        className:
          "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
        label: "Tight — may offload to CPU",
      };
    case "wont-fit":
      return {
        className:
          "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
        label: "Won't fit — switch to a smaller model",
      };
  }
}

export function HardwarePanel({
  model,
  installedModels,
  onModelChange,
}: {
  model: string;
  installedModels?: string[];
  onModelChange?: (modelId: string) => void;
}) {
  const [hw, setHw] = useState<HardwareInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/system/hardware", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: HardwareInfo) => {
        if (!cancelled) setHw(data);
      })
      .catch(() => {
        // Silent — hardware detection is best-effort
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hw) {
    return (
      <div
        data-testid="settings-hardware-panel"
        className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        Detecting hardware…
      </div>
    );
  }

  if (!hw.available) {
    return (
      <div
        data-testid="settings-hardware-panel"
        data-hw-available="false"
        className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">Hardware not detected</p>
        <p className="mt-1">{hw.reason}</p>
      </div>
    );
  }

  const primary = hw.gpus[0];
  const memoryLabel = hw.isAppleSilicon ? "Unified memory" : "VRAM";

  // Some vendors prefix the model with their own name (e.g. NVIDIA's controller
  // strings); avoid rendering "NVIDIA NVIDIA GeForce …".
  const primaryName = primary.model.toLowerCase().startsWith(primary.vendor.toLowerCase())
    ? primary.model
    : `${primary.vendor} ${primary.model}`;

  const estimate = estimateModelVram(model);
  const status: FitStatus | null = estimate
    ? compareToAvailable(estimate.vramMB, hw.totalVramMB)
    : null;

  // Only suggest a swap when the current pick doesn't fit AND we know the
  // user's installed models AND a different model would actually be better.
  const bestFit =
    status !== "fits" && installedModels && installedModels.length > 0
      ? pickBestFit(installedModels, hw.totalVramMB)
      : null;
  const showBestFit =
    bestFit !== null && bestFit.modelId !== model && onModelChange !== undefined;

  return (
    <div
      data-testid="settings-hardware-panel"
      data-hw-available="true"
      data-fit-status={status ?? undefined}
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4"
    >
      <div>
        <p className="text-sm font-medium text-foreground">Detected hardware</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {primaryName}
          {hw.gpus.length > 1 && (
            <span className="text-muted-foreground/70">
              {" "}
              (+{hw.gpus.length - 1} more)
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {memoryLabel}: <span className="font-mono">{formatGB(hw.totalVramMB)}</span>
        </p>
      </div>

      {estimate && status && (
        <ModelFitBanner
          status={status}
          modelLabel={model}
          paramsB={estimate.paramsB}
          estimateMB={estimate.vramMB}
          availableMB={hw.totalVramMB}
          memoryLabel={memoryLabel}
        />
      )}

      {showBestFit && bestFit && (
        <div
          data-testid="settings-bestfit-suggestion"
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-md border border-border bg-background/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-xs text-muted-foreground">
            Best fit from your installed models:{" "}
            <span className="font-mono text-foreground">{bestFit.modelId}</span>{" "}
            ({bestFit.estimate.paramsB}B, ≈{" "}
            <span className="font-mono">{formatGB(bestFit.estimate.vramMB)}</span>)
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="settings-bestfit-apply"
            onClick={() => onModelChange?.(bestFit.modelId)}
          >
            Use best fit
          </Button>
        </div>
      )}

      {!estimate && model && (
        <p
          data-testid="settings-fit-unknown"
          className="text-xs text-muted-foreground"
        >
          Couldn&apos;t infer parameter size from{" "}
          <span className="font-mono">{model}</span> — fit estimate unavailable.
        </p>
      )}
    </div>
  );
}

function ModelFitBanner({
  status,
  modelLabel,
  paramsB,
  estimateMB,
  availableMB,
  memoryLabel,
}: {
  status: FitStatus;
  modelLabel: string;
  paramsB: number;
  estimateMB: number;
  availableMB: number;
  memoryLabel: string;
}) {
  const tone = statusToTone(status);
  const suggestions = status === "wont-fit" ? suggestSizesForBudget(availableMB) : [];

  return (
    <div
      data-testid="settings-fit-banner"
      role="status"
      aria-live="polite"
      className={`rounded-md border px-3 py-2 text-xs ${tone.className}`}
    >
      <p className="font-medium">{tone.label}</p>
      <p className="mt-1">
        <span className="font-mono">{modelLabel}</span> ({paramsB}B) needs ≈{" "}
        <span className="font-mono">{formatGB(estimateMB)}</span> at Q4 — your{" "}
        {memoryLabel.toLowerCase()} is{" "}
        <span className="font-mono">{formatGB(availableMB)}</span>.
      </p>
      {suggestions.length > 0 && (
        <p className="mt-1">
          Suggested model sizes that fit:{" "}
          <span className="font-mono">{suggestions.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
