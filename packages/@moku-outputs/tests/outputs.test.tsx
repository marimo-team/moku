import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import * as Protocol from "@moku/model/Protocol";
import * as Outputs from "@moku/model/Outputs";
import { CellOutputs, ConsoleOutput, DisplayView } from "../src/index.ts";
import type { CellOutputsProps, OutputItem } from "../src/types.ts";
import { normalizeDisplay } from "../src/internal/normalize.ts";

const consoleChunk = (
  id: string,
  seq: number,
  text: string,
  name: "stdout" | "stderr" = "stdout",
): Protocol.ConsoleOutput => ({ id, seq, text, name, execution_id: "e" });
const display = (id: string, seq: number, text: string): Protocol.DisplayOutput => ({
  id,
  seq,
  execution_id: "e",
  content: { mimetype: "text/plain", data: text },
});
const error = Protocol.Error.parse({
  kind: "exception",
  name: "ValueError",
  message: "bad value",
  source: "marimo",
  severity: "error",
  range: null,
  related: [],
  traceback: { mimetype: "text/plain", data: "traceback" },
});

test("execution selection isolates records and orders replaced display and console items", () => {
  const first = display("d", 2, "old");
  const newer = { ...first, content: { mimetype: "text/plain", data: "new" } };
  const state = {
    executions: {},
    consoles: {
      a: consoleChunk("a", 1, "one"),
      b: { ...consoleChunk("b", 0, "other"), execution_id: "other" },
    },
    displays: { d: newer },
  };
  expect(Outputs.forExecution(state, "e")).toEqual({
    runtimeId: null,
    outcome: null,
    items: [
      { kind: "console", ...state.consoles.a },
      { kind: "display", ...newer },
    ],
  });
  expect(Outputs.forExecution({ ...state, displays: {} }, "e").items).toHaveLength(1);
  expect(Outputs.forExecution(state, "missing")).toEqual({
    runtimeId: null,
    outcome: null,
    items: [],
  });
});

test("outputs preserve interleaving, group adjacent console chunks, and render the result last", () => {
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
  const html = renderToStaticMarkup(<CellOutputs {...props} />);
  expect(html.match(/aria-label="Console output"/g)).toHaveLength(2);
  expect(html.indexOf("hello ")).toBeLessThan(html.indexOf("warning"));
  expect(html.indexOf("warning")).toBeLessThan(html.indexOf("figure"));
  expect(html.indexOf("figure")).toBeLessThan(html.indexOf("tail"));
  expect(html.indexOf("tail")).toBeLessThan(html.indexOf("result"));
  expect(html).toContain('data-channel="stderr"');
  expect(items.map((item) => item.id)).toEqual(["c", "d", "b", "a"]);
});

test("console text is escaped and preserved without trimming or inserted separators", () => {
  const html = renderToStaticMarkup(
    <ConsoleOutput
      chunks={[
        consoleChunk("b", 1, "\n<&>", "stderr"),
        consoleChunk("a", 0, "  hello "),
      ]}
    />,
  );
  expect(html).toContain('data-channel="stdout">  hello </span>');
  expect(html).toContain('data-channel="stderr">\n&lt;&amp;&gt;</span>');
});

test("duplicate traceback displays are omitted while the error remains", () => {
  const html = renderToStaticMarkup(
    <CellOutputs
      outcome={{ kind: "error", error }}
      items={[{ kind: "display", ...display("d", 0, "traceback") }]}
    />,
  );
  expect(html.match(/>traceback</g)).toHaveLength(1);
  expect(html).toContain("ValueError");
  expect(html).toContain("bad value");
  expect(html).toContain("details open");
});

test("empty results stay empty and non-value outcomes remain visible", () => {
  expect(renderToStaticMarkup(<CellOutputs outcome={null} items={[]} />)).toBe("");
  expect(
    renderToStaticMarkup(
      <CellOutputs outcome={{ kind: "value", display: null }} items={[]} />,
    ),
  ).toBe("");
  expect(
    renderToStaticMarkup(<CellOutputs outcome={{ kind: "interrupted" }} items={[]} />),
  ).toContain("Interrupted");
  expect(
    renderToStaticMarkup(
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

test("plain text does not need the browser-only marimo bundle", () => {
  expect(
    renderToStaticMarkup(
      <DisplayView data={{ mimetype: "text/plain", data: "<script>" }} />,
    ),
  ).toContain("&lt;script&gt;");
});

test("binary data becomes a media URL while inline SVG and existing data URLs are preserved", () => {
  expect(normalizeDisplay({ mimetype: "image/png", data: "AAAA" }).data).toBe(
    "data:image/png;base64,AAAA",
  );
  expect(normalizeDisplay({ mimetype: "video/mp4", data: "AAAA" }).data).toBe(
    "data:video/mp4;base64,AAAA",
  );
  const svg = { mimetype: "image/svg+xml", data: " <svg></svg>" };
  expect(normalizeDisplay(svg)).toBe(svg);
  const url = { mimetype: "image/png", data: "data:image/png;base64,AAAA" };
  expect(normalizeDisplay(url)).toBe(url);
});
