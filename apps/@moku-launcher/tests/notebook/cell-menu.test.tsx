// @vitest-environment happy-dom
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import * as Agent from "@ui-sdk/react/agent";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { CellMenu } from "../../src/plugins/notebook/cells/CellMenu.tsx";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("__UI_SDK_STRICT__", true);

// Happy DOM has no top layer or layout; placement is checked in a browser.
HTMLElement.prototype.showPopover = () => {};
HTMLElement.prototype.hidePopover = () => {};
Element.prototype.getAnimations = () => [];
Element.prototype.checkVisibility = () => true;
Element.prototype.scrollIntoView = () => {};

const agent = Agent.createAgent();

async function mount(props: Partial<React.ComponentProps<typeof CellMenu>> = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  const toggle = vi.fn();
  const insert = vi.fn();
  const remove = vi.fn();
  const parentKey = vi.fn();
  const outside = vi.fn();
  const initial = {
    name: "cell 1",
    sourceVisible: false,
    onToggleSource: toggle,
    insert: { pending: false, at: insert },
    remove: { pending: false, run: remove },
    ...props,
  };
  async function render(overrides = {}) {
    await React.act(async () => {
      root.render(
        <div onKeyDown={parentKey}>
          <CellMenu {...initial} {...overrides} />
          <button onClick={outside}>Outside</button>
        </div>,
      );
    });
  }
  Vitest.onTestFinished(async () => {
    await React.act(async () => root.unmount());
    element.remove();
  });
  await render();
  return {
    element,
    render,
    toggle,
    insert,
    remove,
    parentKey,
    outside,
    trigger: () => element.querySelector<HTMLButtonElement>(".cell-actions-trigger")!,
    menu: () => element.querySelector<HTMLElement>("[role=menu]"),
    items: () => [...element.querySelectorAll<HTMLButtonElement>("[role=menuitem]")],
  };
}

async function key(element: Element, key: string) {
  await React.act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function click(element: HTMLElement) {
  await React.act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    element.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
    );
    element.click();
  });
}

Vitest.test("keyboard navigation and Escape stay inside the cell menu", async () => {
  const view = await mount();
  view.trigger().focus();
  await key(view.trigger(), "ArrowDown");
  Vitest.expect(view.trigger().getAttribute("aria-expanded")).toBe("true");
  Vitest.expect(view.menu()?.id).toBe(view.trigger().getAttribute("aria-controls"));
  Vitest.expect(document.activeElement).toBe(view.items()[0]);
  await key(document.activeElement!, "End");
  Vitest.expect(document.activeElement).toBe(view.items()[3]);
  await key(document.activeElement!, "ArrowDown");
  Vitest.expect(document.activeElement).toBe(view.items()[0]);
  await key(document.activeElement!, "ArrowUp");
  Vitest.expect(document.activeElement).toBe(view.items()[3]);
  await key(document.activeElement!, "Home");
  Vitest.expect(document.activeElement).toBe(view.items()[0]);
  await key(document.activeElement!, "d");
  Vitest.expect(document.activeElement).toBe(view.items()[3]);
  view.parentKey.mockClear();
  await key(document.activeElement!, "Escape");
  Vitest.expect(view.menu()).toBeNull();
  Vitest.expect(document.activeElement).toBe(view.trigger());
  Vitest.expect(view.parentKey).not.toHaveBeenCalled();
});

Vitest.test(
  "actions call the current notebook callbacks and return keyboard focus",
  async () => {
    const view = await mount();
    for (const [index, callback, args] of [
      [0, view.toggle, []],
      [1, view.insert, ["before"]],
      [2, view.insert, ["after"]],
      [3, view.remove, []],
    ] as const) {
      await key(view.trigger(), "ArrowDown");
      await React.act(async () => view.items()[index].focus());
      await key(document.activeElement!, "Enter");
      Vitest.expect(callback).toHaveBeenLastCalledWith(...args);
      Vitest.expect(view.menu()).toBeNull();
      Vitest.expect(document.activeElement).toBe(view.trigger());
    }
    await view.render({ sourceVisible: true });
    await click(view.trigger());
    Vitest.expect(view.items()[0].textContent).toBe("Hide Source");
    await click(view.items()[0]);
    Vitest.expect(view.toggle).toHaveBeenCalledTimes(2);
    Vitest.expect(view.menu()).toBeNull();
  },
);

Vitest.test(
  "pending actions cannot run and outside clicks still reach their target",
  async () => {
    const insert = vi.fn();
    const remove = vi.fn();
    const view = await mount({
      onToggleSource: undefined,
      insert: { pending: true, at: insert },
      remove: { pending: true, run: remove },
    });
    await click(view.trigger());
    for (const item of view.items()) {
      Vitest.expect(item.getAttribute("aria-disabled")).toBe("true");
      await React.act(async () => item.focus());
      await key(item, "Enter");
      await click(item);
    }
    Vitest.expect(insert).not.toHaveBeenCalled();
    Vitest.expect(remove).not.toHaveBeenCalled();
    Vitest.expect(view.menu()).not.toBeNull();
    await click(
      view.element.querySelector<HTMLButtonElement>(":scope > div > button")!,
    );
    Vitest.expect(view.outside).toHaveBeenCalledOnce();
    Vitest.expect(view.menu()).toBeNull();
    await view.render({ insert: undefined, remove: undefined });
    Vitest.expect(view.trigger()).toBeNull();
  },
);

Vitest.test(
  "the agent bridge can discover the named menu and invoke a notebook action",
  async () => {
    const view = await mount();
    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    Vitest.expect(entries.map((entry) => entry.label)).toEqual(["Actions for cell 1"]);
    await React.act(async () => {
      const result = await agent.act({
        steps: [{ ref: "Actions for cell 1", action: "press" }],
      });
      Vitest.expect(result.ok, result.error?.message).toBe(true);
    });
    await React.act(async () => {
      const result = await agent.act({
        steps: [{ ref: "Actions for cell 1", action: "press", args: ["Insert above"] }],
      });
      Vitest.expect(result.ok, result.error?.message).toBe(true);
    });
    Vitest.expect(view.insert).toHaveBeenCalledExactlyOnceWith("before");
  },
);
