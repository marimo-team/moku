/**
 * Select the coding agent that answers dialogs in the development server.
 *
 * Set `MOKU_AGENT` to any command that speaks the Agent Client Protocol over
 * standard input and output, such as `npx @agentclientprotocol/claude-agent-acp`
 * or `gemini --experimental-acp`. OpenCode is the default.
 *
 * New sessions use `opencode/claude-sonnet-5-5` from OpenCode Zen unless
 * `MOKU_AGENT_MODEL` names another of the agent's models or the person picks
 * one in the Dialog view. Setting the model here overrides the default in the
 * person's own OpenCode config, which may name a provider whose key is missing.
 *
 * moku never reads or forwards an API key. The agent resolves credentials
 * itself, so OpenCode uses the keys saved by `opencode auth login` or the
 * environment variables its provider config names, and those variables must be
 * exported in the shell that runs `bun dev`.
 *
 * @module
 */
import * as Marimo from "./marimo.ts";

const [command = "opencode", ...args] = (process.env.MOKU_AGENT ?? "opencode acp")
  .trim()
  .split(/\s+/);

/** Start the agent in the repository so it can read the notebooks it edits. */
export const agent = {
  command,
  args,
  cwd: Marimo.root,
  // Other agents name their models differently, so only OpenCode gets a default.
  model:
    process.env.MOKU_AGENT_MODEL ||
    (process.env.MOKU_AGENT ? undefined : "opencode/claude-sonnet-5-5"),
};
