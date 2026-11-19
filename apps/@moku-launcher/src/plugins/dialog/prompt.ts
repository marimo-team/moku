/**
 * Compose what the agent receives for each message in a dialog.
 *
 * @module
 */
import type * as Transcript from "./transcript.ts";

/** What the agent needs to know about where a message comes from. */
export interface Input {
  /** The person's new message. */
  readonly text: string;
  /** The notebook's path on the host, when it has one. */
  readonly notebookPath: string | null;
  /** The dialog cell that stores this turn. */
  readonly cellId: string;
  /**
   * The turns above this one in the notebook, or null when the agent session
   * already holds them.
   *
   * A new session receives orientation and these turns, so a notebook reopened
   * from disk, or a turn asked further up, continues from the turns above it.
   */
  readonly history: readonly Transcript.Turn[] | null;
  /** Whether the session received marimo's MCP tools rather than relying on a skill. */
  readonly notebookTools: boolean;
}

/** Returns the text sent to the agent for one turn. */
export function compose(input: Input): string {
  // Every turn is a new cell, so even a continuing session needs to know where this one is.
  const placement = `This turn is stored in cell \`${input.cellId}\`, and the person reads your reply there. Put new cells directly below it, in order: create the first with \`after="${input.cellId}"\` and each later one after the cell you created before it.`;
  const naming =
    "Give every cell you create a short, unique, descriptive snake_case name with `name=`, such as `load_people` or `plot_revenue`, and name any unnamed cell you edit with `edit_cell(..., name=...)`. In your reply, refer to cells by these names, never by their ids.";
  const message = `The person says:\n\n${input.text}`;
  if (input.history === null) return [placement, naming, message].join("\n\n");
  const where = input.notebookPath ? ` (\`${input.notebookPath}\`)` : "";
  const tools = input.notebookTools
    ? "Use the `marimo` MCP tools to work in the live notebook. Call `list_sessions` to find the session for this notebook, then `execute_code` to inspect its variables or to change it with `marimo._code_mode`."
    : "Use the marimo-pair skill to work in the live notebook, and change it with `marimo._code_mode`.";
  const history = input.history.length
    ? [
        "The conversation so far, from the dialog cells above this one:",
        "<conversation>",
        ...input.history.flatMap((turn) => [
          `**Person:** ${turn.prompt}`,
          `**Agent:** ${turn.reply}`,
        ]),
        "</conversation>",
      ]
    : [];
  return [
    `You are pairing with a person inside a running marimo notebook${where}. They are talking to you from a dialog in moku, a notebook client, and see your replies inline with their cells.`,
    tools,
    [
      "```python",
      "import marimo._code_mode as cm",
      "",
      "async with cm.get_context() as ctx:",
      '    cell_id = ctx.create_cell("x = 1", after="<previous cell id>", name="define_x")',
      "    ctx.run_cell(cell_id)",
      "```",
    ].join("\n"),
    "Explore `dir(ctx)` first if you are unsure of the API. Edit and run existing cells where they are, and never write the notebook file directly.",
    "Cells whose source starts with `# moku:dialog` hold the conversation. Never edit, move, run, or delete them.",
    "The conversation follows the notebook from top to bottom, so the person may ask from an earlier point. Variables from cells further down can still exist in the kernel.",
    "Answer in concise Markdown. When you change the notebook, end with a short summary of what you changed.",
    ...history,
    placement,
    naming,
    message,
  ].join("\n\n");
}
