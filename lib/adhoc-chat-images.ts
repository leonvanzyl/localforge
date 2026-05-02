import "server-only";

export type AdhocImagePart = { mimeType: string; data: string };

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const ADHOC_MAX_IMAGES = 6;
export const ADHOC_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function normalizeImageMime(m: string): string {
  const x = m.toLowerCase().split(";")[0].trim();
  if (x === "image/jpg") return "image/jpeg";
  return x;
}

/** Strip data URL prefix if present; return raw base64 payload without whitespace. */
export function stripBase64Payload(s: string): string {
  const t = s.trim();
  const m = /^data:([^;]+);base64,(.+)$/s.exec(t);
  if (m) return m[2].replace(/\s/g, "");
  return t.replace(/\s/g, "");
}

export type ParseAdhocImagesResult =
  | { ok: true; images: AdhocImagePart[] }
  | { ok: false; error: string };

export function parseAdhocImagesFromRequestBody(
  raw: unknown,
): ParseAdhocImagesResult {
  if (raw == null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "images must be an array" };
  }
  if (raw.length > ADHOC_MAX_IMAGES) {
    return {
      ok: false,
      error: `At most ${ADHOC_MAX_IMAGES} images per message`,
    };
  }

  const images: AdhocImagePart[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Invalid image entry" };
    }
    const mimeRaw = (item as { mimeType?: unknown }).mimeType;
    const dataRaw = (item as { data?: unknown }).data;
    if (typeof mimeRaw !== "string" || typeof dataRaw !== "string") {
      return {
        ok: false,
        error: "Each image needs mimeType and data (base64)",
      };
    }

    const mimeType = normalizeImageMime(mimeRaw);
    if (!ALLOWED.has(mimeType)) {
      return { ok: false, error: `Unsupported image type: ${mimeRaw}` };
    }

    const data = stripBase64Payload(dataRaw);
    const buf = Buffer.from(data, "base64");
    if (buf.length === 0) {
      return { ok: false, error: "Invalid or empty image data" };
    }
    if (buf.length > ADHOC_MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `Each image must be ≤ ${ADHOC_MAX_IMAGE_BYTES / (1024 * 1024)}MB`,
      };
    }

    images.push({ mimeType, data: buf.toString("base64") });
  }

  return { ok: true, images };
}

export function transcriptTextWithAttachmentNote(
  content: string,
  attachmentsJson: string | null | undefined,
): string {
  if (!attachmentsJson?.trim()) return content;
  try {
    const arr = JSON.parse(attachmentsJson) as unknown;
    const n = Array.isArray(arr) ? arr.length : 0;
    if (n <= 0) return content;
    const note = `[${n} image(s) attached in this message]`;
    if (!content.trim()) return note;
    return `${content}\n${note}`;
  } catch {
    return content;
  }
}

export function serializeAttachmentsForDb(
  images: AdhocImagePart[],
): string | null {
  if (images.length === 0) return null;
  return JSON.stringify(images);
}
