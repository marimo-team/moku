import * as Notebook from "@marimo-team/host-protocol/Notebook";
import * as Problems from "@marimo-team/host-protocol/Problems";
import * as S from "@marimo-team/host-protocol/Schemas";
/** Host messages and marimo session messages for the experimental output channel. @module */
import { Result, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const Buffers = Schema.Array(Schema.String);
const BufferPaths = Schema.Array(
  Schema.Array(Schema.Union([Schema.String, Schema.Number])),
);
const ModelState = {
  state: JsonObject,
  buffer_paths: BufferPaths,
  buffers: Buffers,
  esm_spec: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ url: Schema.String, hash: Schema.String })),
  ),
};
const Capabilities = Schema.Struct({ edit: Schema.Boolean, interact: Schema.Boolean });

/** Kernel notifications understood by the output renderer. */
const Notification = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("kernel-ready"),
    ui_values: Schema.optionalKey(Schema.NullOr(JsonObject)),
    consumer_capabilities: Schema.optionalKey(Capabilities),
  }),
  Schema.Struct({
    op: Schema.Literal("consumer-capabilities"),
    consumer_capabilities: Capabilities,
  }),
  Schema.Struct({
    op: Schema.Literal("send-ui-element-message"),
    ui_element: Schema.String,
    message: JsonObject,
    buffers: Schema.optionalKey(Schema.NullOr(Buffers)),
  }),
  Schema.Struct({ op: Schema.Literal("remove-ui-elements"), cell_id: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("function-call-result"),
    function_call_id: Schema.String,
    return_value: Schema.Json,
    status: Schema.Struct({
      code: Schema.Literals(["ok", "error"]),
      title: Schema.NullOr(Schema.String),
      message: Schema.NullOr(Schema.String),
    }),
    found: Schema.Boolean,
  }),
  Schema.Struct({
    op: Schema.Literal("model-lifecycle"),
    model_id: Schema.String,
    message: Schema.Union([
      Schema.Struct({ method: Schema.Literal("open"), ...ModelState }),
      Schema.Struct({ method: Schema.Literal("update"), ...ModelState }),
      Schema.Struct({
        method: Schema.Literal("custom"),
        content: Schema.Json,
        buffers: Buffers,
      }),
      Schema.Struct({ method: Schema.Literal("close") }),
    ]),
  }),
]);
/** A decoded output notification. */
export type Notification = typeof Notification.Type;

const decode = Schema.decodeUnknownResult(Notification);

/** A legacy UI-value request validated by the proxy before forwarding. */
export const ComponentValues = Schema.Struct({
  /** UI element IDs paired by position with values. */
  objectIds: Schema.Array(Schema.String),
  /** Replacement values in the same order as objectIds. */
  values: Schema.Array(Schema.Json),
});
/** A legacy function request whose result arrives on the marimo session stream. */
export const FunctionCall = Schema.Struct({
  /** Correlates the eventual reply with a pending invocation. */
  functionCallId: Schema.String,
  /** The function registry that owns the callable. */
  namespace: Schema.String,
  /** The registered function to invoke. */
  functionName: Schema.String,
  /** Named arguments passed to the Python function. */
  args: JsonObject,
});
/** A legacy anywidget state update or transient custom message. */
export const ModelValue = Schema.Struct({
  /** The widget model that receives this message. */
  modelId: Schema.String,
  /** A state patch or a custom message delivered without retaining its content. */
  message: Schema.Union([
    Schema.Struct({
      /** Applies the supplied state fields to the widget model. */
      method: Schema.Literal("update"),
      /** Changed model fields; unspecified fields retain their values. */
      state: JsonObject,
      /** Locations within state to restore from the corresponding buffers. */
      bufferPaths: BufferPaths,
    }),
    Schema.Struct({
      /** Delivers an application-defined message to the widget. */
      method: Schema.Literal("custom"),
      /** Content interpreted by the widget's custom-message handler. */
      content: Schema.Json,
    }),
  ]),
  /** Encoded binary attachments; empty when the message has none. */
  buffers: Buffers,
});

/** The viewer identity shared by the marimo event stream and its kernel requests. */
export const LegacySessionId = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/),
);

const SessionHeaders = Schema.Struct({
  sessionId: LegacySessionId,
  idempotencyKey: Schema.String,
}).pipe(
  Schema.encodeKeys({
    sessionId: "marimo-session-id",
    idempotencyKey: "idempotency-key",
  }),
);
const Acknowledgement = Schema.Struct({ success: Schema.Literal(true) });

/** Credentials supplied to the local proxy when attaching to an older marimo host. */
export const ViewerCredentials = Schema.Struct({
  token: Schema.optionalKey(Schema.String),
});

/** Widget POSTs used when the notebook lacks the host comm operation. */
export const LegacyCommApi = HttpApi.make("MarimoSession").add(
  HttpApiGroup.make("LegacyComm", { topLevel: true }).add(
    HttpApiEndpoint.post("authorize", "/auth", {
      payload: ViewerCredentials,
      success: Acknowledgement,
    }),
    HttpApiEndpoint.post("setValues", "/api/kernel/set_ui_element_value", {
      headers: SessionHeaders,
      payload: ComponentValues,
      success: Acknowledgement,
    }),
    HttpApiEndpoint.post("setModel", "/api/kernel/set_model_value", {
      headers: SessionHeaders,
      payload: ModelValue,
      success: Acknowledgement,
    }),
    HttpApiEndpoint.post("invoke", "/api/kernel/function_call", {
      headers: SessionHeaders,
      payload: FunctionCall,
      success: Acknowledgement,
    }),
  ),
);

type ModelEvent = Extract<Notification, { op: "model-lifecycle" }>;
type ModelOpen = Extract<ModelEvent["message"], { method: "open" }>;

/** Retains UI values and open widget models for newly attached renderers. */
export class Snapshot {
  private values = new Map<string, typeof Schema.Json.Type>();
  private models = new Map<string, ModelOpen>();
  private ready: Extract<Notification, { op: "kernel-ready" }> | undefined;

  /** Discards state belonging to a previous runtime. */
  reset() {
    this.values.clear();
    this.models.clear();
    this.ready = undefined;
  }

  /** Records a recognized output notification and returns it for live delivery. */
  recordNotification(raw: unknown): Notification | undefined {
    const decoded = decode(raw);
    if (Result.isFailure(decoded)) return;
    const message = decoded.success;
    switch (message.op) {
      case "kernel-ready":
        this.ready = message;
        this.values = new Map(Object.entries(message.ui_values ?? {}));
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
          this.values.set(message.ui_element, message.message.value);
        break;
      case "remove-ui-elements":
        for (const id of this.values.keys())
          if (id.startsWith(`${message.cell_id}-`)) this.values.delete(id);
        break;
      case "model-lifecycle": {
        const next = message.message;
        if (next.method === "close") this.models.delete(message.model_id);
        if (next.method === "open") this.models.set(message.model_id, next);
        if (next.method !== "update") break;
        const previous = this.models.get(message.model_id);
        if (!previous) break;
        const changed = new Set([
          ...Object.keys(next.state),
          ...next.buffer_paths.map((path) => String(path[0])),
        ]);
        const kept = previous.buffer_paths.flatMap((path, i) =>
          changed.has(String(path[0])) ? [] : [{ path, buffer: previous.buffers[i] }],
        );
        this.models.set(message.model_id, {
          method: "open",
          state: { ...previous.state, ...next.state },
          esm_spec: next.esm_spec ?? previous.esm_spec,
          buffer_paths: [...kept.map((item) => item.path), ...next.buffer_paths],
          buffers: [...kept.map((item) => item.buffer), ...next.buffers],
        });
      }
    }
    return message;
  }

  /** Reconstructs the current UI values and models for a new reader. */
  messages(): Notification[] {
    return [
      ...(this.ready
        ? [{ ...this.ready, ui_values: Object.fromEntries(this.values) }]
        : []),
      ...[...this.models].map(([model_id, message]): ModelEvent => ({
        op: "model-lifecycle",
        model_id,
        message,
      })),
    ];
  }
}

/** The notebook operation that advertises the experimental comm endpoint. */
export const operation = "runtime.experimental.comm";

/** Commands accepted by the experimental notebook comm endpoint. */
const Command = Schema.TaggedUnion({
  SetValues: { values: JsonObject },
  Model: {
    model: Schema.String,
    message: ModelValue.fields.message,
    buffers: ModelValue.fields.buffers,
  },
  Invoke: {
    call: Schema.String,
    namespace: FunctionCall.fields.namespace,
    name: FunctionCall.fields.functionName,
    args: FunctionCall.fields.args,
  },
});

// SAFETY: Edit stores its declared path and header codecs on these properties.
// @ts-expect-error HttpApiEndpoint widens both properties to Schema.Top | undefined.
const mutation: {
  params: HttpApiEndpoint.Params<typeof Notebook.Edit>;
  headers: HttpApiEndpoint.Headers<typeof Notebook.Edit>;
} = Notebook.Edit;

/** The HTTP contract shared by the notebook client and the proxy. */
export const CommGroup = HttpApiGroup.make("Comm").add(
  HttpApiEndpoint.post("send", "/notebooks/:notebook_id/runtime/experimental/comm", {
    params: mutation.params,
    headers: mutation.headers,
    payload: Command,
    success: S.Runtime.pipe(HttpApiSchema.status(202)),
    error: [
      ...Problems.Common.members,
      Problems.NoRuntimeProblem,
      Problems.ConflictProblem,
      Problems.UnsupportedOperationProblem,
    ],
  }),
);
