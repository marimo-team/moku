// A minimal ACP agent that echoes prompts, reports a tool call, asks permission, and offers two models.
import * as Acp from "@agentclientprotocol/sdk";
import * as NodeStream from "node:stream";

let mcpServers = [];
let model = "fixture/small";
const modelOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: [
      {
        group: "fixture",
        name: "Fixture",
        options: [
          { value: "fixture/small", name: "Small" },
          { value: "fixture/large", name: "Large" },
        ],
      },
    ],
  },
];
const app = Acp.agent({ name: "fixture" })
  .onRequest(Acp.methods.agent.initialize, () => ({
    protocolVersion: Acp.PROTOCOL_VERSION,
    agentCapabilities: { mcpCapabilities: { http: true } },
    agentInfo: { name: "fixture-agent", version: "1.0.0" },
  }))
  .onRequest(Acp.methods.agent.session.new, ({ params }) => {
    mcpServers = params.mcpServers;
    return { sessionId: "session/1", configOptions: modelOptions() };
  })
  .onRequest(Acp.methods.agent.session.setConfigOption, ({ params }) => {
    model = params.value;
    return { configOptions: modelOptions() };
  })
  .onRequest(Acp.methods.agent.session.prompt, async ({ params, client }) => {
    const { sessionId } = params;
    const say = (text) =>
      client.notify(Acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    const text = params.prompt.map((block) => block.text).join("");
    if (text === "fail")
      throw new Acp.RequestError(
        -32603,
        "Internal error: Missing bearer authentication in header",
      );
    await say(`echo ${text};`);
    await say(` mcp ${mcpServers.map((server) => server.url).join(",")};`);
    await client.notify(Acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Run cell",
        status: "pending",
      },
    });
    const answer = await client.request(Acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId: "t1", title: "Run cell" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    await say(
      ` permission ${answer.outcome.outcome === "selected" ? answer.outcome.optionId : "cancelled"}`,
    );
    return { stopReason: "end_turn" };
  });

app.connect(
  Acp.ndJsonStream(
    NodeStream.Writable.toWeb(process.stdout),
    NodeStream.Readable.toWeb(process.stdin),
  ),
);
