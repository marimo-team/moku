// @vitest-environment happy-dom
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { NotificationList } from "../../src/plugins/notebook/feedback/NotificationList.tsx";
import {
  dismissAtom,
  showAtom,
} from "../../src/plugins/notebook/feedback/useNotifications.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

Vitest.test(
  "notification actions settle independently and survive disappearing feedback",
  async () => {
    const registry = AtomRegistry.make();
    const element = document.createElement("div");
    document.body.append(element);
    const root = ReactDOMClient.createRoot(element);
    Vitest.onTestFinished(async () => {
      await React.act(async () => root.unmount());
      registry.dispose();
      element.remove();
    });
    await React.act(async () =>
      root.render(
        <RegistryContext.Provider value={registry}>
          <NotificationList />
        </RegistryContext.Provider>,
      ),
    );
    const interrupted = vi.fn();
    await React.act(async () => {
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
      Vitest.expect(element.querySelectorAll(".notification")).toHaveLength(2),
    );
    const [slow, fast] =
      element.querySelectorAll<HTMLButtonElement>(".notification-action");
    await React.act(async () => slow.click());
    Vitest.expect(slow.disabled).toBe(true);
    Vitest.expect(fast.disabled).toBe(false);
    await React.act(async () => fast.click());
    Vitest.expect(element.querySelectorAll(".notification")).toHaveLength(1);
    Vitest.expect(slow.textContent).toBe("Working…");
    await React.act(async () => registry.set(dismissAtom, { id: "slow" }));
    Vitest.expect(element.querySelectorAll(".notification")).toHaveLength(0);
    Vitest.expect(interrupted).not.toHaveBeenCalled();
    await React.act(async () => {
      root.render(null);
    });
    registry.dispose();
    await vi.waitFor(() => Vitest.expect(interrupted).toHaveBeenCalledOnce());
  },
);
