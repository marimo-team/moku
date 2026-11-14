/**
 * Exchange messages with a notebook runtime's interactive outputs.
 *
 * Sends UI and widget updates, delivers incoming notifications, and matches
 * remote function calls with their replies.
 *
 * NB: Host-protocol support for these interactions is in progress. This legacy
 * compatibility layer should be deprecated once those operations are available
 * through the protocol client and its injected Effect HttpClient.
 *
 * @module
 */
import { Data, Schema, type Effect, type Stream } from "effect";
import type { Atom } from "effect/reactivity";
import type * as Protocol from "./Protocol.ts";

/** Values exchanged with Python functions and interactive controls. */
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

/**
 * Native UI values, widget lifecycle messages, capabilities, and function replies.
 *
 * These messages serve interactive outputs. Notebook documents, executions, and
 * console output are observed through the notebook model. Function replies are
 * correlated by {@link Interface.invoke} before being forwarded to readers.
 */
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
/** A decoded native output notification. */
export type Notification = typeof Notification.Type;

/** Output notifications and the resets that invalidate previously received state. */
export type Event =
  | {
      /** Discards UI values and widget models from the preceding connection. */
      readonly kind: "reset";
      /** The selected runtime, or null when no connection is held. */
      readonly runtimeId: string | null;
    }
  | {
      /** Delivers a message from the selected runtime. */
      readonly kind: "notification";
      /** The runtime that produced this message. */
      readonly runtimeId: string;
      /** The decoded message for the output renderer. */
      readonly notification: Notification;
    };

/** A failed interaction, including readiness, stale output, and host failures. */
export class Error extends Data.TaggedError("InteractionError")<{
  /** Classifies failures for recovery, including authorization and stale outputs. */
  readonly code:
    | "unavailable"
    | "stale-runtime"
    | "authentication"
    | "unsupported"
    | "rpc"
    | "transport"
    | "timeout"
    | "closed";
  /** A description suitable for display to the caller. */
  readonly message: string;
  /** The underlying failure, when available for diagnostics. */
  readonly cause?: unknown;
}> {}

/** A legacy UI-value request validated by the proxy before forwarding. */
export const ComponentValues = Schema.Struct({
  /** UI element IDs paired by position with values. */
  objectIds: Schema.Array(Schema.String),
  /** Replacement values in the same order as objectIds. */
  values: Schema.Array(Schema.Json),
});
/** A legacy function request whose result arrives on the native event stream. */
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

/** An output's producing runtime, checked before a request is sent. */
export interface Target {
  /** Fails if the runtime has changed; omission deliberately targets the current one. */
  readonly runtimeId?: string;
}
/** Replacement values for native UI elements in one runtime. */
export interface UIValues extends Target {
  /** Values keyed by UI element ID; omitted elements are unchanged. */
  readonly values: Readonly<Record<string, Json>>;
}
/** A registered Python function and the arguments for one invocation. */
export interface Invoke extends Target {
  /** The function registry that owns the callable. */
  readonly namespace: string;
  /** The registered function to invoke. */
  readonly name: string;
  /** Named arguments passed to the function. */
  readonly args: Readonly<Record<string, Json>>;
}
/** An anywidget state patch or custom message with its binary attachments. */
export interface WidgetMessage extends Target {
  /** The widget model that receives this message. */
  readonly modelId: string;
  /** A state patch or transient custom message. */
  readonly message: (typeof ModelValue.Type)["message"];
  /** Encoded binary attachments; empty when the message has none. */
  readonly buffers: readonly string[];
}

/** Native output transport availability and its connection-specific capabilities. */
export type Connection = Data.TaggedEnum<{
  /** No output attachment is active, including when no runtime is running. */
  Idle: {};
  /** Establishing the native stream and its runtime identity. */
  Connecting: {};
  /** Receiving native notifications with host-granted permissions. */
  Connected: {
    /** False for a read-only viewer that can receive updates but cannot send changes. */
    readonly canInteract: boolean;
  };
  /** An attachment attempt failed; active readers retain its error. */
  Failed: {
    /** The failure to display while awaiting retry or a runtime change. */
    readonly error: Error;
  };
}>;
/** Constructors and exhaustive matching for output connection states. */
export const Connection = Data.taggedEnum<Connection>();

/** Kernel identity and the availability of its output connection. */
export interface State {
  /** The notebook's observed runtime, or null when none exists. */
  readonly runtime: Protocol.RuntimeOutput | null;
  /** Native output transport state, independent of notebook observation. */
  readonly connection: Connection;
}

/**
 * A shared output connection owned by the notebook's Effect scope.
 *
 * Readers and commands acquire the connection on demand. Commands require a
 * running kernel and host permission to interact; they never start a kernel.
 * Closing the owner scope aborts requests and ends subscriptions.
 */
export interface Interface {
  /** Connection progress and permissions; observing this atom does not acquire a connection. */
  readonly state: Atom.Atom<State>;
  /**
   * Subscribes to native output notifications and connection resets.
   *
   * New readers receive a reset followed by retained UI values and open widget
   * models. Transient custom messages and old function replies are not replayed.
   * Readers and commands share one connection; the last release closes it.
   * Connection failures are published through state so subscribers can await retry.
   */
  readonly events: Stream.Stream<Event, Error>;
  /**
   * Submits UI values and returns when the host accepts the request.
   *
   * Subsequent kernel work arrives through observation. An uncertain write is
   * never retried automatically because the host may already have applied it.
   */
  readonly setUIValues: (options: UIValues) => Effect.Effect<void, Error>;
  /**
   * Invokes a Python function and waits for its matching result notification.
   *
   * The HTTP acknowledgement alone does not complete the call. Correlation IDs
   * are internal; completion, cancellation, and failure remove the pending reply.
   * The 30-second deadline includes waiting for connection readiness. Replacing
   * the runtime invalidates outstanding calls.
   */
  readonly invoke: (options: Invoke) => Effect.Effect<Json, Error>;
  /** Submits a widget update or custom message, returning on host acceptance without automatic retries. */
  readonly sendWidgetMessage: (options: WidgetMessage) => Effect.Effect<void, Error>;
  /** Resolves a kernel-authored ./@file/ or /@file/ reference; rejects other paths. */
  readonly assetUrl: (path: string) => string;
  /** Starts another attachment attempt for active consumers; completion does not wait for readiness. */
  readonly retry: Effect.Effect<void>;
}
