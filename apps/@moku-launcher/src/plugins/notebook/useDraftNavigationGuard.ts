import { Atom } from "effect/reactivity";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as React from "react";
import * as ReactRouter from "react-router";
import type * as Document from "@moku/editor/Document";

/** Keep the document mounted while a link navigation flushes pending edits. */
export function useDraftNavigationGuard(model: Document.Interface, unsaved: boolean) {
  const flush = useAtomSet(
    React.useMemo(() => Atom.fn(() => model.flush).pipe(Atom.setIdleTTL(0)), [model]),
    { mode: "promise" },
  );
  const dirty = useAtomValue(model.state, (state) => state.dirty);
  const blocker = ReactRouter.useBlocker(
    React.useCallback(() => model.registry.get(model.state).dirty, [model]),
  );
  React.useEffect(() => {
    if (blocker.state !== "blocked") return;
    let active = true;
    void flush().then(
      () => {
        if (active) blocker.proceed();
      },
      () => {
        if (active) blocker.reset();
      },
    );
    return () => {
      active = false;
    };
  }, [blocker, flush]);
  React.useEffect(() => {
    if (!dirty && !unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, unsaved]);
  React.useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self") ||
        !model.registry.get(model.state).dirty
      )
        return;
      const url = new URL(link.href);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        (url.pathname === location.pathname &&
          url.search === location.search &&
          url.hash)
      )
        return;
      event.preventDefault();
      void flush().then(
        () => location.assign(url.href),
        () => {},
      );
    };
    document.addEventListener("click", navigate);
    return () => document.removeEventListener("click", navigate);
  }, [model, flush]);
}
