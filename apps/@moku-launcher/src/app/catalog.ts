import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type * as Workspace from "@moku/core/Workspace";
import type { Observation } from "@moku/core";

const empty = Atom.make<Observation<Workspace.Catalog>>({
  value: { ready: false, notebooks: {} },
  status: "connecting",
  error: null,
});
export function useCatalog(workspace: Workspace.Workspace, connectionId: string) {
  const atom = React.useMemo(
    () => (connectionId ? workspace.catalog(connectionId) : empty),
    [workspace, connectionId],
  );
  const { value, error } = useAtomValue(atom);
  return {
    notebooks: Object.values(value.notebooks),
    ready: value.ready,
    error: error?.message ?? "",
  };
}
