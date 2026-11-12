import { useEffect } from "react";

interface Options {
  canSave: boolean;
  saveDisabled: boolean;
  save: () => Promise<unknown>;
}

/** Binds notebook shortcuts to the same commands used by the toolbar. */
export function useNotebookShortcuts({ canSave, saveDisabled, save }: Options) {
  useEffect(() => {
    if (!canSave) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        if (!saveDisabled) void save().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSave, saveDisabled, save]);
}
