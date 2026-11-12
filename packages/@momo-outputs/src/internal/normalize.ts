import type { DisplayData } from "../types.ts";

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
