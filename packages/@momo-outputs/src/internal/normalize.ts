/**
 * Convert embedded media payloads to the format expected by the renderer.
 *
 * @module
 */
import type { DisplayData } from "../types.ts";

/**
 * Wraps base64 images and videos in data URLs, preserving data URLs and inline SVG.
 */
export function normalizeDisplay(data: DisplayData): DisplayData {
  const { mimetype, data: content } = data;
  if (!/^(image|video)\//.test(mimetype) || content.startsWith("data:")) {
    return data;
  }
  if (mimetype === "image/svg+xml" && content.trimStart().startsWith("<")) {
    return data;
  }
  return { mimetype, data: `data:${mimetype};base64,${content}` };
}
