import {
  ANIMATION_MS,
  timelineDomain,
  timelineFrame,
  updateTimelineScale,
  type TimelineScale,
} from "./scale.ts";

interface OffsetAnimation {
  offset: number;
  started: number;
}
interface RowAnimation {
  key: string | null;
  start: number;
  end: number;
  startOffset: OffsetAnimation;
  endOffset: OffsetAnimation;
}

export interface TimeSpan {
  start: number;
  end: number;
  open: boolean;
}
export interface BarFrame {
  left: number;
  width: number;
  duration: number;
  open: boolean;
}
export interface TimelineFrame {
  extent: number;
  ticks: { value: number; opacity: number }[];
  end: number;
  playhead: number | null;
  rows: Record<string, BarFrame | null>;
}

export interface TimelineInput {
  runId: string;
  start: number;
  end: number;
  live: boolean;
  following: boolean;
  spans: Record<string, TimeSpan | null>;
}

export interface TimelineState {
  now: number;
  rawEnd: number;
  endOffset: OffsetAnimation;
  scale: TimelineScale;
  animations: Record<string, RowAnimation>;
  moving: boolean;
  frame: TimelineFrame;
}

function offsetAt(animation: OffsetAnimation, now: number) {
  const remaining = 1 - Math.min(1, Math.max(0, now - animation.started) / ANIMATION_MS);
  return animation.offset * remaining ** 3;
}

export function timelineTickCount(width: number) {
  return Math.max(2, Math.floor(width / 56));
}

export function advanceTimeline(
  previous: TimelineState | null,
  input: TimelineInput,
  now: number,
  maxTicks = 6,
  reduced = false,
): TimelineState {
  const sameRun = previous?.scale.runId === input.runId;
  const rawEnd = input.following ? Math.max(now, input.end) : input.end;
  let endOffset = { offset: 0, started: now };
  if (sameRun && previous && !reduced) {
    const delta = rawEnd - previous.rawEnd;
    const frameElapsed = Math.min(100, Math.max(0, now - previous.now));
    endOffset =
      delta < 0 || delta > frameElapsed
        ? { offset: previous.frame.end - rawEnd, started: now }
        : previous.endOffset;
  }
  const end = rawEnd + offsetAt(endOffset, now);
  const scale = updateTimelineScale(
    previous?.scale ?? null,
    input.runId,
    timelineDomain(rawEnd - input.start, input.live),
    now,
    reduced,
  );
  const axis = timelineFrame(scale, now, maxTicks);
  const percent = (time: number) => ((time - input.start) / axis.extent) * 100;
  const animations: Record<string, RowAnimation> = {};
  const rows: TimelineFrame["rows"] = {};
  let moving =
    input.following ||
    offsetAt(endOffset, now) !== 0 ||
    (scale.from !== scale.target && now < scale.started + ANIMATION_MS);
  for (const [id, span] of Object.entries(input.spans)) {
    const old = sameRun ? previous?.animations[id] : undefined;
    const row = animateRow(old, span, end, now, input.live, reduced);
    animations[id] = row;
    const finish = span?.open ? end : (span?.end ?? 0);

    rows[id] = span
      ? {
          left: percent(row.start),
          width: Math.max(0, percent(row.end) - percent(row.start)),
          duration: Math.max(0, finish - span.start),
          open: span.open,
        }
      : null;
    moving ||= offsetAt(row.startOffset, now) !== 0 || offsetAt(row.endOffset, now) !== 0;
  }
  return {
    now,
    rawEnd,
    endOffset,
    scale,
    animations,
    moving,
    frame: {
      ...axis,
      end,
      rows,
      playhead: input.following ? percent(end) : null,
    },
  };
}

function animateRow(
  old: RowAnimation | undefined,
  span: TimeSpan | null,
  end: number,
  now: number,
  live: boolean,
  reduced: boolean,
): RowAnimation {
  const key = span ? `${span.start}:${span.open ? "open" : span.end}` : null;
  const start = span?.start ?? 0;
  const finish = span ? (span.open ? end : span.end) : 0;
  const zero = { offset: 0, started: now };
  let startOffset = zero,
    endOffsetForRow = zero;
  if (old && !reduced && key !== null) {
    if (key === old.key) {
      startOffset = old.startOffset;
      endOffsetForRow = old.endOffset;
    } else if (old.key !== null) {
      startOffset = { offset: old.start - start, started: now };
      endOffsetForRow = { offset: old.end - finish, started: now };
    } else if (live) {
      endOffsetForRow = { offset: start - finish, started: now };
    }
  }
  const displayedStart = start + offsetAt(startOffset, now);
  const displayedEnd = finish + offsetAt(endOffsetForRow, now);
  return {
    key,
    start: displayedStart,
    end: displayedEnd,
    startOffset,
    endOffset: endOffsetForRow,
  };
}
