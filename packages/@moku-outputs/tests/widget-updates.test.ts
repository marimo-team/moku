import * as Vitest from "vite-plus/test";
import { WidgetUpdates } from "../src/internal/WidgetUpdates.ts";

const slider = (value: number) => ({
  op: "send-ui-element-message" as const,
  ui_element: "slider",
  message: { type: "marimo-ui-value-update", value },
});

Vitest.test(
  "a rejection restores the latest stream value only for fields the failed write still owns",
  () => {
    const updates = new WidgetUpdates();
    updates.receive(slider(1));
    const write = (value: number) =>
      updates.begin({ _tag: "SetValues", values: { slider: value } });
    const first = write(3);
    const second = write(4);
    Vitest.expect(updates.receive(slider(2), "other-tab")).toBeUndefined();
    Vitest.expect(first.reject()).toEqual([]);
    Vitest.expect(second.reject()).toEqual([slider(2)]);
    Vitest.expect(updates.receive(slider(5), "other-tab")).toEqual(slider(5));
  },
);

Vitest.test(
  "an accepted write with no echo eventually releases the most recent peer update",
  () => {
    const updates = new WidgetUpdates();
    const write = updates.begin({ _tag: "SetValues", values: { slider: 8 } });
    write.accept(0);
    Vitest.expect(updates.receive(slider(5), "other-tab")).toBeUndefined();
    Vitest.expect(updates.expire(29_999)).toEqual([]);
    Vitest.expect(updates.expire(30_000)).toEqual([slider(5)]);
    Vitest.expect(updates.receive(slider(8), write.key)).toEqual(slider(8));
  },
);

Vitest.test(
  "untagged changes take effect immediately and out-of-order echoes converge in host order",
  () => {
    const updates = new WidgetUpdates();
    const write = (value: number) =>
      updates.begin({ _tag: "SetValues", values: { slider: value } });
    write(1);
    Vitest.expect(updates.receive(slider(2))).toEqual(slider(2));
    const first = write(3);
    const second = write(4);
    Vitest.expect(updates.receive(slider(4), second.key)).toBeUndefined();
    Vitest.expect(updates.receive(slider(3), first.key)).toEqual(slider(3));
  },
);
