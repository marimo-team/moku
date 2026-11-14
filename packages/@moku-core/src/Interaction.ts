/**
 * Requests and notifications used by interactive notebook outputs.
 *
 * @module
 */
import { Data, Schema, type Effect, type Stream } from "effect";
import type { Atom } from "effect/reactivity";
import type * as Protocol from "./Protocol.ts";

export type Json = typeof Schema.Json.Type;
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

/** The native notifications consumed by output renderers. */
export const Notification = Schema.Union([
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
export type Notification = typeof Notification.Type;

/** A reset invalidates all renderer state from the preceding connection. */
export type Event =
  | { readonly kind: "reset"; readonly runtimeId: string | null }
  | {
      readonly kind: "notification";
      readonly runtimeId: string;
      readonly notification: Notification;
    };

/** A failed interaction, including readiness, stale output, and host failures. */
export class Error extends Data.TaggedError("InteractionError")<{
  readonly code:
    | "unavailable"
    | "stale-runtime"
    | "authentication"
    | "unsupported"
    | "rpc"
    | "transport"
    | "timeout"
    | "closed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Native wire schemas shared with the local proxy. */
export const ComponentValues = Schema.Struct({
  objectIds: Schema.Array(Schema.String),
  values: Schema.Array(Schema.Json),
});
export const FunctionCall = Schema.Struct({
  functionCallId: Schema.String,
  namespace: Schema.String,
  functionName: Schema.String,
  args: JsonObject,
});
export const ModelValue = Schema.Struct({
  modelId: Schema.String,
  message: Schema.Union([
    Schema.Struct({
      method: Schema.Literal("update"),
      state: JsonObject,
      bufferPaths: BufferPaths,
    }),
    Schema.Struct({ method: Schema.Literal("custom"), content: Schema.Json }),
  ]),
  buffers: Buffers,
});

/** An output's producing runtime. Omit only when deliberately targeting the current runtime. */
export interface Target {
  readonly runtimeId?: string;
}
export interface UIValues extends Target {
  readonly values: Readonly<Record<string, Json>>;
}
export interface Invoke extends Target {
  readonly namespace: string;
  readonly name: string;
  readonly args: Readonly<Record<string, Json>>;
}
export interface WidgetMessage extends Target {
  readonly modelId: string;
  readonly message: (typeof ModelValue.Type)["message"];
  readonly buffers: readonly string[];
}

/** Native output transport availability and its connection-specific capabilities. */
export type Connection = Data.TaggedEnum<{
  Idle: {};
  Connecting: {};
  Connected: {
    /** Whether the host permits mutations through this connection. */
    readonly canInteract: boolean;
  };
  Failed: {
    /** The failure retained until retry or a runtime change. */
    readonly error: Error;
  };
}>;
/** Constructors and exhaustive matching for output connection states. */
export const Connection = Data.taggedEnum<Connection>();

/** Kernel identity and the availability of its output connection. */
export interface State {
  /** The runtime currently observed on the notebook. */
  readonly runtime: Protocol.RuntimeOutput | null;
  /** Native output transport state, independent of notebook observation. */
  readonly connection: Connection;
}

/** A scoped connection for native output notifications and requests. */
export interface Interface {
  /** Kernel identity and output connection availability. */
  readonly state: Atom.Atom<State>;
  /** Subscribing acquires a connection; the last subscriber releases it. */
  readonly events: Stream.Stream<Event, Error>;
  /** Updates controls without automatically retrying an uncertain write. */
  readonly setUIValues: (options: UIValues) => Effect.Effect<void, Error>;
  /** Waits for the matching kernel result, with a 30-second deadline. */
  readonly invoke: (options: Invoke) => Effect.Effect<Json, Error>;
  /** Sends an anywidget model update or custom message, including binary buffers. */
  readonly sendWidgetMessage: (options: WidgetMessage) => Effect.Effect<void, Error>;
  /** Resolves a kernel-authored ./@file/ reference to an authenticated asset URL. */
  readonly assetUrl: (path: string) => string;
  /** Reconnects output transport after credentials or host availability change. */
  readonly retry: Effect.Effect<void>;
}
