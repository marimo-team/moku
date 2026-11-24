/** Schemas from the host protocol, including notebook dependency analysis. @module */
import { Notebook, Schemas } from "@marimo-team/host-protocol/experimental";
export * from "@marimo-team/host-protocol/Schemas";
export * from "@marimo-team/host-protocol/Problems";

/** Dependency analysis for a document revision and its cells. */
export const { Analysis, CellAnalysis } = Schemas;
/** Events published on a notebook stream, including experimental analysis. */
export const NotebookEvent = Notebook.StreamEvent;
/** A decoded notebook stream event. */
export type NotebookEvent = Notebook.StreamEvent;
