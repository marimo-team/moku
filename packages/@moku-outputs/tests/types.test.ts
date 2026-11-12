import * as NodeFs from "node:fs/promises";
import type * as React from "react";
import * as Vitest from "vite-plus/test";
import type * as Protocol from "@moku/core/Protocol";
import type * as Outputs from "@moku/core/Outputs";
import type {
  DisplayView,
  ConsoleOutput,
  CellOutputs,
  OutputItem,
} from "../src/index.ts";
import type { DisplayRendererProps } from "../src/internal/session.ts";
import type { DisplayRenderer } from "../dist/renderer.js";

Vitest.test(
  "component and generated renderer props preserve the protocol types",
  () => {
    Vitest.expectTypeOf<
      React.ComponentProps<typeof DisplayView>["data"]
    >().toEqualTypeOf<Protocol.DisplayDataOutput>();
    Vitest.expectTypeOf<
      React.ComponentProps<typeof ConsoleOutput>["chunks"][number]
    >().toEqualTypeOf<Protocol.ConsoleOutput>();
    Vitest.expectTypeOf<
      React.ComponentProps<typeof CellOutputs>["outcome"]
    >().toEqualTypeOf<Protocol.OutcomeOutput | null>();
    Vitest.expectTypeOf<
      React.ComponentProps<typeof DisplayRenderer>
    >().toEqualTypeOf<DisplayRendererProps>();
    Vitest.expectTypeOf<OutputItem>().toEqualTypeOf<Outputs.Item>();
    Vitest.expectTypeOf<
      Extract<OutputItem, { kind: "display" }>["content"]
    >().toEqualTypeOf<Protocol.DisplayDataOutput>();
  },
);

Vitest.test(
  "generated declarations do not require the upstream source tree",
  async () => {
    const declaration = await NodeFs.readFile(
      new URL("../dist/renderer.d.ts", import.meta.url),
      "utf8",
    );
    Vitest.expect(declaration).not.toContain("@/");
    Vitest.expect(declaration).not.toContain("frontend");
    Vitest.expect(declaration).not.toContain(".css");
  },
);
