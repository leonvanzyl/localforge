import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

// In-memory cache for hot path. Disk cache below survives dev hot-reloads
// and full server restarts since `si.graphics()` on Windows can take
// 3+ seconds (WMI startup cost).
let memoryCache: HardwareResponse | null = null;

const CACHE_FILE = path.join(process.cwd(), "data", "hardware-cache.json");

function detectAppleSilicon(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

function readDiskCache(): HardwareResponse | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as HardwareResponse;
    // Invalidate if the platform doesn't match what we're running on now —
    // covers the edge case of a cache file copied from another machine.
    if (parsed.platform !== process.platform) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDiskCache(value: HardwareResponse): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // Cache write failure is non-fatal — we'll just re-detect next time.
  }
}

async function detect(): Promise<HardwareResponse> {
  const platform = process.platform;

  try {
    const graphics = await si.graphics();
    const isAppleSilicon = detectAppleSilicon();

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
 * Returns the host machine's GPU and VRAM info. Cached aggressively
 * (memory + disk) since `si.graphics()` on Windows takes ~3 seconds via
 * WMI and hardware doesn't change at runtime. Pass `?refresh=1` to force
 * re-detection (useful after plugging in an eGPU).
 */
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (!refresh && memoryCache) {
    return NextResponse.json(memoryCache);
  }

  if (!refresh) {
    const fromDisk = readDiskCache();
    if (fromDisk) {
      memoryCache = fromDisk;
      return NextResponse.json(fromDisk);
    }
  }

  const result = await detect();
  memoryCache = result;
  if (result.available) {
    // Only persist successful detections — a transient failure shouldn't
    // poison the cache for future requests.
    writeDiskCache(result);
  }
  return NextResponse.json(result);
}
