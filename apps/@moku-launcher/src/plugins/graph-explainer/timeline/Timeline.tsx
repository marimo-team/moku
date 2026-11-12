/** Shared axis, execution bars, and playhead for the graph timeline. @module */
import type { Ref } from "react";
import { duration } from "../execution.ts";
import type { BarFrame, TimelineFrame } from "./animation.ts";
import { timelineLabel } from "./scale.ts";

export function Axis({
  frame,
  axisRef,
}: {
  frame: TimelineFrame;
  axisRef: Ref<HTMLDivElement>;
}) {
  return (
    <div className="axis" ref={axisRef}>
      {frame.ticks.map((tick) => (
        <span
          key={tick.value}
          style={{
            left: `${(tick.value / frame.extent) * 100}%`,
            opacity: tick.opacity,
          }}
        >
          {timelineLabel(tick.value)}
        </span>
      ))}
    </div>
  );
}

export function Bar({
  frame,
  timing,
  status,
}: {
  frame: TimelineFrame;
  timing: BarFrame | null | undefined;
  status: string;
}) {
  const width =
    timing?.open && frame.playhead !== null
      ? `max(0px, calc(${timing.width}% - 1.5px))`
      : `${timing?.width ?? 0}%`;
  return (
    <>
      <div className="timeline-cell">
        {frame.ticks
          .filter((tick) => tick.value <= frame.extent)
          .map((tick) => (
            <i
              className="grid-line"
              key={tick.value}
              style={{
                left: `${(tick.value / frame.extent) * 100}%`,
                opacity: tick.opacity,
              }}
            />
          ))}
        {timing && (
          <span
            className={`bar ${status} ${timing.open ? "open" : ""}`}
            style={{ left: `${timing.left}%`, width }}
          />
        )}
      </div>
      <span className="elapsed">{timing ? duration(timing.duration) : ""}</span>
    </>
  );
}

export function Playhead({ position }: { position: number | null }) {
  if (position === null) return null;
  return (
    <div className="clock-track">
      <div className="clock-window">
        <div className="clock-line" style={{ left: `${position}%` }}>
          <i />
        </div>
      </div>
    </div>
  );
}
