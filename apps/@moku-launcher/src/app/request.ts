/** Workspace request failures. @module */
import { Data } from "effect";
export class RequestError extends Data.TaggedError("RequestError")<{
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
  readonly cause?: unknown;
  readonly problem?: unknown;
}> {}
