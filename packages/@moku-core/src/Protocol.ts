/** Schemas from the host protocol, including notebook dependency analysis. @module */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as S from "@marimo-team/host-protocol/Schemas";
import * as Problems from "@marimo-team/host-protocol/Problems";
import { ModelValue } from "./internal/native-comm.ts";

export * from "@marimo-team/host-protocol/Schemas";
export * from "@marimo-team/host-protocol/Problems";
export {
  Analysis,
  CellAnalysis,
  NotebookEvent,
} from "@marimo-team/host-protocol/experimental/Analysis";

/** The optional runtime.comm extension offered by Akan notebooks. */
export const CommGroup = HttpApiGroup.make("Comm").add(
  HttpApiEndpoint.post("send", "/notebooks/:notebook_id/runtime/comm", {
    params: Schema.Struct({ notebookId: S.NotebookId }).pipe(
      Schema.encodeKeys({ notebookId: "notebook_id" }),
    ),
    payload: Schema.TaggedUnion({
      SetValues: { values: Schema.Record(Schema.String, Schema.Json) },
      Model: {
        model: Schema.String,
        message: ModelValue.fields.message,
        buffers: ModelValue.fields.buffers,
      },
      Invoke: {
        call: Schema.String,
        namespace: Schema.String,
        name: Schema.String,
        args: Schema.Record(Schema.String, Schema.Json),
      },
    }),
    success: S.Runtime.pipe(HttpApiSchema.status(202)),
    error: [
      ...Problems.Common.members,
      Problems.NoRuntimeProblem,
      Problems.ConflictProblem,
      Problems.UnsupportedOperationProblem,
    ],
  }),
);
