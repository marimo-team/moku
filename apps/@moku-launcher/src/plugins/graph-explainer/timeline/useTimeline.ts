import * as React from "react";
import { advanceTimeline, timelineTickCount, type TimelineInput } from "./animation.ts";

function createTimeline(initial: TimelineInput) {
  let input = initial;
  let maxTicks = 2;
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let state = advanceTimeline(null, input, Date.now(), maxTicks, reduced);
  let animation = 0;
  const listeners = new Set<() => void>();
  const schedule = () => {
    if (!animation && listeners.size && state.moving) {
      animation = requestAnimationFrame(() => {
        animation = 0;
        update();
      });
    }
  };
  const update = () => {
    state = advanceTimeline(state, input, Date.now(), maxTicks, reduced);
    for (const listener of listeners) listener();
    schedule();
  };
  return {
    getSnapshot: () => state.frame,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      schedule();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          cancelAnimationFrame(animation);
          animation = 0;
        }
      };
    },
    setInput(value: TimelineInput) {
      input = value;
      update();
    },
    setWidth(width: number) {
      const count = timelineTickCount(width);
      if (count !== maxTicks) {
        maxTicks = count;
        update();
      }
    },
    setReduced(value: boolean) {
      reduced = value;
      update();
    },
  };
}

export function useTimeline(input: TimelineInput) {
  const [timeline] = React.useState(() => createTimeline(input));
  const [axis, setAxis] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => timeline.setInput(input), [timeline, input]);
  React.useLayoutEffect(() => {
    if (!axis) return;
    timeline.setWidth(axis.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) =>
      timeline.setWidth(entry.contentRect.width),
    );
    observer.observe(axis);
    return () => observer.disconnect();
  }, [timeline, axis]);
  React.useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => timeline.setReduced(media.matches);
    media.addEventListener("change", change);
    change();
    return () => media.removeEventListener("change", change);
  }, [timeline]);
  return {
    ...React.useSyncExternalStore(timeline.subscribe, timeline.getSnapshot),
    axisRef: setAxis,
  };
}
