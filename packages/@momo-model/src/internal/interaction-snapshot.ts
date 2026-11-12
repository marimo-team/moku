/**
 * Retain reconstructible widget state for renderers that subscribe later.
 *
 * @module
 */
import type * as Interaction from "../Interaction.ts";

type ModelEvent = Extract<Interaction.Notification, { op: "model-lifecycle" }>;
type ModelOpen = Extract<ModelEvent["message"], { method: "open" }>;

export class Snapshot {
  private values: Record<string, Interaction.Json> = {};
  private models = new Map<string, ModelOpen>();
  private ready: Extract<Interaction.Notification, { op: "kernel-ready" }> | undefined;

  reset() {
    this.values = {};
    this.models.clear();
    this.ready = undefined;
  }

  accept(message: Interaction.Notification) {
    switch (message.op) {
      case "kernel-ready":
        this.ready = message;
        this.values = { ...message.ui_values };
        break;
      case "consumer-capabilities":
        if (this.ready)
          this.ready = {
            ...this.ready,
            consumer_capabilities: message.consumer_capabilities,
          };
        break;
      case "send-ui-element-message":
        if (
          message.message.type === "marimo-ui-value-update" &&
          "value" in message.message
        )
          this.values[message.ui_element] = message.message.value;
        break;
      case "remove-ui-elements":
        for (const id of Object.keys(this.values))
          if (id.startsWith(`${message.cell_id}-`)) delete this.values[id];
        break;
      case "model-lifecycle": {
        const next = message.message;
        if (next.method === "close") this.models.delete(message.model_id);
        if (next.method === "open") this.models.set(message.model_id, next);
        if (next.method !== "update") break;
        const previous = this.models.get(message.model_id);
        if (!previous) break;
        const kept = previous.buffer_paths.flatMap((path, i) =>
          Object.hasOwn(next.state, String(path[0]))
            ? []
            : [{ path, buffer: previous.buffers[i] }],
        );
        this.models.set(message.model_id, {
          method: "open",
          state: { ...previous.state, ...next.state },
          esm_spec: next.esm_spec === undefined ? previous.esm_spec : next.esm_spec,
          buffer_paths: [...kept.map((item) => item.path), ...next.buffer_paths],
          buffers: [...kept.map((item) => item.buffer), ...next.buffers],
        });
      }
    }
  }

  messages(): Interaction.Notification[] {
    return [
      ...(this.ready ? [{ ...this.ready, ui_values: { ...this.values } }] : []),
      ...[...this.models].map(([model_id, message]): ModelEvent => ({
        op: "model-lifecycle",
        model_id,
        message,
      })),
    ];
  }
}
