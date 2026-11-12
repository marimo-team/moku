import { useEffect, useId, useRef, useState } from "react";

export function CellActions({
  name,
  sourceVisible,
  onToggleSource,
  insert,
  remove,
}: {
  name: string;
  sourceVisible: boolean;
  onToggleSource?: () => void;
  insert?: {
    readonly pending: boolean;
    readonly at: (position: "before" | "after") => void;
  };
  remove?: { readonly pending: boolean; readonly run: () => void };
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }

  if (!onToggleSource && !remove && !insert) return null;
  return (
    <div
      ref={root}
      className="cell-actions"
      data-open={open}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
        if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[role^='menuitem']:not(:disabled)",
            ),
          ];
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="cell-actions-trigger"
        aria-label={`Actions for ${name}`}
        title="Cell actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="3" cy="8" r="1" />
          <circle cx="8" cy="8" r="1" />
          <circle cx="13" cy="8" r="1" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          className="cell-actions-menu"
          role="menu"
          aria-label="Cell actions"
        >
          {onToggleSource && (
            <button
              role="menuitem"
              autoFocus
              onClick={(event) => {
                onToggleSource();
                close(event.detail === 0);
              }}
            >
              <span aria-hidden="true" />
              {sourceVisible ? "Hide Source" : "Show Source"}
            </button>
          )}
          {insert &&
            (["before", "after"] as const).map((position, index) => (
              <button
                key={position}
                role="menuitem"
                autoFocus={!onToggleSource && index === 0}
                disabled={insert.pending}
                onClick={(event) => {
                  close(event.detail === 0);
                  insert.at(position);
                }}
              >
                <span aria-hidden="true" />
                Insert {position === "before" ? "above" : "below"}
              </button>
            ))}
          {remove && (
            <button
              role="menuitem"
              className="cell-actions-delete"
              disabled={remove.pending}
              autoFocus={!onToggleSource && !insert}
              onClick={(event) => {
                close(event.detail === 0);
                remove.run();
              }}
            >
              <span aria-hidden="true" />
              Delete cell
            </button>
          )}
        </div>
      )}
    </div>
  );
}
