import { readFile } from "node:fs/promises";
import type { ComponentProps } from "react";
import { expect, expectTypeOf, test } from "vite-plus/test";
import type * as Protocol from "@moku/model/Protocol";
import type * as Outputs from "@moku/model/Outputs";
import type {
  DisplayView,
  ConsoleOutput,
  CellOutputs,
  OutputItem,
} from "../src/index.ts";
import type { DisplayRendererProps } from "../src/internal/session.ts";
import type { DisplayRenderer } from "../dist/renderer.js";

test("component and generated renderer props preserve the protocol types", () => {
  expectTypeOf<
    ComponentProps<typeof DisplayView>["data"]
  >().toEqualTypeOf<Protocol.DisplayDataOutput>();
  expectTypeOf<
    ComponentProps<typeof ConsoleOutput>["chunks"][number]
  >().toEqualTypeOf<Protocol.ConsoleOutput>();
  expectTypeOf<
    ComponentProps<typeof CellOutputs>["outcome"]
  >().toEqualTypeOf<Protocol.OutcomeOutput | null>();
  expectTypeOf<
    ComponentProps<typeof DisplayRenderer>
  >().toEqualTypeOf<DisplayRendererProps>();
  expectTypeOf<OutputItem>().toEqualTypeOf<Outputs.Item>();
  expectTypeOf<
    Extract<OutputItem, { kind: "display" }>["content"]
  >().toEqualTypeOf<Protocol.DisplayDataOutput>();
});

test("generated declarations do not require the upstream source tree", async () => {
  const declaration = await readFile(
    new URL("../dist/renderer.d.ts", import.meta.url),
    "utf8",
  );
  expect(declaration).not.toContain("@/");
  expect(declaration).not.toContain("frontend");
  expect(declaration).not.toContain(".css");
});
