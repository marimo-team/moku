/** Scoped Effect playback for a reversible React illustration. @module */
import { Effect, Stream } from "effect";
import * as React from "react";
import * as Playback from "./Playback.ts";
import * as Connection from "./connection.ts";

const animationFrame = Effect.callback<number>((resume) => {
  const handle = requestAnimationFrame((time) => resume(Effect.succeed(time)));
  return Effect.sync(() => cancelAnimationFrame(handle));
});

/** React subscribes to the model; unmounting cancels its animation and subscription. */
export function usePlayback() {
  const [frame, setFrame] = React.useState(Playback.initial);
  const controller = React.useRef<Playback.Playback | null>(null);

  React.useEffect(() => {
    const cancel = Effect.runCallback(
      Effect.scoped(
        Effect.gen(function* () {
          const playback = yield* Playback.make(animationFrame);
          controller.current = playback;
          yield* Stream.runForEach(playback.changes, (value) =>
            Effect.sync(() => setFrame(value)),
          );
        }),
      ),
    );
    return () => {
      controller.current = null;
      cancel();
    };
  }, [Connection.steps]);

  const run = (action: (playback: Playback.Playback) => Effect.Effect<void>) => {
    if (controller.current) Effect.runFork(action(controller.current));
  };
  return {
    ...frame,
    play: () => run((model) => model.play),
    next: () => run((model) => model.next),
    pause: () => run((model) => model.pause),
    seek: (position: number) => run((model) => model.seek(position)),
    setSpeed: (speed: Playback.Speed) => run((model) => model.setSpeed(speed)),
  };
}
