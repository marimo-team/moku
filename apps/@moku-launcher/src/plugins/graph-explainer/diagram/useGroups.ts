import * as React from "react";
import type { ViewGroup } from "./layout.ts";

/** Persists this graph's groups in the current browser. */
export function useGroups(key: string) {
  const [groups, setGroups] = React.useState<ViewGroup[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (!Array.isArray(stored)) return [];
      return stored.filter(
        (group): group is ViewGroup =>
          group &&
          typeof group.id === "string" &&
          group.id.startsWith("view-group:") &&
          typeof group.label === "string" &&
          Array.isArray(group.members) &&
          group.members.every((id: unknown) => typeof id === "string"),
      );
    } catch {
      return [];
    }
  });
  function update(next: ViewGroup[]) {
    setGroups(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* The view remains usable when browser storage is unavailable. */
    }
  }
  return [groups, update] as const;
}
