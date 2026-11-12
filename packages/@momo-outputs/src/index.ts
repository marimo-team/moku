/**
 * React components for notebook display data and console output.
 *
 * Pass output records from your chosen execution. Components do not subscribe
 * to notebook state. Rich displays load the embedded marimo renderer on demand;
 * widget sessions, function calls, and runtime asset routes are not connected.
 *
 * ```tsx
 * import { DisplayView } from "@momo/outputs";
 *
 * <DisplayView data={{ mimetype: "application/json", data: '{"answer":42}' }} />;
 * ```
 *
 * @module
 */
export { DisplayView } from "./DisplayView.tsx";
export { ConsoleOutput } from "./ConsoleOutput.tsx";
export { CellOutputs } from "./CellOutputs.tsx";
export { setTheme } from "./internal/renderer.ts";
export type {
  DisplayData,
  ConsoleChunk,
  Outcome,
  OutputItem,
  Theme,
  DisplayViewProps,
  ConsoleOutputProps,
  CellOutputsProps,
} from "./types.ts";
