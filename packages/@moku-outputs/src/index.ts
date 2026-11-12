/**
 * React components for notebook display data and console output.
 *
 * Pass output records from your chosen execution. Components do not subscribe
 * to notebook state. Rich displays load the embedded marimo renderer on demand;
 * Provider connects native widgets and function calls to a notebook runtime.
 *
 * ```tsx
 * import { DisplayView } from "@moku/outputs";
 *
 * <DisplayView data={{ mimetype: "application/json", data: '{"answer":42}' }} />;
 * ```
 *
 * @module
 */
export { Provider, type ProviderProps } from "./Provider.tsx";
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
