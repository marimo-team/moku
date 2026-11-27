import * as NodeAssert from "node:assert/strict";

import * as Vitest from "vite-plus/test";

import { connectionTone } from "../../src/plugins/graph-explainer/diagram/connections.ts";

Vitest.test(
  "queued work does not light an edge and a failed destination retains the path it ran",
  () => {
    NodeAssert.equal(connectionTone("succeeded", "queued"), "idle");
    NodeAssert.equal(connectionTone("succeeded", "running"), "live");
    NodeAssert.equal(connectionTone("succeeded", "failed"), "taken");
    NodeAssert.equal(connectionTone("failed", "skipped"), "skipped");
    NodeAssert.equal(connectionTone("pending", "running"), "idle");
  },
);
