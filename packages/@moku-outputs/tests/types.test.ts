import * as NodeFs from "node:fs/promises";

import type * as React from "react";
import * as Vitest from "vite-plus/test";

import type { DisplayRenderer } from "../dist/renderer.js";
import type * as RendererSession from "../src/internal/RendererSession.ts";

Vitest.test(
  "generated declarations do not require the upstream source tree",
  async () => {
    Vitest.expectTypeOf<
      React.ComponentProps<typeof DisplayRenderer>
    >().toEqualTypeOf<RendererSession.DisplayProps>();
    const declaration = await NodeFs.readFile(
      new URL("../dist/renderer.d.ts", import.meta.url),
      "utf8",
    );
    Vitest.expect(declaration).not.toContain("@/");
    Vitest.expect(declaration).not.toContain("frontend");
    Vitest.expect(declaration).not.toContain(".css");
  },
);
