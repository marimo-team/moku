import * as React from "react";

interface Options {
  canSave: boolean;
  saveDisabled: boolean;
  save: () => void;
}

/** Binds notebook shortcuts to the same commands used by the toolbar. */
export function useNotebookShortcuts({ canSave, saveDisabled, save }: Options) {
  React.useEffect(() => {
    if (!canSave) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        if (!saveDisabled) save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSave, saveDisabled, save]);
}
