import { Schema } from "effect";
import * as Vitest from "vite-plus/test";
import * as ReactDOMServer from "react-dom/server";
import * as Protocol from "@moku/core/Protocol";
import * as Outputs from "@moku/core/Outputs";
import { CellOutputs, ConsoleOutput, DisplayView } from "../src/index.ts";
import type { CellOutputsProps, OutputItem } from "../src/types.ts";
import { normalizeDisplay } from "../src/internal/normalize.ts";

const consoleChunk = (
  id: string,
  seq: number,
  text: string,
  name: "stdout" | "stderr" = "stdout",
): Protocol.ConsoleOutput =>
  Schema.decodeUnknownSync(Protocol.Console)({
    id,
    seq,
    text,
    name,
    execution_id: "e",
  });
const display = (id: string, seq: number, text: string): Protocol.DisplayOutput =>
  Schema.decodeUnknownSync(Protocol.Display)({
    id,
    seq,
    execution_id: "e",
    content: { mimetype: "text/plain", data: text },
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
    const first = display("d", 2, "old");
    const newer = { ...first, content: { mimetype: "text/plain", data: "new" } };
    const state = {
      executions: {},
      consoles: {
        a: consoleChunk("a", 1, "one"),
        b: {
          ...consoleChunk("b", 0, "other"),
          execution_id: Schema.decodeUnknownSync(Protocol.ExecutionId)("other"),
        },
      },
      displays: { d: newer },
    };
    const index = indexed ? Outputs.index(state) : undefined;
    Vitest.expect(Outputs.forExecution(state, "e", index)).toEqual({
      runtimeId: null,
      outcome: null,
      items: [
        { kind: "console", ...state.consoles.a },
        { kind: "display", ...newer },
      ],
    });
    Vitest.expect(
      Outputs.forExecution({ ...state, displays: {} }, "e").items,
    ).toHaveLength(1);
    Vitest.expect(Outputs.forExecution(state, "missing", index)).toEqual({
      runtimeId: null,
      outcome: null,
      items: [],
    });
  },
);

Vitest.test(
  "outputs preserve interleaving, group adjacent console chunks, and render the result last",
  () => {
    const items: OutputItem[] = [
      { kind: "console", ...consoleChunk("c", 3, "tail") },
      { kind: "display", ...display("d", 2, "figure") },
      { kind: "console", ...consoleChunk("b", 1, "warning", "stderr") },
      { kind: "console", ...consoleChunk("a", 0, "hello ") },
    ];
    const props: CellOutputsProps = {
      items,
      outcome: { kind: "value", display: { mimetype: "text/plain", data: "result" } },
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
      outcome={{ kind: "error", error }}
      items={[{ kind: "display", ...display("d", 0, "traceback") }]}
    />,
  );
  Vitest.expect(html.match(/>traceback</g)).toHaveLength(1);
  Vitest.expect(html).toContain("ValueError");
  Vitest.expect(html).toContain("bad value");
  Vitest.expect(html).toContain("details open");
});

Vitest.test("empty results stay empty and non-value outcomes remain visible", () => {
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(<CellOutputs outcome={null} items={[]} />),
  ).toBe("");
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs outcome={{ kind: "value", display: null }} items={[]} />,
    ),
  ).toBe("");
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs outcome={{ kind: "interrupted" }} items={[]} />,
    ),
  ).toContain("Interrupted");
  Vitest.expect(
    ReactDOMServer.renderToStaticMarkup(
      <CellOutputs
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
