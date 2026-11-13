import * as Protocol from "@moku/core/Protocol";
import { emptyNotebook } from "../../@moku-core/src/notebook/state.ts";

export function fixture() {
  const state = emptyNotebook();
  state.ready = true;
  state.phase = "live";
  // Deliberately different from dependency order: source → middle → result.
  const ids = ["result", "source", "middle", "isolated"];
  state.cells = Object.fromEntries(
    ids.map((id) => [
      id,
      Protocol.Cell.parse({
        id,
        notebook_id: "n",
        name: "_",
        code: `${id} = 1`,
        config: {
          column: null,
          disabled: false,
          hide_code: false,
          expand_output: false,
        },
        etag: id,
        code_fingerprint: id,
        version: 1,
      }),
    ]),
  );
  state.document = Protocol.Document.parse({
    notebook_id: "n",
    order: ids,
    app_config: {},
    etag: "v1",
    saved_etag: "v1",
    order_etag: "order",
    app_config_etag: "app",
    version: 1,
  });
  state.analysis = Protocol.Analysis.parse({
    notebook_id: "n",
    document_etag: "v1",
    cells: {
      source: { defs: ["x", "extra"], refs: [], errors: [] },
      middle: { defs: ["y"], refs: ["x", "extra"], errors: [] },
      result: { defs: ["z"], refs: ["y"], errors: [] },
      isolated: { defs: [], refs: ["external"], errors: [] },
    },
  });
  return { ...state, document: state.document, analysis: state.analysis };
}
