import * as Outputs from "@moku/core/Outputs";
import * as Protocol from "@moku/core/Protocol";
import { Schema } from "effect";
import * as ReactDOMServer from "react-dom/server";
import * as Vitest from "vite-plus/test";

import { CellOutputs, ConsoleOutput, DisplayView } from "../src/index.ts";
import { normalizeDisplay } from "../src/internal/normalize.ts";
import type { CellOutputsProps, OutputItem } from "../src/types.ts";

const consoleChunk = (
  id: string,
  seq: number,
  text: string,
  name: "stdout" | "stderr" = "stdout",
): typeof Protocol.Console.Type =>
  Schema.decodeUnknownSync(Protocol.Console)({
    id,
    seq,
    execution_id: "e",
    content: { kind: "text", stream: name, text },
  });
const display = (id: string, seq: number, text: string): typeof Protocol.Console.Type =>
  Schema.decodeUnknownSync(Protocol.Console)({
    id,
    seq,
    execution_id: "e",
    content: { kind: "media", media: { mimetype: "text/plain", data: text } },
  });
const error = Schema.decodeUnknownSync(Protocol.Error)({
  kind: "exception",
  name: "ValueError",
  message: "bad value",
  source: "marimo",
  severity: "error",
  range: null,
  related: [],
  traceback: { mimetype: "text/plain", data: "traceback" },
});

Vitest.test.each([false, true])(
  "execution selection isolates and orders output records (indexed: %s)",
  (indexed) => {
    const first = Schema.decodeUnknownSync(Protocol.Output)({
      id: "d",
      execution_id: "e",
      media: null,
    });
    const newer = { ...first, media: { mimetype: "text/plain", data: "new" } };
    const state = {
      executions: {},
      consoles: {
        a: consoleChunk("a", 1, "one"),
        b: {
          ...consoleChunk("b", 0, "other"),
          execution_id: Schema.decodeUnknownSync(Protocol.ExecutionId)("other"),
        },
      },
      outputs: { d: newer },
    };
    const index = indexed ? Outputs.index(state) : undefined;
    Vitest.expect(Outputs.forExecution(state, "e", index)).toEqual({
      runtimeId: null,
      outcome: null,
      items: [state.consoles.a],
      output: newer,
    });
    Vitest.expect(
      Outputs.forExecution({ ...state, outputs: {} }, "e").items,
    ).toHaveLength(1);
    Vitest.expect(Outputs.forExecution(state, "missing", index)).toEqual({
      runtimeId: null,
      outcome: null,
      items: [],
      output: null,
    });
  },
);

Vitest.test(
  "outputs preserve interleaving, group adjacent console chunks, and render the result last",
  () => {
    const items: OutputItem[] = [
      consoleChunk("c", 3, "tail"),
      display("d", 2, "figure"),
      consoleChunk("b", 1, "warning", "stderr"),
      consoleChunk("a", 0, "hello "),
    ];
    const props: CellOutputsProps = {
      items,
      outcome: { kind: "succeeded" },
      output: Schema.decodeUnknownSync(Protocol.Output)({
        id: "out",
        execution_id: "e",
        media: { mimetype: "text/plain", data: "result" },
      }),
    };
    const html = ReactDOMServer.renderToStaticMarkup(<CellOutputs {...props} />);
    Vitest.expect(html.match(/aria-label="Console output"/g)).toHaveLength(2);
    Vitest.expect(html.indexOf("hello ")).toBeLessThan(html.indexOf("warning"));
    Vitest.expect(html.indexOf("warning")).toBeLessThan(html.indexOf("figure"));
    Vitest.expect(html.indexOf("figure")).toBeLessThan(html.indexOf("tail"));
    Vitest.expect(html.indexOf("tail")).toBeLessThan(html.indexOf("result"));
    Vitest.expect(html).toContain('data-channel="stderr"');
    Vitest.expect(items.map((item) => item.id)).toEqual(["c", "d", "b", "a"]);
  },
);

Vitest.test(
  "console text is escaped and preserved without trimming or inserted separators",
  () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <ConsoleOutput
        chunks={[
          consoleChunk("b", 1, "\n<&>", "stderr"),
          consoleChunk("a", 0, "  hello "),
        ]}
      />,
    );
    Vitest.expect(html).toContain('data-channel="stdout">  hello </span>');
    Vitest.expect(html).toContain('data-channel="stderr">\n&lt;&amp;&gt;</span>');
  },
);

Vitest.test("duplicate traceback displays are omitted while the error remains", () => {
  const html = ReactDOMServer.renderToStaticMarkup(
    <CellOutputs
      output={null}
      outcome={{ kind: "failed", error }}
      items={[display("d", 0, "traceback")]}
    />,
  );
  Vitest.expect(html.match(/>traceback</g)).toHaveLength(1);
  Vitest.expect(html).toContain("ValueError");
  Vitest.expect(html).toContain("bad value");
  Vitest.expect(html).toContain("details open");
});

Vitest.test("empty results stay empty and non-value outcomes remain visible", () => {
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs output={null} outcome={null} items={[]} />,
    ),
  ).toBe("");
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs output={null} outcome={{ kind: "succeeded" }} items={[]} />,
    ),
  ).toBe("");
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs output={null} outcome={{ kind: "cancelled" }} items={[]} />,
    ),
  ).toContain("Cancelled");
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs
        output={null}
        outcome={{
          kind: "skipped",
          reason: "superseded",
          message: "Superseded",
          related: [],
        }}
        items={[]}
      />,
    ),
  ).toContain("Superseded");
});

Vitest.test("plain text does not need the browser-only marimo bundle", () => {
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <DisplayView data={{ mimetype: "text/plain", data: "<script>" }} />,
    ),
  ).toContain("&lt;script&gt;");
});

Vitest.test(
  "binary data becomes a media URL while inline SVG and existing data URLs are preserved",
  () => {
    Vitest.expect(normalizeDisplay({ mimetype: "image/png", data: "AAAA" }).data).toBe(
      "data:image/png;base64,AAAA",
    );
    Vitest.expect(normalizeDisplay({ mimetype: "video/mp4", data: "AAAA" }).data).toBe(
      "data:video/mp4;base64,AAAA",
    );
    const svg = { mimetype: "image/svg+xml", data: " <svg></svg>" };
    Vitest.expect(normalizeDisplay(svg)).toBe(svg);
    const url = { mimetype: "image/png", data: "data:image/png;base64,AAAA" };
    Vitest.expect(normalizeDisplay(url)).toBe(url);
  },
);
