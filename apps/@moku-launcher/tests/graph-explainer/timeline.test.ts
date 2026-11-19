import { Schema } from "effect";
import * as Protocol from "@moku/core/Protocol";
import * as NodeAssert from "node:assert/strict";
import * as Vitest from "vite-plus/test";
import { executionSpan } from "../../src/plugins/graph-explainer/execution.ts";
import {
  timelineDomain,
  timelineLabel,
  timelineFrame,
  updateTimelineScale,
} from "../../src/plugins/graph-explainer/timeline/scale.ts";
import {
  advanceTimeline,
  timelineTickCount,
  type TimelineInput,
} from "../../src/plugins/graph-explainer/timeline/animation.ts";

Vitest.test("completed timings stay fixed and queued executions have no span", () => {
  const execution = {
    started_at: Schema.decodeUnknownSync(Protocol.Timestamp)("2026-11-05T12:00:00Z"),
    completed_at: Schema.decodeUnknownSync(Protocol.Timestamp)("2026-11-05T12:00:01Z"),
  };
  NodeAssert.equal(
    executionSpan(execution, Date.parse("2026-11-05T13:00:00Z"))?.duration,
    1000,
  );
  NodeAssert.equal(
    executionSpan({ started_at: null, completed_at: null }, Date.now()),
    null,
  );
});

Vitest.test("zooming fades the old ticks and brings in the new endpoint", () => {
  const initial = updateTimelineScale(null, "run", 5000, 0);
  const zoom = updateTimelineScale(initial, "run", 10000, 1000);
  NodeAssert.equal(timelineFrame(zoom, 1000).extent, 5000);
  const middle = timelineFrame(zoom, 1200);
  NodeAssert.ok(middle.extent > 5000 && middle.extent < 10000);
  const fading = middle.ticks.find((tick) => tick.value === 1000);
  const incoming = middle.ticks.find((tick) => tick.value === 10000);
  NodeAssert.ok(fading && fading.opacity > 0 && fading.opacity < 1);
  NodeAssert.ok(incoming && incoming.opacity > 0 && incoming.opacity < 1);
  NodeAssert.equal(middle.ticks.find((tick) => tick.value === 5000)?.opacity, 1);
  NodeAssert.equal(timelineFrame(zoom, 1400).extent, 10000);
  NodeAssert.deepEqual(timelineFrame(zoom, 1400).ticks, [
    { value: 0, opacity: 1 },
    { value: 5000, opacity: 1 },
    { value: 10000, opacity: 1 },
  ]);
});

Vitest.test("completion never shrinks the scale, while a new run resets it", () => {
  const scale = updateTimelineScale(null, "first", 45000, 0);
  NodeAssert.equal(
    timelineFrame(
      updateTimelineScale(scale, "first", timelineDomain(30000, false), 500),
      500,
    ).extent,
    45000,
  );
  NodeAssert.equal(updateTimelineScale(scale, "second", 5000, 600).target, 5000);
  const reduced = updateTimelineScale(scale, "first", 60000, 600, true);
  NodeAssert.equal(timelineFrame(reduced, 600).extent, 60000);
});

Vitest.test("axis labels use units that match the duration", () => {
  NodeAssert.equal(timelineLabel(0), "0s");
  NodeAssert.equal(timelineLabel(0.2), "0ms");
  NodeAssert.equal(timelineLabel(20), "20ms");
  NodeAssert.equal(timelineLabel(2000), "2s");
  NodeAssert.equal(timelineLabel(60000), "1m");
  NodeAssert.equal(timelineLabel(90000), "1m 30s");
  NodeAssert.equal(timelineLabel(5400000), "1h 30m");
});

Vitest.test(
  "label density follows track width and avoids a crowded final interval",
  () => {
    const scale = updateTimelineScale(null, "run", 45000, 0);
    const labels = (width: number) =>
      timelineFrame(scale, 0, timelineTickCount(width)).ticks.map((tick) => tick.value);
    NodeAssert.deepEqual(labels(168), [0, 30000, 45000]);
    NodeAssert.deepEqual(labels(336), [0, 10000, 20000, 30000, 45000]);
  },
);

const running: TimelineInput = {
  runId: "r",
  start: 0,
  end: 0,
  live: true,
  following: true,
  spans: { cell: { start: 0, end: 0, open: true } },
};

Vitest.test(
  "completion corrects a bar's end smoothly without changing the reported duration",
  () => {
    const active = advanceTimeline(null, running, 1000);
    const completed: TimelineInput = {
      ...running,
      end: 800,
      live: false,
      following: false,
      spans: { cell: { start: 0, end: 800, open: false } },
    };
    const received = advanceTimeline(active, completed, 1016);
    NodeAssert.equal(received.frame.playhead, null);
    NodeAssert.equal(received.frame.rows.cell?.width, active.frame.rows.cell?.width);
    NodeAssert.equal(received.frame.rows.cell?.duration, 800);
    const halfway = advanceTimeline(received, completed, 1216);
    NodeAssert.ok(halfway.frame.end > 800 && halfway.frame.end < received.frame.end);
    const settled = advanceTimeline(halfway, completed, 1416);
    NodeAssert.equal(settled.frame.end, 800);
    NodeAssert.ok(settled.frame.rows.cell!.width < received.frame.rows.cell!.width);
    NodeAssert.equal(settled.moving, false);
  },
);

Vitest.test(
  "a paused animation clock catches up over 400ms and reduced motion snaps immediately",
  () => {
    const before = advanceTimeline(null, running, 1000);
    const afterPause = advanceTimeline(before, running, 6000);
    NodeAssert.equal(afterPause.frame.end, 1000);
    NodeAssert.equal(afterPause.frame.rows.cell?.width, before.frame.rows.cell?.width);
    let resumed = afterPause;
    for (let time = 6016; time <= 6400; time += 16)
      resumed = advanceTimeline(resumed, running, time);
    NodeAssert.equal(resumed.frame.end, 6400);
    NodeAssert.equal(resumed.frame.extent, 10000);
    const reduced = advanceTimeline(before, running, 6000, 6, true);
    NodeAssert.equal(reduced.frame.end, 6000);
    NodeAssert.equal(reduced.frame.extent, 10000);
    const nextRun = advanceTimeline(
      afterPause,
      { ...running, runId: "next", start: 7000, end: 7000, spans: {} },
      7000,
    );
    NodeAssert.equal(nextRun.frame.extent, 5000);
    NodeAssert.equal(nextRun.frame.end, 7000);
  },
);

Vitest.test(
  "new live timestamps grow a bar from its start instead of popping into place",
  () => {
    const empty = advanceTimeline(null, { ...running, spans: { cell: null } }, 1000);
    const arrived = advanceTimeline(
      empty,
      { ...running, spans: { cell: { start: 800, end: 800, open: true } } },
      1016,
    );
    NodeAssert.equal(arrived.frame.rows.cell?.width, 0);
    NodeAssert.equal(arrived.frame.rows.cell?.duration, 216);
    NodeAssert.equal(arrived.frame.rows.cell?.left, 16);
  },
);
