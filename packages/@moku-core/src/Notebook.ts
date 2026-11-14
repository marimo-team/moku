/** Observe and edit a notebook acquired with Host.notebooks.attach. @module */
import type { Effect } from "effect";
import type { AsyncResult, Atom } from "effect/reactivity";
import type * as Protocol from "./Protocol.ts";
import type { Client } from "./internal/client.ts";
import { ModelError } from "./internal/client.ts";
import type { Sse } from "effect/encoding";
export { ModelError };

/** A coherent document revision with its cells in display order. */
export interface Document extends Protocol.DocumentOutput {
  /** Cells belonging to this revision, in display order. */
  readonly cells: readonly Protocol.CellOutput[];
}
/** The synchronized notebook and its retained activity. */
export interface State {
  /** Metadata and permitted operations, or null after removal. */
  readonly notebook: Protocol.NotebookOutput | null;
  /** The latest complete source revision, or null when source is unavailable. */
  readonly document: Document | null;
  /** The attached runtime, or null when none exists. */
  readonly runtime: Protocol.RuntimeOutput | null;
  /** Dependency analysis for the published document, or null while unavailable. */
  readonly analysis: Protocol.AnalysisOutput | null;
  /** Retained runs indexed by ID. */
  readonly runs: Readonly<Record<string, Protocol.RunOutput>>;
  /** Retained cell and scratch executions indexed by ID. */
  readonly executions: Readonly<Record<string, Protocol.ExecutionOutput>>;
  /** Console chunks indexed by ID and associated with an execution. */
  readonly consoles: Readonly<Record<string, Protocol.ConsoleOutput>>;
  /** Display records indexed by ID and associated with an execution. */
  readonly displays: Readonly<Record<string, Protocol.DisplayOutput>>;
  /** Variables currently reported by the runtime. */
  readonly variables: Readonly<Record<string, Protocol.VariableOutput>>;
  /** Input requests indexed by ID, including pending replies. */
  readonly inputs: Readonly<Record<string, Protocol.InputOutput>>;
}
/** A cell version accepted by the host, usable in a subsequent run. */
export interface CellVersion {
  /** The notebook that owns this cell version. */
  readonly notebook_id: Protocol.NotebookOutput["id"];
  /** The cell to execute. */
  readonly id: Protocol.CellId;
  /** The cell version the host must still hold. */
  readonly etag: Protocol.CellOutput["etag"];
}
/** The document revision and surviving cells changed by an edit or save. */
export interface EditResult {
  /** The revision accepted by the command, suitable for saving. */
  readonly document: Protocol.DocumentOutput;
  /** Changed cells still present after the command, suitable for running. */
  readonly cells: readonly CellVersion[];
}
/** Fields to update, preserving unspecified values and configuration settings. */
export interface CellPatch {
  /** Replacement source; required when updating a cell whose source was withheld. */
  readonly code?: string;
  /** Replacement cell name. */
  readonly name?: string;
  /** Configuration fields to merge into the observed cell. */
  readonly config?: Partial<Protocol.CellConfigOutput>;
}
/** Placement of a newly created cell; omitted placement appends it. */
export interface Placement {
  /** Inserts before this cell; mutually exclusive with after. */
  readonly before?: Protocol.CellId;
  /** Inserts after this cell; mutually exclusive with before. */
  readonly after?: Protocol.CellId;
}
/** Changes collected and submitted together by {@link Interface.edit}. */
export interface Transaction {
  /** Updates an observed cell, or a cell created earlier in this transaction. */
  updateCell(cell: Protocol.CellOutput | Protocol.CellId, patch: CellPatch): void;
  /** Creates a cell and returns its ID before submission. An omitted ID is generated. */
  createCell(
    cell: Omit<Protocol.CellInput, "id"> & { readonly id?: Protocol.CellId },
    placement?: Placement,
  ): Protocol.CellId;
  /** Removes an observed cell, or a cell created earlier in this transaction. */
  deleteCell(cell: Protocol.CellOutput | Protocol.CellId): void;
  /** Reorders the complete document using the observed order's precondition. */
  setOrder(document: Protocol.DocumentOutput, order: readonly Protocol.CellId[]): void;
}
/** A synchronous edit callback. Retaining the transaction after return is invalid. */
export type Edit = (transaction: Transaction) => void;
type Method = Client["Notebook"][Exclude<keyof Client["Notebook"], "events">];
/** Native transport, decoding, protocol, or local command failure. */
export type CommandError =
  | Effect.Error<ReturnType<Method>>
  | ModelError
  | Protocol.ProblemOutput;
/** Failures that can prevent a notebook observation from staying synchronized. */
export type Error = CommandError | Sse.SseError | Sse.Retry;
/** Runtime startup choices supplied in response to a decision-required problem. */
export type StartOptions = Protocol.StartRuntimeRequest;
/** Cells to execute at their observed versions. */
export interface RunOptions {
  /** Cells to submit in order; the host applies its execution policy. */
  readonly cells: readonly CellVersion[];
}
/** Operations on a notebook's current runtime, valid across restarts. */
export interface Runtime {
  /** Starts a runtime, optionally answering host startup decisions. */
  readonly start: (
    options?: StartOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, CommandError>;
  /** Replaces the current runtime and clears its execution state. */
  readonly restart: () => Effect.Effect<Protocol.RuntimeOutput, CommandError>;
  /** Stops the current runtime. */
  readonly stop: () => Effect.Effect<Protocol.RuntimeOutput, CommandError>;
  /** Interrupts work executing in the runtime. */
  readonly interrupt: () => Effect.Effect<Protocol.RuntimeOutput, CommandError>;
  /** Submits cells at their supplied versions and returns the accepted run. */
  readonly run: (
    options: RunOptions,
  ) => Effect.Effect<Protocol.RunOutput, CommandError>;
  /** Executes scratch code without changing the document. */
  readonly execute: (options: {
    readonly code: string;
  }) => Effect.Effect<Protocol.RunOutput, CommandError>;
  /** Cancels one run, including its queued work. */
  readonly cancel: (options: {
    readonly runId: string;
  }) => Effect.Effect<Protocol.RunOutput, CommandError>;
  /** Answers a pending input request. */
  readonly reply: (options: {
    readonly inputId: string;
    readonly value: string;
  }) => Effect.Effect<Protocol.InputOutput, CommandError>;
}
/**
 * A scoped notebook observation and commands.
 *
 * A failed mutation retains its request identity for retries within the host's
 * configured retry window. Successful executions start fresh work when repeated.
 */
export interface Interface {
  /** Identity of the attached notebook. */
  readonly id: Protocol.NotebookOutput["id"];
  /** Synchronized state in the registry that acquired this notebook. */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<State, Error>>;
  /** Reuses a running kernel or waits up to 60 seconds for startup. */
  readonly ensureRunning: Effect.Effect<
    void,
    Error | import("effect").Cause.TimeoutError
  >;
  /**
   * Submits an atomic edit against the supplied cell versions.
   *
   * The callback runs for each new submission. After an uncertain failure,
   * retrying the Effect reuses that submission within the host's retry window.
   */
  readonly edit: (edit: Edit) => Effect.Effect<EditResult, CommandError>;
  /** Saves the observed revision; decisions answer a host's decision-required problem. */
  readonly save: (
    document: Protocol.DocumentOutput,
    options?: Protocol.SaveRequest,
  ) => Effect.Effect<EditResult, CommandError>;
  /** Commands targeting the current runtime. */
  readonly runtime: Runtime;
}
