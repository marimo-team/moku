/** Select the upstream source shared by setup, outputs, and the dev server. @module */
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../marimo.json";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const repository = config.repository;
export const revision = config.revision;
export const local = process.env.MARIMO_CHECKOUT
  ? Path.resolve(root, process.env.MARIMO_CHECKOUT)
  : undefined;
export const checkout = local ?? Path.join(root, ".cache/marimo", revision);

/** Start the notebook host from the same source used to prepare dependencies. */
export const server = {
  command: "uv",
  args: [
    "run",
    "--no-project",
    ...(local
      ? ["--with-editable", `${local}[lsp]`]
      : ["--with", `marimo[lsp] @ git+${repository}@${revision}`]),
    "marimo",
    "--quiet",
    "edit",
    "examples",
    "--sandbox",
  ],
  cwd: root,
};
