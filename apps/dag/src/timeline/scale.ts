const SCALE_STEPS = [
  [15_000, 5_000],
  [120_000, 15_000],
  [600_000, 60_000],
  [3_600_000, 300_000],
  [14_400_000, 900_000],
  [Infinity, 3_600_000],
] as const;
const TICK_STEPS = [
  5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 14_400_000, 21_600_000, 43_200_000, 86_400_000,
];
export const ANIMATION_MS = 400;

export function timelineDomain(span: number, live = true) {
  const padded = Math.max(0, span) * (live ? 1.25 : 1);
  const step = SCALE_STEPS.find(([limit]) => padded <= limit)![1];
  return Math.max(5_000, Math.ceil(padded / step) * step);
}

export function timelineTicks(extent: number, maxTicks = 6) {
  const step =
    extent < 6_000
      ? 1_000
      : (TICK_STEPS.find((step) => extent / step < maxTicks) ?? 86_400_000);
  const ticks = Array.from(
    { length: Math.floor(extent / step) + 1 },
    (_, index) => index * step,
  );
  const last = ticks.at(-1)!;
  if (last !== extent) {
    if (last > 0 && extent - last < extent / maxTicks) ticks.pop();
    ticks.push(extent);
  }
  return ticks;
}

export interface TimelineScale {
  runId: string;
  from: number;
  target: number;
  started: number;
  previousTarget: number;
}

export function timelineFrame(scale: TimelineScale, now: number, maxTicks = 6) {
  const progress = scale.from === scale.target ? 1 : easeOut(now - scale.started);
  const extent = scale.from + (scale.target - scale.from) * progress;
  const nextTicks = timelineTicks(scale.target, maxTicks);
  const previousTicks =
    progress < 1 ? timelineTicks(scale.previousTarget, maxTicks) : [];
  const ticks = [...new Set([...previousTicks, ...nextTicks])]
    .sort((a, b) => a - b)
    .flatMap((value) => {
      const percent = (value / extent) * 100;
      if (percent > 100 + 1e-9) {
        if (value !== scale.target || percent > 110) return [];
        return [{ value, opacity: Math.min(1, (110 - percent) / 10) }];
      }
      const wasVisible = previousTicks.includes(value);
      const willBeVisible = nextTicks.includes(value);
      let opacity = 1;
      if (previousTicks.length && !(wasVisible && willBeVisible)) {
        opacity = willBeVisible ? progress : 1 - progress;
      }
      return opacity > 0 ? [{ value, opacity }] : [];
    });
  return { extent, ticks };
}

export function updateTimelineScale(
  previous: TimelineScale | null,
  runId: string,
  desired: number,
  now: number,
  reduced = false,
): TimelineScale {
  if (!previous || previous.runId !== runId) {
    return {
      runId,
      from: desired,
      target: desired,
      started: now,
      previousTarget: desired,
    };
  }
  const target = Math.max(previous.target, desired);
  if (reduced) return { ...previous, from: target, target, previousTarget: target };
  if (target === previous.target) return previous;
  return {
    runId,
    from: timelineFrame(previous, now).extent,
    target,
    started: now,
    previousTarget: previous.target,
  };
}

export function easeOut(elapsed: number) {
  const progress = Math.min(1, Math.max(0, elapsed) / ANIMATION_MS);
  return 1 - (1 - progress) ** 3;
}

export function timelineLabel(milliseconds: number) {
  if (milliseconds < 1000)
    return `${Math.round(milliseconds)}${milliseconds === 0 ? "s" : "ms"}`;
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}
