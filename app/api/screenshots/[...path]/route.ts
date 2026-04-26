import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Feature #96: serve verification screenshots captured by the coding agent
 * runner.
 *
 * The runner writes PNGs into `<repo>/screenshots/feature-<id>-<slug>.png`
 * and the SSE log stream exposes that relative path as `screenshotPath`.
 * When the feature-detail modal sees a log with `messageType === "screenshot"`
 * it renders an `<img src="/api/screenshots/<relativePath>">` that resolves
 * back through this route.
 *
 * Security: we only serve files that sit inside the repo's `screenshots/`
 * directory. Any attempt to escape via `..` traversal is rejected with 400
 * so the endpoint can't be used to siphon arbitrary files from disk.
 */
type RouteContext = { params: Promise<{ path: string[] }> };

const SCREENSHOTS_ROOT = path.join(process.cwd(), "screenshots");

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { path: segments } = await ctx.params;
  if (!Array.isArray(segments) || segments.length === 0) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const joined = segments.join("/");
  const resolved = path.resolve(SCREENSHOTS_ROOT, joined);

  // Reject any traversal outside SCREENSHOTS_ROOT. `path.relative` is the
  // canonical way: if the result starts with `..` or is absolute, we're
  // outside the allowed tree.
  const rel = path.relative(SCREENSHOTS_ROOT, resolved);
  if (
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    rel.includes(".." + path.sep)
  ) {
    return NextResponse.json({ error: "Forbidden path" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(resolved);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      // Short cache — screenshots can be re-captured on subsequent runs but
      // we don't want a stale CDN hit. The filename has the feature id so
      // cross-feature collisions aren't possible.
      "Cache-Control": "private, max-age=60",
    },
  });
}
