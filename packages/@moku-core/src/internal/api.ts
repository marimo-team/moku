/** Native protocol endpoints with forward-compatible event decoding. @module */
import { Schema, SchemaGetter } from "effect";
import { HttpApi } from "effect/http-api";
import * as Host from "@marimo-team/host-protocol/Host";
import * as Notebook from "@marimo-team/host-protocol/Notebook";
import * as Analysis from "@marimo-team/host-protocol/experimental/Analysis";

const known = new Set<string>([
  "ready",
  "reset",
  "custom",
  ...Analysis.objects.flatMap((object) =>
    object.removable ? [object.kind, `${object.kind}.removed`] : [object.kind],
  ),
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

export const CatalogEvent = Schema.Union([Host.Event, UnknownEvent]);
export const NotebookEvent = Schema.Union([Analysis.NotebookEvent, UnknownEvent]);
export const Api = HttpApi.make("Moku")
  .add(Host.group(CatalogEvent), Notebook.group(NotebookEvent))
  .middleware(Host.HostToken);
