/**
 * Transport setup and shared observation types for marimo models.
 *
 * Mount model atoms in one AtomRegistry and use that registry to read their state.
 * The atom's lifetime keeps the model's Effect scope open.
 *
 * ```ts
 * import { Atom } from "effect/reactivity";
 * import * as Model from "@moku/model";
 * import * as Workspace from "@moku/model/Workspace";
 *
 * const runtime = Atom.runtime(Model.layer(window.location.origin));
 * const workspace = runtime.atom(Workspace.make());
 * ```
 *
 * @module
 */
export { layer, RequestError } from "./internal/transport.ts";
export type { Observation, Status } from "./internal/observe.ts";
