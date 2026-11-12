/** Select the upstream source shared by setup, outputs, and the dev server. @module */
import * as NodePath from "node:path";
import * as NodeUrl from "node:url";
import config from "../marimo.json";

export const root = NodeUrl.fileURLToPath(new URL("../", import.meta.url));
export const repository = config.repository;
export const revision = config.revision;
export const local = process.env.MARIMO_CHECKOUT
  ? NodePath.resolve(root, process.env.MARIMO_CHECKOUT)
  : undefined;
export const checkout = local ?? NodePath.join(root, ".cache/marimo", revision);

/** Start the notebook host from the same source used to prepare dependencies. */
export const server = {
  command: "uv",
  args: [
    "run",
    "--no-project",
    "--with-editable",
    `${checkout}[lsp]`,
    "marimo",
    "edit",
    "notebooks",
    "--sandbox",
  ],
  cwd: root,
};
