/**
 * Synchronize drafts with bounded retries and confirmation from the notebook stream.
 *
 * @module
 */
import * as Protocol from "@moku/core/Protocol";
import { Clock, Data, Deferred, Effect, Exit, Option, Queue, type Scope } from "effect";
import { Atom, type AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import { RequestError } from "@moku/core";
import type { Confirmed } from "@moku/core/Notebook";
import * as Draft from "./draft.ts";
import type * as State from "./state.ts";

/**
 * A synchronization failure, with whether retrying may succeed.
 */
export class SyncError extends Data.TaggedError("DocumentSyncError")<{
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

/**
 * The document's progress from local edits to host confirmation.
 *
 * `pending` waits for the debounce interval; `sending` waits for the request;
 * `confirming` waits for the stream to reach the accepted revision.
 * A confirmation timeout reports an error that clears when confirmation arrives.
 * `unavailable` means source or edit permission is missing.
 */
export type SyncStatus =
  | {
      readonly status: "idle" | "pending" | "sending" | "confirming" | "unavailable";
    }
  | { readonly status: "error"; readonly error: SyncError };

export interface Interface {
  readonly status: Atom.Atom<SyncStatus>;
  readonly flush: Effect.Effect<Confirmed, SyncError>;
  readonly retry: Effect.Effect<Confirmed, SyncError>;
}

interface Request {
  readonly submission: State.Submission;
  readonly key: string;
  readonly startedAt: number;
}

/** An accepted request only waits for the stream; it must never be sent again. */
type Progress =
  | { readonly kind: "idle" | "pending" | "unavailable" }
  | { readonly kind: "sending"; readonly request: Request }
  | { readonly kind: "uncertain"; readonly request: Request; readonly error: SyncError }
  | {
      readonly kind: "rejected";
      readonly request: Request;
      readonly problem: Protocol.ProblemOutput;
      readonly error: SyncError;
    }
  | { readonly kind: "confirming" }
  | { readonly kind: "confirmation-delayed" | "failed"; readonly error: SyncError };

function withFailure(progress: Progress, error: SyncError): Progress {
  switch (progress.kind) {
    case "sending":
      return { kind: "uncertain", request: progress.request, error };
    case "confirming":
      return { kind: "confirmation-delayed", error };
    case "uncertain":
    case "rejected":
    case "confirmation-delayed":
    case "failed":
      return { ...progress, error };
    default:
      return { kind: "failed", error };
  }
}

// Keep retries of uncertain writes bounded, preserving the same request and key.
const retryWindow = 60_000;
const stopped = () =>
  new SyncError({ message: "The document is closed.", retryable: false });

export function synchronize(
  model: State.Interface,
  registry: AtomRegistry.AtomRegistry,
  notebook: Notebook.Interface,
): Effect.Effect<Interface, never, Scope.Scope> {
  return Effect.gen(function* () {
    const wake = yield* Queue.dropping<void>(1);
    const progress = Atom.make<Progress>({ kind: "idle" });
    const unmount = registry.mount(progress);
    const status = Atom.readable((get): SyncStatus => {
      const current = get(progress);
      return "error" in current
        ? { status: "error", error: current.error }
        : { status: current.kind };
    });
    const setProgress = (next: Progress) => registry.set(progress, next);
    const waiters = new Set<Deferred.Deferred<Confirmed, SyncError>>();
    let closed = false;
    let retryRequested = false;
    const recoverConfirmation = () => {
      if (
        registry.get(progress).kind === "confirmation-delayed" &&
        model.get().pending === null
      ) {
        setProgress({ kind: "idle" });
      }
    };
    const notify = () => {
      Queue.offerUnsafe(wake, undefined);
    };
    const unsubscribe = registry.subscribe(model.state, notify);

    const confirm = Effect.callback<void>((resume) => {
      const check = () => {
        if (model.get().pending === null) resume(Effect.void);
      };
      const stop = registry.subscribe(model.state, check);
      check();
      return Effect.sync(stop);
    });

    const drain = Effect.gen(function* () {
      while (true) {
        const current = model.get();
        const phase = registry.get(progress);
        if ("error" in phase) return yield* Effect.fail(phase.error);
        if (phase.kind !== "sending" && phase.kind !== "confirming") {
          if (!current.source.document) {
            return yield* Effect.fail(
              new SyncError({
                message: "Waiting for the host's document. Your draft is retained.",
                retryable: true,
              }),
            );
          }
          if (Draft.isEmptyDraft(current.draft)) return current.source.document;
          if (!current.source.canEdit) {
            return yield* Effect.fail(
              new SyncError({
                message: "This host is not accepting edits. Your draft is retained.",
                retryable: true,
              }),
            );
          }
          const submission = model.capture();
          if (!submission) {
            if (Draft.isEmptyDraft(model.get().draft)) return current.source.document;
            return yield* Effect.fail(
              new SyncError({
                message:
                  "A locally edited cell is unavailable on the host. Your draft is retained.",
                retryable: true,
              }),
            );
          }
          setProgress({
            kind: "sending",
            request: {
              submission,
              key: crypto.randomUUID(),
              startedAt: yield* Clock.currentTimeMillis,
            },
          });
        }
        const sending = registry.get(progress);
        if (sending.kind === "sending") {
          const request = sending.request;
          for (let attempt = 0; ; attempt++) {
            if ((yield* Clock.currentTimeMillis) - request.startedAt >= retryWindow) {
              return yield* Effect.fail(
                new SyncError({
                  message:
                    "The edit's outcome is unknown and its safe retry window has expired. Your draft is retained.",
                  retryable: false,
                }),
              );
            }
            const result = yield* notebook
              .edit({ request: request.submission.request, requestId: request.key })
              .pipe(Effect.timeout("10 seconds"), Effect.result);
            if (result._tag === "Success") {
              if (result.success.document.notebook_id !== notebook.target.notebookId) {
                return yield* Effect.fail(
                  new SyncError({
                    message: "The host returned a document for another notebook.",
                    retryable: false,
                  }),
                );
              }
              setProgress({ kind: "confirming" });
              model.settle(request.submission, result.success.document);
              break;
            }
            const cause = result.failure;
            if (
              cause instanceof RequestError &&
              cause.status !== undefined &&
              cause.status >= 400 &&
              cause.status < 500
            ) {
              const problem = Protocol.Problem.safeParse(cause.problem);
              if (problem.success) {
                const error = new SyncError({
                  message: `${problem.data.detail ?? problem.data.title} Your draft is retained.`,
                  retryable: true,
                  cause,
                });
                setProgress({
                  kind: "rejected",
                  request,
                  problem: problem.data,
                  error,
                });
                return yield* Effect.fail(error);
              }
            }
            if (attempt === 2) {
              return yield* Effect.fail(
                new SyncError({
                  message: "Could not confirm the edit. Your draft is retained.",
                  retryable: true,
                  cause,
                }),
              );
            }
            yield* Effect.sleep(250 * 2 ** attempt);
          }
        }
        yield* confirm.pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError(
            () =>
              new SyncError({
                message: "The host accepted the edit; waiting for its document stream.",
                retryable: true,
              }),
          ),
        );
        setProgress({ kind: "idle" });
      }
    });

    const retry = Effect.gen(function* () {
      const current = registry.get(progress);
      if ("error" in current && !current.error.retryable)
        return yield* Effect.fail(current.error);
      if (current.kind === "rejected") {
        const source = model.get().source.document;
        const rejectedAt =
          current.problem.type === "urn:marimo:problem:precondition-failed"
            ? current.problem.document.version
            : undefined;
        if (
          !source ||
          (rejectedAt !== undefined && source.revision.version < rejectedAt)
        ) {
          return yield* Effect.fail(
            new SyncError({
              message: "Wait for the host's current document before retrying.",
              retryable: true,
            }),
          );
        }
        model.settle(current.request.submission, null);
        setProgress({ kind: "idle" });
      } else if (current.kind === "uncertain") {
        setProgress({ kind: "sending", request: current.request });
      } else if (current.kind === "confirmation-delayed") {
        setProgress({ kind: "confirming" });
      } else if (current.kind === "failed") {
        setProgress({ kind: "idle" });
      }
    });

    const cycle = Effect.gen(function* () {
      yield* Queue.take(wake);
      recoverConfirmation();
      if (!retryRequested && "error" in registry.get(progress)) return;
      if (!retryRequested && waiters.size === 0) {
        if (Draft.isEmptyDraft(model.get().draft)) {
          setProgress({
            kind: model.get().source.document ? "idle" : "unavailable",
          });
          return;
        }
        setProgress({ kind: "pending" });
        while (waiters.size === 0) {
          const changed = yield* Queue.take(wake).pipe(
            Effect.timeoutOption("400 millis"),
          );
          if (Option.isNone(changed)) break;
        }
      }
      const result = yield* Effect.exit(
        Effect.gen(function* () {
          if (retryRequested) {
            retryRequested = false;
            yield* retry;
          }
          return yield* drain;
        }),
      );
      if (Exit.isSuccess(result)) {
        setProgress({ kind: "idle" });
      } else {
        // Preserve interruption semantics; the scope's finalizer releases joiners.
        if (Exit.hasInterrupts(result)) return yield* result;
        const error = Option.getOrElse(
          Exit.findErrorOption(result),
          () =>
            new SyncError({
              message: "Document synchronization failed. Your draft is retained.",
              retryable: false,
              cause: result.cause,
            }),
        );
        setProgress(withFailure(registry.get(progress), error));
      }
      const completed = [...waiters];
      waiters.clear();
      for (const waiter of completed) yield* Deferred.done(waiter, result);
    });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        unsubscribe();
        unmount();
        for (const waiter of waiters) yield* Deferred.fail(waiter, stopped());
        waiters.clear();
      }),
    );
    yield* cycle.pipe(Effect.forever, Effect.forkScoped);
    notify();

    const request = (retry: boolean) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.fail(stopped());
        recoverConfirmation();
        const current = registry.get(progress);
        if ("error" in current && !retry) return yield* Effect.fail(current.error);
        const waiter = yield* Deferred.make<Confirmed, SyncError>();
        waiters.add(waiter);
        retryRequested ||= retry;
        notify();
        // A caller's cancellation does not cancel an uncertain host write.
        return yield* Deferred.await(waiter).pipe(
          Effect.ensuring(Effect.sync(() => waiters.delete(waiter))),
        );
      });
    return { status, flush: request(false), retry: request(true) };
  });
}
