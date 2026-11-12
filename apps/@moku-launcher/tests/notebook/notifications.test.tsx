// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { NotificationList } from "../../src/plugins/notebook/feedback/NotificationList.tsx";
import {
  dismissAtom,
  showAtom,
} from "../../src/plugins/notebook/feedback/useNotifications.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

test("notification actions settle independently and survive disappearing feedback", async () => {
  const registry = AtomRegistry.make();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  onTestFinished(async () => {
    await act(async () => root.unmount());
    registry.dispose();
    element.remove();
  });
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <NotificationList />
      </RegistryContext.Provider>,
    ),
  );
  const interrupted = vi.fn();
  await act(async () => {
    registry.set(showAtom, {
      id: "slow",
      title: "Slow action",
      kind: "error",
      action: {
        label: "Retry slow",
        run: Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
      },
    });
    registry.set(showAtom, {
      id: "fast",
      title: "Fast action",
      kind: "error",
      action: { label: "Retry fast", run: Effect.void },
    });
  });
  await vi.waitFor(() =>
    expect(element.querySelectorAll(".notification")).toHaveLength(2),
  );
  const [slow, fast] =
    element.querySelectorAll<HTMLButtonElement>(".notification-action");
  await act(async () => slow.click());
  expect(slow.disabled).toBe(true);
  expect(fast.disabled).toBe(false);
  await act(async () => fast.click());
  expect(element.querySelectorAll(".notification")).toHaveLength(1);
  expect(slow.textContent).toBe("Working…");
  await act(async () => registry.set(dismissAtom, { id: "slow" }));
  expect(element.querySelectorAll(".notification")).toHaveLength(0);
  expect(interrupted).not.toHaveBeenCalled();
  await act(async () => {
    root.render(null);
  });
  registry.dispose();
  await vi.waitFor(() => expect(interrupted).toHaveBeenCalledOnce());
});
