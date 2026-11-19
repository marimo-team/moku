import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";
import type * as Model from "../notebook/model.ts";
import * as Source from "../notebook/cells/source.ts";
import type * as Conversation from "./conversation.ts";

/** What the bar adds to the end of the notebook. */
export type Mode = "prompt" | Source.Language;

const modes: readonly {
  readonly id: Mode;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  { id: "prompt", label: "Prompt", placeholder: "Ask the agent…" },
  { id: "python", label: "Python", placeholder: "Python code to add and run…" },
  { id: "markdown", label: "Markdown", placeholder: "Markdown to add…" },
  { id: "sql", label: "SQL", placeholder: "SQL query to add and run…" },
];

const modeKey = (path: string | null) => `moku:dialog:mode:${path ?? ""}`;

function storedMode(path: string | null): Mode {
  try {
    const stored = globalThis.localStorage?.getItem(modeKey(path));
    return modes.find((mode) => mode.id === stored)?.id ?? "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * The bar at the bottom of the Dialog view that appends the next cell.
 *
 * A prompt adds a dialog turn for the agent to answer. Python, Markdown, and
 * SQL add a cell of that kind and run it. Cells are only ever added at the end,
 * and they can be reordered afterwards from their margins. The mode is
 * remembered per notebook.
 */
export function BottomBar({
  conversation,
  model,
  path,
}: {
  conversation: Conversation.Interface;
  model: Model.Interface;
  path: string | null;
}) {
  const [turn, ask] = useAtom(conversation.ask);
  const [text, setText] = useAtom(conversation.message);
  const run = useAtomSet(model.run, { mode: "promise" });
  const canEdit = useAtomValue(model.document.state, (state) => state.canEdit);
  const [mode, setModeState] = React.useState<Mode>(() => storedMode(path));
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const working = turn.waiting;
  const current = modes.find((entry) => entry.id === mode) ?? modes[0];
  const blocked = !canEdit || (mode === "prompt" && working);

  function setMode(next: Mode) {
    setModeState(next);
    try {
      globalThis.localStorage?.setItem(modeKey(path), next);
    } catch {
      // Without storage the mode lasts for this page.
    }
    textarea.current?.focus();
  }

  function append(language: Source.Language, source: string) {
    const ids: string[] = [];
    model.document.edit((edit) => {
      const document = model.document.registry.get(model.document.state).document;
      const first = document?.order[0];
      // Markdown and SQL call marimo through `mo`, so import it once at the top.
      if (
        language !== "python" &&
        ![...(document?.cells.values() ?? [])].some((cell) =>
          Source.importsMarimo(cell.code),
        )
      )
        ids.push(
          edit.createCell(
            { code: "import marimo as mo" },
            first === undefined ? undefined : { before: first },
          ),
        );
      ids.push(
        edit.createCell({
          code: Source.create(language, source),
          config: { hide_code: language === "markdown" },
        }),
      );
    });
    void run({ cellIds: ids }).catch(() => {});
  }

  function submit() {
    const value = text.trim();
    if (!value || blocked) return;
    setText("");
    if (mode === "prompt") ask(value);
    else append(mode, text.replace(/\s+$/, ""));
  }

  return (
    <form
      className="dialog-bar"
      aria-label="Add to the notebook"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        // Browsers keep Cmd/Ctrl with a digit for switching tabs, so modes use Alt.
        // The physical key is read because Option with a digit types a symbol on macOS.
        const digit = /^Digit([1-9])$/.exec(event.code);
        const entry = digit && modes[Number(digit[1]) - 1];
        if (!event.altKey || event.metaKey || event.ctrlKey || !entry) return;
        event.preventDefault();
        setMode(entry.id);
      }}
    >
      <div className="dialog-bar-modes" role="radiogroup" aria-label="Cell kind">
        {modes.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={entry.id === mode}
            title={`${entry.label} (⌥${index + 1})`}
            onClick={() => setMode(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textarea}
        value={text}
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        placeholder={
          mode === "prompt" && working ? "The agent is working…" : current.placeholder
        }
        aria-label={current.placeholder}
        data-mode={mode}
        spellCheck={mode === "prompt" || mode === "markdown"}
        disabled={!canEdit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          // Prompts send on Enter, while code keeps Enter for new lines as cells do.
          const send =
            mode === "prompt"
              ? !event.shiftKey
              : event.shiftKey || event.metaKey || event.ctrlKey;
          if (!send) return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="dialog-bar-footer">
        <ModelPicker conversation={conversation} disabled={working} />
        <span className="dialog-bar-hint">
          {mode === "prompt" ? "Enter to send" : "Shift+Enter to add and run"}
        </span>
        <button type="submit" className="primary" disabled={!text.trim() || blocked}>
          {mode === "prompt" ? "Send" : "Add"}
        </button>
      </div>
    </form>
  );
}

/** Splits `provider/model` values so long lists group by provider. */
function groups(options: readonly { value: string; name: string }[]) {
  const grouped = new Map<string, { value: string; name: string }[]>();
  for (const option of options) {
    const slash = option.value.indexOf("/");
    const provider = slash === -1 ? "" : option.value.slice(0, slash);
    grouped.set(provider, [...(grouped.get(provider) ?? []), option]);
  }
  return [...grouped];
}

/**
 * Chooses the model that answers prompts.
 *
 * The agent's models are unknown until a session starts, so opening the picker
 * starts one ahead of the next prompt.
 */
function ModelPicker({
  conversation,
  disabled,
}: {
  conversation: Conversation.Interface;
  disabled: boolean;
}) {
  const agent = useAtomValue(conversation.agent);
  const chosen = useAtomValue(conversation.model);
  const [loading, load] = useAtom(conversation.loadModels);
  const select = useAtomSet(conversation.selectModel);
  const options = agent?.models.options ?? [];
  const value = chosen ?? agent?.models.current ?? "";
  const failed = AsyncResult.isFailure(loading);
  const known = options.some((option) => option.value === value);
  return (
    <label
      className="dialog-model"
      title={failed ? "Could not start the agent" : "Model"}
    >
      <span>{agent?.name ?? "Agent"}</span>
      <select
        value={value}
        disabled={disabled}
        aria-label="Model"
        onPointerDown={() => load()}
        onFocus={() => load()}
        onChange={(event) => select(event.target.value || null)}
      >
        {!known && <option value={value}>{value || "Default model"}</option>}
        {loading.waiting && options.length === 0 && (
          <option disabled>Loading models…</option>
        )}
        {failed && options.length === 0 && (
          <option disabled>Could not start the agent</option>
        )}
        {groups(options).map(([provider, entries]) => (
          <optgroup key={provider} label={provider || "Models"}>
            {entries.map((option) => (
              <option key={option.value} value={option.value}>
                {option.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
