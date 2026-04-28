import { NextResponse } from "next/server";
import os from "node:os";
import si from "systeminformation";

export const dynamic = "force-dynamic";

type GpuInfo = {
  vendor: string;
  model: string;
  vramMB: number;
};

type HardwareInfo = {
  available: true;
  platform: NodeJS.Platform;
  isAppleSilicon: boolean;
  gpus: GpuInfo[];
  totalVramMB: number;
  totalSystemRamMB: number;
};

type HardwareUnavailable = {
  available: false;
  platform: NodeJS.Platform;
  reason: string;
};

type HardwareResponse = HardwareInfo | HardwareUnavailable;

let cached: HardwareResponse | null = null;

function detectAppleSilicon(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

async function detect(): Promise<HardwareResponse> {
  const platform = process.platform;

  try {
    const graphics = await si.graphics();
    const isAppleSilicon = detectAppleSilicon();

    // On Apple Silicon the GPU shares unified memory with the system, so a
    // discrete VRAM number is misleading. We treat ~75% of total RAM as the
    // practical model budget.
    if (isAppleSilicon) {
      const totalSystemRamMB = Math.round(os.totalmem() / 1024 / 1024);
      const unifiedBudgetMB = Math.round(totalSystemRamMB * 0.75);
      const primary = graphics.controllers[0];
      return {
        available: true,
        platform,
        isAppleSilicon: true,
        gpus: [
          {
            vendor: primary?.vendor ?? "Apple",
            model: primary?.model ?? "Apple Silicon",
            vramMB: unifiedBudgetMB,
          },
        ],
        totalVramMB: unifiedBudgetMB,
        totalSystemRamMB,
      };
    }

    const gpus: GpuInfo[] = graphics.controllers
      .filter((c) => typeof c.vram === "number" && c.vram > 0)
      .map((c) => ({
        vendor: c.vendor ?? "Unknown",
        model: c.model ?? "Unknown",
        vramMB: c.vram ?? 0,
      }))
      // Largest GPU first so the UI surfaces the discrete card (most likely
      // used for AI inference) ahead of integrated graphics.
      .sort((a, b) => b.vramMB - a.vramMB);

    if (gpus.length === 0) {
      return {
        available: false,
        platform,
        reason: "No discrete GPU with reportable VRAM detected",
      };
    }

    const totalVramMB = Math.max(...gpus.map((g) => g.vramMB));

    return {
      available: true,
      platform,
      isAppleSilicon: false,
      gpus,
      totalVramMB,
      totalSystemRamMB: Math.round(os.totalmem() / 1024 / 1024),
    };
  } catch (err) {
    return {
      available: false,
      platform,
      reason: err instanceof Error ? err.message : "Hardware detection failed",
    };
  }
}

/**
 * GET /api/system/hardware
 *
 * Returns the host machine's GPU and VRAM info. Cached for the lifetime of
 * the dev server since hardware doesn't change mid-run. Never throws — on
 * detection failure returns `{ available: false, reason }`.
 */
export async function GET() {
  if (!cached) cached = await detect();
  return NextResponse.json(cached);
}
