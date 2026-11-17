/**
 * Experimental messaging for interactive notebook outputs.
 *
 * Sends UI and widget updates, delivers incoming notifications, and matches
 * remote function calls with their replies.
 *
 * @module
 */
import { Data, type Schema, type Effect, type Stream } from "effect";
import type { Atom } from "effect/reactivity";
import type * as Native from "../internal/comm-protocol.ts";
import type * as Protocol from "../Protocol.ts";

/** Values exchanged with Python functions and interactive controls. */
export type Json = typeof Schema.Json.Type;
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
      readonly notification: Native.Notification;
    };

/** A failed interaction, including readiness, stale output, and host failures. */
export class Error extends Data.TaggedError("CommError")<{
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

/** An output's producing runtime, checked before a request is sent. */
export interface Target {
  /** Fails if the runtime has changed; omission deliberately targets the current one. */
  readonly runtimeId?: string;
}
/** Replacement values for native UI elements in one runtime. */
interface UIValues extends Target {
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
interface WidgetMessage extends Target {
  /** The widget model that receives this message. */
  readonly model: string;
  /** A state patch or transient custom message. */
  readonly message: (typeof Native.ModelValue.Type)["message"];
  /** Encoded binary attachments; empty when the message has none. */
  readonly buffers: readonly string[];
}

/** A message accepted by the runtime without a correlated reply. */
export type Message = Data.TaggedEnum<{ SetValues: UIValues; Model: WidgetMessage }>;
const messages = Data.taggedEnum<Message>();
/** Sets the values of one or more native UI elements. */
export const SetValues = messages.SetValues;
/** Sends a widget state patch or transient custom message. */
export const Model = messages.Model;

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
  readonly runtime: typeof Protocol.Runtime.Type | null;
  /** Native output transport state, independent of notebook observation. */
  readonly connection: Connection;
}

/**
 * A shared output connection owned by the notebook's Effect scope.
 *
 * Hosts advertising runtime.experimental.comm carry notifications on the notebook stream.
 * Native marimo attachments open on demand. Commands require a running kernel
 * and permission to interact.
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
   * Readers share the notebook connection or a lazily acquired native attachment.
   * Connection failures are published through state so subscribers can await retry.
   */
  readonly events: Stream.Stream<Event, Error>;
  /**
   * Sends a UI or widget message and returns when the host accepts the request.
   *
   * Subsequent kernel work arrives through observation. An uncertain write is
   * never retried automatically because the host may already have applied it.
   */
  readonly send: (message: Message) => Effect.Effect<void, Error>;
  /**
   * Invokes a Python function and waits for its matching result notification.
   *
   * The HTTP acknowledgement alone does not complete the call. Correlation IDs
   * are internal; completion, cancellation, and failure remove the pending reply.
   * The 30-second deadline includes waiting for connection readiness. Replacing
   * the runtime invalidates outstanding calls.
   */
  readonly invoke: (options: Invoke) => Effect.Effect<Json, Error>;
  /** Starts another attachment attempt for active consumers; completion does not wait for readiness. */
  readonly retry: Effect.Effect<void>;
}
