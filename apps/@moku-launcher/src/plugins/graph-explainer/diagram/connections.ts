import type { CellStatus } from "../execution.ts";

export type ConnectionTone = "idle" | "taken" | "live" | "skipped";

export function connectionTone(source: CellStatus, target: CellStatus): ConnectionTone {
  if (target === "skipped" || target === "disabled") return "skipped";
  if (source !== "succeeded") return "idle";
  if (target === "running" || target === "waiting") return "live";
  if (target === "succeeded" || target === "failed" || target === "interrupted")
    return "taken";
  return "idle";
}

export function connectionPriority(tone: ConnectionTone, hovered: boolean) {
  if (hovered) return 3;
  if (tone === "live") return 2;
  if (tone === "taken") return 1;
  return 0;
}
