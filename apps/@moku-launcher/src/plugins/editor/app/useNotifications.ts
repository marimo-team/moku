import { Cause, Effect, Exit, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useAtomSet } from "@effect/atom-react";
import { useEffect, useRef } from "react";
import { runtime } from "./runtime.ts";
import * as Notifications from "./Notifications.ts";
import * as Problems from "../lib/problems.ts";

export const messagesAtom = runtime.atom(
  Stream.unwrap(Effect.map(Notifications.Service, (service) => service.changes)),
);
export const showAtom = runtime.fn(
  (message: Notifications.Message) =>
    Effect.flatMap(Notifications.Service, (service) => service.show(message)),
  { concurrent: true },
);
export const dismissAtom = runtime.fn(
  ({ id, revision }: { id: string; revision?: number }) =>
    Effect.flatMap(Notifications.Service, (service) => service.dismiss(id, revision)),
  { concurrent: true },
);

export const actionAtom = runtime.fn(
  (message: Notifications.Notification) =>
    Effect.gen(function* () {
      if (!message.action) return;
      const service = yield* Notifications.Service;
      const exit = yield* Effect.exit(message.action.run);
      if (Exit.isSuccess(exit)) {
        yield* service.dismiss(message.id, message.revision);
      } else if (
        (yield* service.current).some(
          (entry) => entry.id === message.id && entry.revision === message.revision,
        )
      ) {
        const problem = Problems.describe(Cause.squash(exit.cause));
        yield* service.show({
          ...message,
          kind: "error",
          description: problem.description,
          details: problem.details,
        });
      }
    }),
  { concurrent: true },
);

/** A view owns the lifetime; the service owns identity and presentation state. */
export function useNotification(
  message: Notifications.Message | null,
  id: string,
  trigger?: unknown,
) {
  const show = useAtomSet(showAtom);
  const dismiss = useAtomSet(dismissAtom);
  const latest = useRef(message);
  latest.current = message;
  const { title, description, details, kind, action } = message ?? {};
  useEffect(() => {
    if (!title || !kind) {
      dismiss({ id });
      return;
    }
    show({
      id,
      title,
      description,
      details,
      kind,
      action: action
        ? {
            label: action.label,
            run: Effect.suspend(() => latest.current?.action?.run ?? Effect.void),
          }
        : undefined,
    });
  }, [id, title, description, details, kind, action?.label, trigger, show, dismiss]);
  useEffect(() => () => dismiss({ id }), [id, dismiss]);
}

export function useFailureNotification<A, E>(
  result: AsyncResult.AsyncResult<A, E>,
  options: {
    id: string;
    title: string;
    action?: Notifications.Action;
    repeat?: boolean;
    suppressed?: boolean;
  },
) {
  const problem =
    AsyncResult.isFailure(result) && !options.suppressed
      ? Problems.describe(Cause.squash(result.cause))
      : null;
  useNotification(
    problem
      ? {
          ...options,
          kind: "error",
          description: problem.description,
          details: problem.details,
        }
      : null,
    options.id,
    options.repeat !== false && AsyncResult.isFailure(result)
      ? result.cause
      : undefined,
  );
}
