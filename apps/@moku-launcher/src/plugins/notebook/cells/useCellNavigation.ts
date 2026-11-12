import * as React from "react";
import { useDocument } from "../DocumentContext.ts";

/** Focus requests also open hidden source; their sequence permits repeat focus. */
export function useCellNavigation() {
  const model = useDocument();
  const [request, setRequest] = React.useState<{ id: string; sequence: number }>();
  const focus = React.useCallback((id: string) => {
    setRequest((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }));
  }, []);
  const advance = React.useCallback(
    (id: string) => {
      const { document, canEdit } = model.registry.get(model.state);
      if (!document) return;
      const index = document.order.indexOf(id);
      if (index < 0) return;
      const next = document.order[index + 1];
      if (next !== undefined) focus(next);
      else if (canEdit) {
        const created = crypto.randomUUID();
        model.edit((edit) => edit.createCell({ id: created, code: "" }, { after: id }));
        focus(created);
      }
    },
    [model, focus],
  );
  return { request, focus, advance };
}
