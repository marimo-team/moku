import { Host, Notebook } from "@marimo-team/host-protocol/experimental";
/** Host protocol endpoints with forward-compatible event decoding. @module */
import { Schema, SchemaGetter } from "effect";
import { HttpApi } from "effect/http-api";

import { CommGroup } from "./comm-protocol.ts";

const known = new Set<string>([
  ...Host.StreamEvent.members.map((member) => member.fields.event.literal),
  ...Notebook.StreamEvent.members.map((member) => member.fields.event.literal),
]);
const UnknownEvent = Schema.Struct({
  event: Schema.String.check(Schema.makeFilter((name) => !known.has(name))),
  id: Schema.optionalKey(Schema.String),
  data: Schema.Unknown,
}).pipe(
  Schema.decodeTo(
    Schema.Struct({
      _tag: Schema.Literal("UnknownEvent"),
      event: Schema.String,
      id: Schema.optionalKey(Schema.String),
      data: Schema.Unknown,
    }),
    {
      decode: SchemaGetter.transform((event) => ({
        ...event,
        _tag: "UnknownEvent" as const,
      })),
      encode: SchemaGetter.transform(({ _tag, ...event }) => event),
    },
  ),
);

export const CatalogEvent = Schema.Union([Host.StreamEvent, UnknownEvent]);
const MarimoEvent = Schema.Struct({
  event: Schema.Literal("marimo"),
  id: Schema.optionalKey(Schema.String),
  data: Schema.Struct({
    marimo: Schema.Unknown,
    request_id: Schema.optionalKey(Schema.String),
  }),
});
export const NotebookEvent = Schema.Union([
  Notebook.StreamEvent,
  MarimoEvent,
  UnknownEvent,
]);
export const Api = HttpApi.make("Moku")
  .add(Host.group(CatalogEvent), Notebook.group(NotebookEvent), CommGroup)
  .middleware(Host.HostToken);
