import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import { connectionPriority, connectionTone } from "../src/graph/connections.ts";

test("queued work does not light an edge and a failed destination retains the path it ran", () => {
  NodeAssert.equal(connectionTone("succeeded", "queued"), "idle");
  NodeAssert.equal(connectionTone("succeeded", "running"), "live");
  NodeAssert.equal(connectionTone("succeeded", "failed"), "taken");
  NodeAssert.equal(connectionTone("failed", "skipped"), "skipped");
  NodeAssert.equal(connectionTone("pending", "running"), "idle");
});

test("shared rails paint completed and live paths above idle paths, with hover last", () => {
  const connections = [
    {
      id: "active",
      tone: connectionTone("succeeded", "running"),
      hovered: false,
    },
    {
      id: "future",
      tone: connectionTone("succeeded", "queued"),
      hovered: false,
    },
    {
      id: "focused",
      tone: connectionTone("succeeded", "pending"),
      hovered: true,
    },
    {
      id: "finished",
      tone: connectionTone("succeeded", "succeeded"),
      hovered: false,
    },
  ].sort((a, b) => connectionPriority(a.tone, a.hovered) - connectionPriority(b.tone, b.hovered));
  NodeAssert.deepEqual(
    connections.map((edge) => edge.id),
    ["future", "finished", "active", "focused"],
  );
});
