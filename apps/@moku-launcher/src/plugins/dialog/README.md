# Dialog

The Dialog view lets a person talk with a coding agent between the cells of a
notebook, and the conversation is saved in the notebook itself.

Each turn of the conversation, one prompt and the agent's reply, is a dialog
cell whose code holds the turn as data and renders it with marimo alone. The
view writes the prompt into a new cell when it is sent and the reply when the
turn ends, then runs the cell, so the conversation reads the same in the
Notebook view, in marimo's own editor, and in a diff. [transcript.ts](transcript.ts)
explains the source format.

The bar at the bottom of the view adds the next cell. It sends a prompt to the
agent or adds a Python, Markdown, or SQL cell and runs it, and Alt (Option on
macOS) with 1 to 4 switches between them while the bar has focus. Adding is
append-only, so new cells always land at the end and the agent puts the cells
it makes directly below the turn that asked for them. Cells can be moved
afterwards with Alt and the arrow keys on a cell's margin or from its menu.

A turn's history is every turn above it. Agent sessions are only a cache of
that history. The session that answered the last turn is reused for the next
one, and otherwise a new session receives the turns above, so a reordered or
reloaded notebook continues where it left off. The agent works in the live
notebook through marimo's MCP tools. Its streamed reply, thinking, and tool
calls appear while the turn runs but are not stored.

## Choosing the agent, model, and key

The development server starts OpenCode with `opencode acp` and asks it for
`opencode/claude-sonnet-5-5`, which OpenCode serves through its Zen gateway.
The model picker in the bottom bar lists every model the agent offers, and the
choice is remembered in the browser for all notebooks. Set `MOKU_AGENT_MODEL` to
change the default, or `MOKU_AGENT` to run another agent that speaks the Agent
Client Protocol, in which case that agent's own default model applies.

```sh
MOKU_AGENT_MODEL=opencode/gpt-5.5 bun dev
MOKU_AGENT="npx -y @agentclientprotocol/claude-agent-acp" bun dev
```

moku never reads an API key. The agent signs in to its model provider itself,
so the key that answers a prompt depends on the model. OpenCode's `opencode/`
and `opencode-go/` models use the key that `opencode auth login` saves for
OpenCode, and other built-in providers use the key saved for that provider.
Providers defined in your own OpenCode config read whatever their `apiKey`
names, often an environment variable such as `{env:WANDB_API_KEY}`, which must
be exported in the shell that runs `bun dev`. Run `opencode auth list` to see
which providers have keys.

When a turn fails with an error like "Missing bearer authentication in header"
or "This API key has expired", the provider of the selected model rejected its
key or found none. The dialog names that model. Pick a model whose provider has
a working key, or renew the key with `opencode auth login` and restart
`bun dev`.
