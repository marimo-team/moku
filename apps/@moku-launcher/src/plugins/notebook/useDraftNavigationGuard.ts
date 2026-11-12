import { Effect } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { useDocument } from "./DocumentContext.ts";

/** Keep the document mounted while a link navigation flushes pending edits. */
export function useDraftNavigationGuard(unsaved: boolean) {
  const model = useDocument();
  const dirty = useAtomValue(model.state, (state) => state.dirty);
  useEffect(() => {
    if (!dirty && !unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, unsaved]);
  useEffect(() => {
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
      void Effect.runPromise(model.flush).then(
        () => location.assign(url.href),
        () => {},
      );
    };
    document.addEventListener("click", navigate);
    return () => document.removeEventListener("click", navigate);
  }, [model]);
}
