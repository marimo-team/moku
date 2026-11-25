/** Interruptible playback with deterministic seeking and authored breakpoints. @module */
import { Effect, Fiber, Semaphore, Stream, SubscriptionRef } from "effect";
import * as Connection from "./connection.ts";

/** Playback multipliers offered by the lesson controls. */
export const speeds = [0.25, 0.5, 1, 2] as const;

/** A supported playback multiplier. */
export type Speed = (typeof speeds)[number];

/** Current timeline position; fractional positions hold a handoff in flight. */
export interface Frame {
  readonly position: number;
  readonly running: boolean;
  /** Multiplier applied to subsequent animation frames. */
  readonly speed: Speed;
}

/** The disconnected starting point. */
export const initial: Frame = { position: 0, running: false, speed: 1 };

/** Playback controls own time without knowing how the scene is rendered. */
export interface Playback {
  /** Emits the current frame immediately, then every change. */
  readonly changes: Stream.Stream<Frame>;
  /** Reads the current frame for non-React consumers. */
  readonly current: Effect.Effect<Frame>;
  /** Advances to the next breakpoint, or restarts a completed lesson. */
  readonly play: Effect.Effect<void>;
  /** Advances to the next integer stop. */
  readonly next: Effect.Effect<void>;
  /** Interrupts playback at its current fractional position. */
  readonly pause: Effect.Effect<void>;
  /** Stops playback and reconstructs state at a clamped position. */
  readonly seek: (position: number) => Effect.Effect<void>;
  /** Changes speed without pausing or moving the playhead. Persists across replay. */
  readonly setSpeed: (speed: Speed) => Effect.Effect<void>;
}

/** Creates a player whose animation fiber lives only as long as its scope. */
export const make = Effect.fnUntraced(function* (nextFrame: Effect.Effect<number>) {
  const scope = yield* Effect.scope;
  const state = yield* SubscriptionRef.make(initial);
  const lock = yield* Semaphore.make(1);
  let animation: Fiber.Fiber<void> | undefined;
  let closed = false;
  const last = Connection.steps.length - 1;

  const stop = Effect.gen(function* () {
    if (animation) yield* Fiber.interrupt(animation);
    animation = undefined;
    yield* SubscriptionRef.update(state, (frame) => ({ ...frame, running: false }));
  });

  const advance = Effect.fnUntraced(function* (single: boolean) {
    if (closed) return;
    yield* stop;
    const frame = yield* SubscriptionRef.get(state);
    const start = frame.position === last && !single ? 0 : frame.position;
    const breakpoint = Connection.steps.findIndex(
      (step, index) => index > start && step.breakpoint,
    );
    const end = single
      ? Math.min(Math.floor(start) + 1, last)
      : breakpoint < 0
        ? last
        : breakpoint;
    if (start === end) return;
    yield* SubscriptionRef.update(state, (frame) => ({
      ...frame,
      position: start,
      running: true,
    }));
    animation = yield* Effect.gen(function* () {
      let previous = yield* nextFrame;
      let position = start;
      while (position < end) {
        const time = yield* nextFrame;
        // A background tab must not skip an entire explanation when it returns.
        const elapsed = Math.max(0, Math.min(time - previous, 80));
        previous = time;
        const { speed } = yield* SubscriptionRef.get(state);
        position = Math.min(end, position + (elapsed * speed) / 1500);
        yield* SubscriptionRef.update(state, (frame) => ({
          ...frame,
          position,
          running: position < end,
        }));
      }
    }).pipe(Effect.forkIn(scope));
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );

  return {
    changes: SubscriptionRef.changes(state),
    current: SubscriptionRef.get(state),
    play: lock.withPermit(advance(false)),
    next: lock.withPermit(advance(true)),
    pause: lock.withPermit(stop),
    setSpeed: (speed: Speed) =>
      SubscriptionRef.update(state, (frame) => ({ ...frame, speed })),
    seek: (position: number) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* stop;
          if (closed) return;
          yield* SubscriptionRef.update(state, (frame) => ({
            ...frame,
            position: Number.isFinite(position)
              ? Math.max(0, Math.min(last, position))
              : 0,
            running: false,
          }));
        }),
      ),
  } satisfies Playback;
});
