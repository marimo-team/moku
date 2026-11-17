/**
 * React components for notebook display data and console output.
 *
 * Pass output records from the execution you want to display. Rich displays
 * load the embedded renderer on demand. Wrap interactive outputs in
 * {@link Provider} so their widgets can call back into the notebook.
 *
 * @example Render a JSON value
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
