import * as Vitest from "vite-plus/test";

import { WidgetUpdates } from "../src/internal/WidgetUpdates.ts";

const slider = (value: number) => ({
  op: "send-ui-element-message" as const,
  ui_element: "slider",
  message: { type: "marimo-ui-value-update", value },
});

Vitest.test.each(["reject", "expire"] as const)(
  "a kernel-ready snapshot during a slider drag is only rendered on rejection (%s)",
  (release) => {
    const updates = new WidgetUpdates();
    const write = updates.begin({ _tag: "SetValues", values: { slider: 3 } });
    const ready = {
      op: "kernel-ready" as const,
      ui_values: { slider: 1, toggle: false },
      consumer_capabilities: { edit: false, interact: true },
    };
    Vitest.expect(updates.receive(ready)).toEqual({
      ...ready,
      ui_values: { toggle: false },
    });
    Vitest.expect(updates.receive({ ...ready, ui_values: { slider: 2 } })).toEqual({
      ...ready,
      ui_values: {},
    });
    Vitest.expect(write[release]?.()).toEqual(release === "reject" ? [slider(2)] : []);
  },
);

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

Vitest.test("a late rejection cannot restore a removed widget's value", () => {
  const updates = new WidgetUpdates();
  const widget = (value: number) => ({ ...slider(value), ui_element: "cell-slider" });
  updates.receive(widget(1));
  const write = updates.begin({ _tag: "SetValues", values: { "cell-slider": 2 } });
  updates.receive({ op: "remove-ui-elements", cell_id: "cell" });
  Vitest.expect(updates.receive(widget(3))).toEqual(widget(3));
  Vitest.expect(write.reject()).toEqual([]);
});

Vitest.test("expiry releases only fields still owned by the accepted write", () => {
  const updates = new WidgetUpdates();
  updates.receive(slider(1));
  const write = (value: number) =>
    updates.begin({ _tag: "SetValues", values: { slider: value } });
  const first = write(2);
  Vitest.expect(updates.receive(slider(3), "peer")).toBeUndefined();
  const second = write(4);
  Vitest.expect(first.expire?.()).toEqual([]);
  Vitest.expect(second.expire?.()).toEqual([slider(3)]);
  Vitest.expect(updates.receive(slider(5), "peer")).toEqual(slider(5));

  const quiet = write(6);
  Vitest.expect(quiet.expire?.()).toEqual([]);
  Vitest.expect(updates.receive(slider(7), "peer")).toEqual(slider(7));
});
