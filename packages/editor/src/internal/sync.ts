import * as Protocol from "@momo/model/Protocol";
import { Clock, Data, Deferred, Effect, Exit, Option, Queue, type Scope } from "effect";
import { Atom, type AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@momo/model/Notebook";
import { RequestError } from "@momo/model";
import type { Confirmed } from "@momo/model/Notebook";
import * as Draft from "./draft.ts";
import type * as State from "./state.ts";

export class SyncError extends Data.TaggedError("DocumentSyncError")<{
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

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
    const status = Atom.make<SyncStatus>({ status: "idle" });
    const unmount = registry.mount(status);
    const waiters = new Set<Deferred.Deferred<Confirmed, SyncError>>();
    let closed = false;
    let retryRequested = false;
    let failure: SyncError | undefined;
    let active:
      | {
          submission: State.Submission;
          key: string;
          startedAt: number;
          response?: Protocol.DocumentOutput;
          rejection?: Protocol.ProblemOutput;
        }
      | undefined;
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
        if (!active) {
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
          active = {
            submission,
            key: crypto.randomUUID(),
            startedAt: yield* Clock.currentTimeMillis,
          };
        }
        const request = active;
        if (!request.response) {
          registry.set(status, { status: "sending" });
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
              .edit(request.submission.request, request.key)
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
              request.response = result.success.document;
              model.settle(request.submission, request.response);
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
              if (problem.success) request.rejection = problem.data;
            }
            if (request.rejection || attempt === 2) {
              return yield* Effect.fail(
                new SyncError({
                  message: request.rejection
                    ? `${request.rejection.detail ?? request.rejection.title} Your draft is retained.`
                    : "Could not confirm the edit. Your draft is retained.",
                  retryable: true,
                  cause,
                }),
              );
            }
            yield* Effect.sleep(250 * 2 ** attempt);
          }
        }
        registry.set(status, { status: "confirming" });
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
        active = undefined;
      }
    });

    const retry = Effect.gen(function* () {
      if (failure && !failure.retryable) return yield* Effect.fail(failure);
      if (active?.rejection) {
        const source = model.get().source.document;
        const rejectedAt =
          active.rejection.type === "urn:marimo:problem:precondition-failed"
            ? active.rejection.document.version
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
        model.settle(active.submission, null);
        active = undefined;
      }
      failure = undefined;
    });

    const cycle = Effect.gen(function* () {
      yield* Queue.take(wake);
      if (!retryRequested && failure) return;
      if (!retryRequested && waiters.size === 0) {
        if (Draft.isEmptyDraft(model.get().draft) && !active) {
          registry.set(status, {
            status: model.get().source.document ? "idle" : "unavailable",
          });
          return;
        }
        registry.set(status, { status: "pending" });
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
        failure = undefined;
        registry.set(status, { status: "idle" });
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
        failure = error;
        registry.set(status, { status: "error", error });
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
        if (failure && !retry) return yield* Effect.fail(failure);
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
