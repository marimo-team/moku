import { Effect, Stream } from "effect";
import * as Vitest from "vite-plus/test";
import * as Playback from "../src/Playback.ts";
import * as Connection from "../src/connection.ts";

Vitest.test(
  "play pauses before delivery, then continues over the same connection",
  async () => {
    let time = 0;
    const clock = Effect.gen(function* () {
      yield* Effect.yieldNow;
      time += 80;
      return time;
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const player = yield* Playback.make(clock);
          yield* player.play;
          yield* player.changes.pipe(
            Stream.filter((frame) => !frame.running),
            Stream.runHead,
          );
          const paused = yield* player.current;
          const scene = Connection.sceneAt(paused.position);
          Vitest.expect(scene.step.breakpoint).toBe(true);
          Vitest.expect(scene.hostLoaded).toBe(true);
          Vitest.expect(scene.received).toHaveLength(0);
          yield* player.play;
          yield* player.changes.pipe(
            Stream.filter((frame) => !frame.running),
            Stream.runHead,
          );
          Vitest.expect(
            Connection.sceneAt((yield* player.current).position).ready,
          ).toBe(true);
          yield* player.seek(0.5);
          Vitest.expect(yield* player.current).toEqual({
            position: 0.5,
            running: false,
            speed: 1,
          });
          Vitest.expect(
            Connection.sceneAt((yield* player.current).position).hostRecords,
          ).toEqual([]);
        }),
      ),
    );
  },
);

Vitest.test.each(["pause", "seek", "unmount"] as const)(
  "%s cancels a pending animation frame",
  async (action) => {
    let pending = 0;
    const nextFrame = Effect.callback<number>(() => {
      pending++;
      return Effect.sync(() => {
        pending--;
      });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const player = yield* Playback.make(nextFrame);
          yield* player.play;
          yield* Effect.yieldNow;
          Vitest.expect(pending).toBe(1);
          if (action === "pause") yield* player.pause;
          if (action === "seek") yield* player.seek(1.5);
          if (action !== "unmount") {
            Vitest.expect(pending).toBe(0);
            Vitest.expect((yield* player.current).running).toBe(false);
          }
        }),
      ),
    );
    Vitest.expect(pending).toBe(0);
  },
);

Vitest.test(
  "speed changes affect the next frame without restarting playback",
  async () => {
    let tick: ((time: number) => void) | undefined;
    const clock = Effect.callback<number>((resume) => {
      tick = (time) => resume(Effect.succeed(time));
      return Effect.sync(() => {
        tick = undefined;
      });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const player = yield* Playback.make(clock);
          yield* player.play;
          yield* Effect.yieldNow;
          tick?.(0);
          yield* Effect.yieldNow;
          tick?.(60);
          yield* Effect.yieldNow;
          const normal = yield* player.current;
          Vitest.expect(normal.position).toBeCloseTo(0.04);
          yield* player.setSpeed(2);
          Vitest.expect(yield* player.current).toEqual({ ...normal, speed: 2 });
          tick?.(120);
          yield* Effect.yieldNow;
          const faster = yield* player.current;
          Vitest.expect(faster.position - normal.position).toBeCloseTo(0.08);
          Vitest.expect(faster.running).toBe(true);
          yield* player.setSpeed(0.25);
          tick?.(180);
          yield* Effect.yieldNow;
          Vitest.expect((yield* player.current).position - faster.position).toBeCloseTo(
            0.01,
          );
          yield* player.seek(0);
          Vitest.expect(yield* player.current).toEqual({
            position: 0,
            running: false,
            speed: 0.25,
          });
        }),
      ),
    );
  },
);
