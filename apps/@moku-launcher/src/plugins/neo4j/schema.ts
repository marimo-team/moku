/**
 * Reads a neo4j database's labels, relationship types, and property keys for completion.
 *
 * The client runs a scratch execution that queries the schema through the
 * notebook's driver and prints it as one JSON line. Scratch code reads a copy
 * of the notebook's namespace and binds no variables.
 *
 * @module
 */
import { Effect, Exit, Schema as EffectSchema } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import * as Outputs from "@moku/core/Outputs";
import * as Cypher from "./cypher.ts";

/** The names a database uses, as reported by its `db.*` procedures. */
export const Schema = EffectSchema.Struct({
  labels: EffectSchema.Array(EffectSchema.String),
  relationshipTypes: EffectSchema.Array(EffectSchema.String),
  propertyKeys: EffectSchema.Array(EffectSchema.String),
});
export type Schema = typeof Schema.Type;

const Payload = EffectSchema.fromJsonString(
  EffectSchema.Union([Schema, EffectSchema.Struct({ error: EffectSchema.String })]),
);

const marker = "__moku_neo4j_schema__:";

/** Python that prints the schema behind `driver` as one marker-prefixed JSON line. */
export function reader(driver: string): string {
  if (!Cypher.isName(driver) || Cypher.isPrivate(driver)) {
    throw new Error(`Cannot read the private or invalid variable ${driver}.`);
  }
  return `
def __moku_neo4j_schema(driver):
    def names(query, column):
        return sorted(record[column] for record in driver.execute_query(query).records)

    return {
        "labels": names("CALL db.labels()", "label"),
        "relationshipTypes": names("CALL db.relationshipTypes()", "relationshipType"),
        "propertyKeys": names("CALL db.propertyKeys()", "propertyKey"),
    }

# A stalled connection must not hold the kernel, so the lookup runs in a daemon
# thread that is abandoned after a timeout while cells keep running.
__moku_box = {}


def __moku_read():
    try:
        __moku_box["payload"] = __moku_neo4j_schema(${driver})
    except Exception as error:
        __moku_box["payload"] = {"error": f"{type(error).__name__}: {error}"}


__moku_thread = __import__("threading").Thread(target=__moku_read, daemon=True)
__moku_thread.start()
__moku_thread.join(10)
__moku_payload = __moku_box.get("payload", {"error": "Reading the Neo4j schema timed out."})
print(${JSON.stringify(marker)} + __import__("json").dumps(__moku_payload))
`;
}

/** Parses the printed schema from a scratch execution's standard output. */
export function parse(stdout: string): Schema {
  const line = stdout.split("\n").find((line) => line.startsWith(marker));
  if (line === undefined) throw new Error("The runtime returned no Neo4j schema.");
  const exit = EffectSchema.decodeUnknownExit(Payload)(line.slice(marker.length));
  if (Exit.isFailure(exit))
    throw new Error("The runtime returned an unreadable schema.");
  if ("error" in exit.value) throw new Error(exit.value.error);
  return exit.value;
}

/** Identifies one revision of a driver variable. */
export interface Key {
  readonly notebook: Notebook.Interface;
  readonly driver: string;
  /** The driver variable's revision, so redefining the driver reads again. */
  readonly revision: string;
}

/**
 * Loads the schema behind a driver variable at one revision.
 *
 * Keys compare structurally, and the registry keeps a mounted atom alive, so
 * every Cypher cell on the same driver shares one read.
 *
 * @example
 * ```ts
 * const schema = Neo4jSchema.load({ notebook, driver: "driver", revision: "e3:0" });
 * ```
 */
export const load = Atom.family(({ notebook, driver }: Key) => fetch(notebook, driver));

function fetch(notebook: Notebook.Interface, driver: string) {
  return Atom.make(
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;
      const run = yield* notebook.runtime.execute({ code: reader(driver) });
      const stdout = yield* Effect.callback<string, Error>((resume) => {
        const check = (state: AsyncResult.AsyncResult<Notebook.State, unknown>) => {
          if (!AsyncResult.isSuccess(state)) return false;
          const execution = Object.values(state.value.executions).find(
            (execution) => execution.run_id === run.id,
          );
          const finished =
            state.value.runs[run.id]?.status === "completed" ||
            execution?.status === "completed";
          if (!finished) return false;
          if (!execution) {
            resume(Effect.fail(new Error("The runtime did not read the schema.")));
            return true;
          }
          if (execution.outcome?.kind === "error") {
            resume(Effect.fail(new Error(execution.outcome.error.message)));
            return true;
          }
          const items = Outputs.forExecution(state.value, execution.id).items;
          resume(
            Effect.succeed(
              items
                .flatMap((item) =>
                  item.kind === "console" && item.name === "stdout" ? [item.text] : [],
                )
                .join(""),
            ),
          );
          return true;
        };
        if (check(registry.get(notebook.state))) return;
        const unsubscribe = registry.subscribe(notebook.state, (state) => {
          if (check(state)) unsubscribe();
        });
        return Effect.sync(unsubscribe);
      });
      return yield* Effect.try({
        try: () => parse(stdout),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
    }),
  ).pipe(Atom.setIdleTTL(300_000));
}
