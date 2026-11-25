import * as Vitest from "vite-plus/test";
import { AUTO_ATTEMPTS, autoTargets } from "../../src/plugins/drawing/debug.ts";

const failure = (
  cell: string,
  code = `${cell} = 1`,
  error = "ModuleNotFoundError: No module named 'matplotlib'",
) => ({
  cell,
  code,
  error,
});

Vitest.test(
  "new failures go to the agent once, and a cell is tried a limited number of times",
  () => {
    const seen = new Set<string>();
    const attempts = new Map<string, number>();
    const first = autoTargets([failure("chart")], seen, attempts);
    Vitest.expect(first.map((t) => t.cell)).toEqual(["chart"]);
    seen.add(first[0].key);
    attempts.set("chart", 1);
    // The same cell failing the same way isn't sent again.
    Vitest.expect(autoTargets([failure("chart")], seen, attempts)).toEqual([]);
    // A fix that changed the code but still fails is a new attempt, up to the limit.
    const second = autoTargets([failure("chart", "chart = 2")], seen, attempts);
    Vitest.expect(second).toHaveLength(1);
    attempts.set("chart", AUTO_ATTEMPTS);
    Vitest.expect(autoTargets([failure("chart", "chart = 3")], seen, attempts)).toEqual(
      [],
    );
    // Other cells are still looked at.
    Vitest.expect(
      autoTargets([failure("table")], seen, attempts).map((t) => t.cell),
    ).toEqual(["table"]);
  },
);
