// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/index.ts. Edit it there and rerun scripts/sketcher.ts.
export {
  Sketcher, createSketcher, type SketcherOptions, type Appearance, type Tool, type AskRequest, type AskResult, type AskSideUpdate,
  type MountEmbed, type ConnectRequest, type ConnectResult, type EmbedOutput, type Wire,
} from "./canvas/sketcher";
export { RecognizerError, explain, findResult, parseStructured, type ClaudeReply } from "./math/recognizer";
export * from "./core";
export { renderImage, renderPNG } from "./render/export";
