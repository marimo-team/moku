/** Workspace request failures and connection presentation. @module */
import { Data } from "effect";
export class RequestError extends Data.TaggedError("RequestError")<{
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
  readonly cause?: unknown;
  readonly problem?: unknown;
}> {}
export interface Observation<A> {
  readonly value: A;
  readonly status: "connecting" | "connected" | "reconnecting" | "closed" | "error";
  readonly error: RequestError | null;
}
