import type { Edge } from "./dependencies.ts";
import * as React from "react";
import { cellLabel, type NotebookState } from "../execution.ts";
import { validateGroup, type ViewGroup } from "./layout.ts";

export function GroupEditor({
  state,
  edges,
  groups,
  onChange,
  onClose,
}: {
  state: NotebookState;
  edges: Edge[];
  groups: ViewGroup[];
  onChange: (groups: ViewGroup[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [label, setLabel] = React.useState("");
  const [error, setError] = React.useState("");
  return (
    <form
      className="group-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const members = [...selected];
        const error = validateGroup(groups, members, edges);
        if (error) {
          setError(error);
          return;
        }
        onChange([
          ...groups,
          {
            id: `view-group:${crypto.randomUUID()}`,
            label: label.trim(),
            members,
          },
        ]);
        setSelected(new Set());
        setLabel("");
        setError("");
      }}
    >
      <div className="group-editor-heading">
        <strong>Notebook groups</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Close groups"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p>
        Name a set of cells. Groups can contain other groups; their dependencies remain
        visible when expanded. Saved in this browser.
      </p>
      {groups.map((group) => (
        <div className="saved-group" key={group.id}>
          <span>{group.label}</span>
          <span>{group.members.length} cells</span>
          <button
            type="button"
            onClick={() => onChange(groups.filter((item) => item.id !== group.id))}
          >
            Ungroup
          </button>
        </div>
      ))}
      <div className="group-cell-list">
        {(state.document?.order ?? [])
          .filter((id) => state.cells[id])
          .map((id, index) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
              />
              {cellLabel(state.cells[id], index)}
            </label>
          ))}
      </div>
      <div className="group-create">
        <input
          aria-label="Group name"
          placeholder="Group name"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
          maxLength={80}
        />
        <button disabled={selected.size < 2 || !label.trim()}>Create group</button>
      </div>
      {error && (
        <p role="alert" className="group-error">
          {error}
        </p>
      )}
    </form>
  );
}
