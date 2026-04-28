/**
 * Approximate VRAM requirements for running local LLMs at Q4 quantization,
 * including a small overhead for the context window. Values are deliberately
 * conservative — actual requirements vary by quantization (Q8 ≈ 2x), context
 * size, and runtime.
 *
 * The match is done by parameter count parsed from the model id (e.g. "31b",
 * "8B", "70b") rather than by exact name, since the same model is published
 * under many slightly different identifiers.
 */

const SIZE_TO_VRAM_MB: Array<{ minB: number; maxB: number; vramMB: number }> = [
  { minB: 0,    maxB: 2,    vramMB: 1500   },
  { minB: 2,    maxB: 4,    vramMB: 2500   },
  { minB: 4,    maxB: 9,    vramMB: 5500   },
  { minB: 9,    maxB: 13,   vramMB: 8500   },
  { minB: 13,   maxB: 16,   vramMB: 10500  },
  { minB: 16,   maxB: 24,   vramMB: 15000  },
  { minB: 24,   maxB: 35,   vramMB: 21000  },
  { minB: 35,   maxB: 50,   vramMB: 30000  },
  { minB: 50,   maxB: 80,   vramMB: 44000  },
  { minB: 80,   maxB: 200,  vramMB: 100000 },
  { minB: 200,  maxB: 500,  vramMB: 240000 },
];

export type ModelEstimate = {
  /** Parsed parameter count in billions (e.g. 31 for "gemma-4-31b") */
  paramsB: number;
  /** Estimated VRAM needed at Q4 in megabytes */
  vramMB: number;
};

/**
 * Parse a model id like "google/gemma-4-31b" or "qwen2.5:14b" and return
 * its estimated VRAM requirement. Returns `null` if no parameter count
 * can be parsed from the id.
 */
export function estimateModelVram(modelId: string): ModelEstimate | null {
  if (!modelId) return null;

  // Match standalone "<digits>b" or "<digits>.<digits>b" preceded by a
  // non-alphanumeric boundary (or start of string), e.g. "-31b", "_8b",
  // ":7b", " 70b". Case-insensitive.
  const match = modelId.match(/(?:^|[^a-zA-Z0-9])(\d+(?:\.\d+)?)b(?:[^a-zA-Z0-9]|$)/i);
  if (!match) return null;

  const paramsB = parseFloat(match[1]);
  if (!Number.isFinite(paramsB) || paramsB <= 0) return null;

  const bucket = SIZE_TO_VRAM_MB.find((b) => paramsB > b.minB && paramsB <= b.maxB);
  if (!bucket) return null;

  return { paramsB, vramMB: bucket.vramMB };
}

export type FitStatus = "fits" | "tight" | "wont-fit";

/**
 * Compare a model's VRAM requirement against available VRAM.
 *
 * - `fits`     — model needs ≤ 70% of available VRAM (comfortable)
 * - `tight`    — model needs 70–100% (likely to spill to CPU)
 * - `wont-fit` — model exceeds available VRAM (will be very slow or fail)
 */
export function compareToAvailable(
  estimateMB: number,
  availableMB: number,
): FitStatus {
  if (availableMB <= 0) return "wont-fit";
  const ratio = estimateMB / availableMB;
  if (ratio <= 0.7) return "fits";
  if (ratio <= 1.0) return "tight";
  return "wont-fit";
}

/**
 * Suggest model sizes that will run comfortably on the given VRAM budget.
 * Returns a list of size labels (e.g. ["7B", "8B"]) that fit at ≤ 70% VRAM.
 */
export function suggestSizesForBudget(availableMB: number): string[] {
  const out: string[] = [];
  for (const bucket of SIZE_TO_VRAM_MB) {
    if (bucket.vramMB / availableMB <= 0.7) {
      out.push(`${bucket.minB}-${bucket.maxB}B`);
    }
  }
  return out;
}
