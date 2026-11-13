import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";

export function CellMenu({
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
  if (!onToggleSource && !remove && !insert) return null;
  return (
    <div
      className="cell-actions"
      onKeyDown={(event) => {
        // A menu dismissal must not also trigger the cell's Escape shortcut.
        if (event.key === "Escape" && event.defaultPrevented) event.stopPropagation();
      }}
    >
      <Menu modal={false}>
        <MenuTrigger
          className="cell-actions-trigger"
          aria-label={`Actions for ${name}`}
          title="Cell actions"
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
        </MenuTrigger>
        <MenuContent
          align="start"
          sideOffset={4}
          className="cell-actions-menu"
          aria-label="Cell actions"
        >
          {onToggleSource && (
            <MenuItem
              value="toggle-source"
              render={<button type="button" />}
              onSelect={() => onToggleSource()}
            >
              <span aria-hidden="true" />
              {sourceVisible ? "Hide Source" : "Show Source"}
            </MenuItem>
          )}
          {insert &&
            (["before", "after"] as const).map((position) => (
              <MenuItem
                key={position}
                value={`insert-${position}`}
                render={<button type="button" />}
                disabled={insert.pending}
                onSelect={() => insert.at(position)}
              >
                <span aria-hidden="true" />
                Insert {position === "before" ? "above" : "below"}
              </MenuItem>
            ))}
          {remove && (
            <MenuItem
              value="delete"
              render={<button type="button" />}
              className="cell-actions-delete"
              disabled={remove.pending}
              onSelect={() => remove.run()}
            >
              <span aria-hidden="true" />
              Delete cell
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}
