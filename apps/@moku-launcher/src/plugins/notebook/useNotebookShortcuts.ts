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

/**
 * Binds Backspace or Delete to remove the selected cells and Escape to clear them.
 *
 * Keys typed into an editor or text field keep their usual meaning.
 */
export function useSelectionShortcuts({
  active,
  remove,
  clear,
}: {
  active: boolean;
  remove: (() => void) | undefined;
  clear: () => void;
}) {
  React.useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        clear();
      } else if ((event.key === "Backspace" || event.key === "Delete") && remove) {
        event.preventDefault();
        remove();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, remove, clear]);
}
