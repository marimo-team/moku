/** Reconcile optimistic widget edits with the notebook's ordered stream. @module */
import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/internal/comm-protocol";
import { Data, Equal } from "effect";

type Write = Parameters<Notebook.Runtime["experimentalComm"]["send"]>[0];
type Notification = Protocol.Notification;
type Model = Extract<Notification, { op: "model-lifecycle" }>;
type Patch = Extract<Model["message"], { method: "update" | "open" }>;

function uiValue(id: string, value: WriteValue): Notification {
  return {
    op: "send-ui-element-message",
    ui_element: id,
    message: { type: "marimo-ui-value-update", value },
  };
}
type WriteValue = Extract<Write, { _tag: "SetValues" }>["values"][string];

// A binary-only field may be present in buffer_paths and absent from state.
function* splitPatch(patch: Patch) {
  const indices = Map.groupBy(patch.buffer_paths.keys(), (i) =>
    String(patch.buffer_paths[i][0]),
  );
  const names = new Set([...Object.keys(patch.state), ...indices.keys()]);
  for (const name of names) {
    const buffers = indices.get(name) ?? [];
    yield [
      name,
      {
        method: "update" as const,
        state: Object.hasOwn(patch.state, name) ? { [name]: patch.state[name] } : {},
        buffer_paths: buffers.map((i) => patch.buffer_paths[i]),
        buffers: buffers.map((i) => patch.buffers[i]),
      },
    ] as const;
  }
}

// Keep each binary attachment paired with its path when only part of a patch applies.
function selectFields(patch: Patch, fields: Set<string>) {
  const indices = patch.buffer_paths.flatMap((path, i) =>
    fields.has(String(path[0])) ? [i] : [],
  );
  return {
    method: "update" as const,
    state: Object.fromEntries(
      Object.entries(patch.state).filter(([field]) => fields.has(field)),
    ),
    buffer_paths: indices.map((i) => patch.buffer_paths[i]),
    buffers: indices.map((i) => patch.buffers[i]),
  };
}

type FieldState = Data.TaggedEnum<{
  Following: {};
  Pending: { key: string; expected: Notification };
}>;
const FieldState = Data.taggedEnum<FieldState>();

type FieldEvent = Data.TaggedEnum<{
  Begin: { key: string; expected: Notification };
  Update: { key: string | undefined; value: Notification };
  Reject: { key: string };
  Snapshot: { value: Notification };
  Remove: {};
}>;
const FieldEvent = Data.taggedEnum<FieldEvent>();

class Field {
  private state: FieldState = FieldState.Following();
  private confirmed?: Notification;
  private lastKey: string | undefined;

  /** Returns the update to render, including a rollback when the owning write fails. */
  transition(event: FieldEvent): Notification | undefined {
    const state = this.state;
    return FieldEvent.$match(event, {
      Begin: ({ key, expected }) => {
        this.state = FieldState.Pending({
          key,
          expected: structuredClone(expected),
        });
        return undefined;
      },
      Update: ({ key, value }) => {
        const previous = this.confirmed;
        const previousKey = this.lastKey;
        // Even a suppressed peer update becomes the rollback value.
        this.confirmed = value;
        this.lastKey = key;
        return FieldState.$match(state, {
          Following: () =>
            key !== undefined && key === previousKey && Equal.equals(previous, value)
              ? undefined
              : value,
          Pending: (pending) => {
            if (key !== undefined && key !== pending.key) return undefined;
            this.state = FieldState.Following();
            return key === undefined || !Equal.equals(pending.expected, value)
              ? value
              : undefined;
          },
        });
      },
      Reject: ({ key }) => {
        if (state._tag !== "Pending" || state.key !== key) return undefined;
        this.state = FieldState.Following();
        return this.confirmed;
      },
      Snapshot: ({ value }) => {
        this.confirmed = value;
        return undefined;
      },
      Remove: () => {
        // Outstanding receipts can still reference this field after removal.
        this.state = FieldState.Following();
        return undefined;
      },
    });
  }
}

/** Tracks the latest local edit and confirmed stream value for each widget field in one renderer. */
export class WidgetUpdates {
  private readonly ui = new Map<string, Field>();
  private readonly models = new Map<string, Map<string, Field>>();

  private model(id: string) {
    let fields = this.models.get(id);
    if (!fields) {
      fields = new Map();
      this.models.set(id, fields);
    }
    return fields;
  }
  private field(fields: Map<string, Field>, name: string) {
    let field = fields.get(name);
    if (!field) {
      field = new Field();
      fields.set(name, field);
    }
    return field;
  }

  /** Register the fields the widget already changed before sending its HTTP request. */
  begin(write: Write) {
    const key = crypto.randomUUID();
    const touched: Field[] = [];
    const mark = (field: Field, expected: Notification) => {
      field.transition(FieldEvent.Begin({ key, expected }));
      touched.push(field);
    };
    if (write._tag === "SetValues") {
      for (const [id, value] of Object.entries(write.values))
        mark(this.field(this.ui, id), uiValue(id, value));
    } else if (write.message.method === "update") {
      const patch = {
        ...write.message,
        buffer_paths: write.message.bufferPaths,
        buffers: write.buffers,
      };
      for (const [name, message] of splitPatch(patch))
        mark(this.field(this.model(write.model), name), {
          op: "model-lifecycle",
          model_id: write.model,
          message,
        });
    }
    return {
      key,
      reject: () =>
        touched.flatMap((field) => field.transition(FieldEvent.Reject({ key })) ?? []),
    };
  }

  /** Return the fields that still need to reach the renderer. */
  receive(event: Notification, key?: string): Notification | undefined {
    if (event.op === "kernel-ready") {
      for (const [id, value] of Object.entries(event.ui_values ?? {}))
        this.field(this.ui, id).transition(
          FieldEvent.Snapshot({ value: uiValue(id, value) }),
        );
    }
    if (event.op === "remove-ui-elements") {
      for (const [id, field] of this.ui)
        if (id.startsWith(event.cell_id + "-")) {
          field.transition(FieldEvent.Remove());
          this.ui.delete(id);
        }
    }
    if (
      event.op === "send-ui-element-message" &&
      event.message.type === "marimo-ui-value-update" &&
      "value" in event.message
    ) {
      const value = uiValue(event.ui_element, event.message.value);
      if (
        !this.field(this.ui, event.ui_element).transition(
          FieldEvent.Update({ key, value: event.buffers?.length ? event : value }),
        )
      )
        return;
    }
    if (event.op !== "model-lifecycle") return event;
    const patch = event.message;
    if (patch.method === "open" || patch.method === "close") {
      for (const field of this.models.get(event.model_id)?.values() ?? [])
        field.transition(FieldEvent.Remove());
      this.models.delete(event.model_id);
    }
    if (patch.method !== "open" && patch.method !== "update") return event;

    const fields = this.model(event.model_id);
    let skipped = false;
    const visible = new Set<string>();
    for (const [name, message] of splitPatch(patch)) {
      const update = { ...event, message };
      if (
        this.field(fields, name).transition(FieldEvent.Update({ key, value: update }))
      )
        visible.add(name);
      else skipped = true;
    }
    if (!skipped) return event;
    if (visible.size || patch.esm_spec)
      return { ...event, message: { ...patch, ...selectFields(patch, visible) } };
  }
}
