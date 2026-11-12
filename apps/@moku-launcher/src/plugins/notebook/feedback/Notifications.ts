import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";

export interface Action {
  readonly label: string;
  readonly run: Effect.Effect<unknown, unknown>;
}

export interface Message {
  /** Stable within an operation or notebook; repeated reports replace it. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly details?: string;
  readonly kind: "info" | "success" | "error";
  readonly action?: Action;
}

export interface Notification extends Message {
  readonly revision: number;
}

export interface Interface {
  readonly changes: Stream.Stream<readonly Notification[]>;
  readonly current: Effect.Effect<readonly Notification[]>;
  readonly show: (message: Message) => Effect.Effect<void>;
  /** Revision prevents an old timer or action from dismissing a newer message. */
  readonly dismiss: (id: string, revision?: number) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@moku/notebook/Notifications",
) {}

const make = Effect.gen(function* () {
  const state = yield* SubscriptionRef.make<readonly Notification[]>([]);
  let revision = 0;
  return Service.of({
    changes: SubscriptionRef.changes(state),
    current: SubscriptionRef.get(state),
    show: (message) =>
      SubscriptionRef.update(state, (current) => {
        const next = { ...message, revision: ++revision };
        return current.some((entry) => entry.id === message.id)
          ? current.map((entry) => (entry.id === message.id ? next : entry))
          : [...current, next];
      }),
    dismiss: (id, revision) =>
      SubscriptionRef.update(state, (current) =>
        current.filter(
          (entry) =>
            entry.id !== id || (revision !== undefined && entry.revision !== revision),
        ),
      ),
  });
});

export const layer = Layer.effect(Service, make);
