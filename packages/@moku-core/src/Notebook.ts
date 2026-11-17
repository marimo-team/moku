/** Observe and edit a notebook acquired with Host.notebooks.attach. @module */
import { Schema, type Effect } from "effect";
import type { AsyncResult, Atom } from "effect/reactivity";
import type * as Comm from "./experimental/Comm.ts";
import * as Protocol from "./Protocol.ts";
import type { Client } from "./internal/client.ts";
import { ModelError } from "./internal/client.ts";
import type { Sse } from "effect/encoding";
export { ModelError, isRejection } from "./internal/client.ts";

/** A coherent document revision with its cells in display order. */
export type Document = typeof Protocol.Document.Type & {
  /** Cells belonging to this revision, in display order. */
  readonly cells: readonly (typeof Protocol.Cell.Type)[];
};
/** The synchronized notebook and its retained activity. */
export interface State {
  /** Metadata and permitted operations, or null after removal. */
  readonly notebook: typeof Protocol.Notebook.Type | null;
  /** The latest complete source revision, or null when source is unavailable. */
  readonly document: Document | null;
  /** The attached runtime, or null when none exists. */
  readonly runtime: typeof Protocol.Runtime.Type | null;
  /** Dependency analysis for the published document, or null while unavailable. */
  readonly analysis: typeof Protocol.Analysis.Type | null;
  /** Retained runs indexed by ID. */
  readonly runs: Readonly<Record<string, typeof Protocol.Run.Type>>;
  /** Retained cell and scratch executions indexed by ID. */
  readonly executions: Readonly<Record<string, typeof Protocol.Execution.Type>>;
  /** Console chunks indexed by ID and associated with an execution. */
  readonly consoles: Readonly<Record<string, typeof Protocol.Console.Type>>;
  /** Display records indexed by ID and associated with an execution. */
  readonly displays: Readonly<Record<string, typeof Protocol.Display.Type>>;
  /** Variables currently reported by the runtime. */
  readonly variables: Readonly<Record<string, typeof Protocol.Variable.Type>>;
  /** Input requests indexed by ID, including pending replies. */
  readonly inputs: Readonly<Record<string, typeof Protocol.Input.Type>>;
}
/** A cell version accepted by the host, usable in a subsequent run. */
export interface CellVersion {
  /** The notebook that owns this cell version. */
  readonly notebook_id: (typeof Protocol.Notebook.Type)["id"];
  /** The cell to execute. */
  readonly id: typeof Protocol.CellId.Type;
  /** The cell version the host must still hold. */
  readonly etag: (typeof Protocol.Cell.Type)["etag"];
}
/** The document revision and surviving cells changed by an edit or save. */
export interface EditResult {
  /** The revision accepted by the command, suitable for saving. */
  readonly document: typeof Protocol.Document.Type;
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
  readonly config?: Partial<typeof Protocol.CellConfig.Type>;
}
/** Placement of a newly created cell; omitted placement appends it. */
export interface Placement {
  /** Inserts before this cell; mutually exclusive with after. */
  readonly before?: typeof Protocol.CellId.Type;
  /** Inserts after this cell; mutually exclusive with before. */
  readonly after?: typeof Protocol.CellId.Type;
}
/** Changes collected and submitted together by {@link Interface.edit}. */
export interface Transaction {
  /** Updates an observed cell, or a cell created earlier in this transaction. */
  update(
    cell: typeof Protocol.Cell.Type | typeof Protocol.CellId.Type,
    patch: CellPatch,
  ): void;
  /** Creates a cell and returns its ID before submission. An omitted ID is generated. */
  insert(
    cell: Omit<typeof Protocol.CellInput.Type, "id"> & {
      readonly id?: typeof Protocol.CellId.Type;
    },
    placement?: Placement,
  ): typeof Protocol.CellId.Type;
  /** Removes an observed cell, or a cell created earlier in this transaction. */
  remove(cell: typeof Protocol.Cell.Type | typeof Protocol.CellId.Type): void;
  /** Reorders the complete document using the observed order's precondition. */
  reorder(
    document: typeof Protocol.Document.Type,
    order: readonly (typeof Protocol.CellId.Type)[],
  ): void;
}
/** A synchronous edit callback. Retaining the transaction after return is invalid. */
export type Edit = (transaction: Transaction) => void;
type Method = Client["Notebook"][Exclude<keyof Client["Notebook"], "events">];
/** Transport, decoding, protocol, or local command failure. */
export type CommandError =
  | Effect.Error<ReturnType<Method>>
  | ModelError
  | typeof Protocol.Problem.Type;
/** Failures that can prevent a notebook observation from staying synchronized. */
export type Error = CommandError | Sse.SseError | Sse.Retry;
/** Runtime startup choices supplied in response to a decision-required problem. */
export type StartOptions = typeof Protocol.StartRuntimeRequest.Type;
/** Cells to execute at their observed versions. */
export interface RunOptions {
  /** Cells to submit in order; the host applies its execution policy. */
  readonly cells: readonly CellVersion[];
}
/** Operations on a notebook's current runtime, valid across restarts. */
export interface Runtime {
  /** Temporary access for the output renderer until it can read widget state directly. @internal */
  readonly experimentalComm: Comm.Interface;
  /** Starts a runtime, optionally answering host startup decisions. */
  readonly start: (
    options?: StartOptions,
  ) => Effect.Effect<typeof Protocol.Runtime.Type, CommandError>;
  /** Replaces the current runtime and clears its execution state. */
  readonly restart: () => Effect.Effect<typeof Protocol.Runtime.Type, CommandError>;
  /** Stops the current runtime. */
  readonly stop: () => Effect.Effect<typeof Protocol.Runtime.Type, CommandError>;
  /** Interrupts work executing in the runtime. */
  readonly interrupt: () => Effect.Effect<typeof Protocol.Runtime.Type, CommandError>;
  /** Submits cells at their supplied versions and returns the accepted run. */
  readonly run: (
    options: RunOptions,
  ) => Effect.Effect<typeof Protocol.Run.Type, CommandError>;
  /** Executes scratch code without changing the document. */
  readonly execute: (options: {
    readonly code: string;
  }) => Effect.Effect<typeof Protocol.Run.Type, CommandError>;
  /** Cancels one run, including its queued work. */
  readonly cancel: (options: {
    readonly runId: string;
  }) => Effect.Effect<typeof Protocol.Run.Type, CommandError>;
  /** Answers a pending input request. */
  readonly reply: (options: {
    readonly inputId: string;
    readonly value: string;
  }) => Effect.Effect<typeof Protocol.Input.Type, CommandError>;
}
/**
 * A scoped notebook observation and commands.
 *
 * After a transport or server failure, repeat the same Effect to retry its request
 * within the host's retry window. Success or rejection ends that request, so
 * repeating the Effect then submits new work.
 */
export interface Interface {
  /** Identity of the attached notebook. */
  readonly id: (typeof Protocol.Notebook.Type)["id"];
  /** Synchronized state in the registry that acquired this notebook. */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<State, Error>>;
  /**
   * Reuses a running runtime or starts one and waits up to 60 seconds.
   *
   * An uncertain startup retains its request key for retry. Once a running runtime
   * is confirmed, a later call can start fresh work if that runtime has stopped.
   */
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
    document: typeof Protocol.Document.Type,
    options?: typeof Protocol.SaveRequest.Type,
  ) => Effect.Effect<EditResult, CommandError>;
  /** Commands targeting the current runtime. */
  readonly runtime: Runtime;
}

const indexes = new WeakMap<Document, ReadonlyMap<string, typeof Protocol.Cell.Type>>();

/** Returns the cell lookup shared by readers of this immutable document revision. */
export function cellIndex(
  document: Document,
): ReadonlyMap<string, typeof Protocol.Cell.Type> {
  let cells = indexes.get(document);
  if (!cells) {
    cells = new Map(document.cells.map((cell) => [cell.id, cell]));
    indexes.set(document, cells);
  }
  return cells;
}

/**
 * Creates a cell ID that the caller has not reserved.
 *
 * Include deleted and pending cells in the reservation check when their identities
 * must not be reused. Throws {@link ModelError} if 100 candidates collide.
 */
export function createCellId(
  reserved: (id: string) => boolean,
): typeof Protocol.CellId.Type {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = Array.from(
      crypto.getRandomValues(new Uint8Array(4)),
      (byte) => alphabet[byte % alphabet.length],
    ).join("");
    if (!reserved(id)) return Schema.decodeUnknownSync(Protocol.CellId)(id);
  }
  throw new ModelError({
    reason: "invalid-edit",
    message: "Could not generate a unique cell ID.",
  });
}
