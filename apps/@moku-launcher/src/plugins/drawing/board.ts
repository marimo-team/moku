/**
 * The board cell: where the Drawing view keeps its ink and card layout inside the notebook.
 *
 * The board is the `.sketcher` JSON, compressed and base64-encoded into string pieces of a
 * private Python variable, so the cell is valid Python that defines nothing and the file stays
 * a plain marimo notebook. The cell is disabled, so it never runs.
 *
 * ```python
 * @app.cell(disabled=True, hide_code=True)
 * def sketcher_board():
 *     # sketcher:board v1 ...
 *     _board = (
 *         "…"
 *     )
 *     return
 * ```
 *
 * @module
 */
import { type Drawing, decodeDrawing, encodeDrawing, stableStringify } from "sketcher";

/** The board cell's name. Generated cells never take it. */
export const CELL_NAME = "sketcher_board";

const MARKER = "# sketcher:board v1";
const HEADER = `${MARKER}: the Drawing view's ink and card layout (deflate, base64)`;
const CHUNK = 80;
/** Above this the notebook file gets unwieldy; the view warns. */
export const LARGE_BOARD = 2_000_000;

/** Whether this cell code is a board, so other views can leave it alone. */
export const isBoard = (code: string | null): boolean =>
  !!code && code.trimStart().startsWith(MARKER);

/** The cell code for a board. Coordinates are rounded to 0.001, which nobody can see. */
export async function encode(drawing: Drawing): Promise<string> {
  const json = stableStringify(round(encodeDrawing(drawing)));
  const bytes = await pipe(
    new TextEncoder().encode(json),
    new CompressionStream("deflate-raw"),
  );
  const b64 = toBase64(bytes);
  const pieces: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK)
    pieces.push(`    "${b64.slice(i, i + CHUNK)}"`);
  return `${HEADER}\n_board = (\n${pieces.join("\n") || '    ""'}\n)`;
}

/** Reads a board cell. Throws if the code isn't one (or is damaged). */
export async function decode(code: string): Promise<Drawing> {
  if (!isBoard(code)) throw new Error("Not a Sketcher board cell.");
  const start = code.indexOf("_board");
  if (start < 0) throw new Error("The board cell has no _board.");
  // Base64 has no quotes, so every quoted piece after `_board` is part of it.
  const b64 = [...code.slice(start).matchAll(/"([A-Za-z0-9+/=]*)"/g)]
    .map((m) => m[1])
    .join("");
  if (!b64)
    return decodeDrawing({ version: 2, strokes: [], math: [], background: "dots" });
  const bytes = await pipe(fromBase64(b64), new DecompressionStream("deflate-raw"));
  return decodeDrawing(JSON.parse(new TextDecoder().decode(bytes)));
}

function round(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === "object") {
    // Host data (cell code and so on) is kept exactly.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, k === "data" ? v : round(v)]),
    );
  }
  return value;
}

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
