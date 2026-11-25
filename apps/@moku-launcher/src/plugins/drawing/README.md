# Drawing

Drawing is a notebook view in which a whiteboard is the notebook. You sketch something, lasso it,
press **Ask** (⌘K) and say what it should become, such as _a slider from 0 to 100_ or _a plot of
this curve whose amplitude comes from the slider_. You can also say nothing, because a sketched
slider, dropdown, checkbox, table or chart is enough on its own. Claude writes a marimo cell, the
cell runs, and its live output takes the drawing's place on the board as a card that pans and
zooms with everything else.

Open [drawing.py](../../../../../notebooks/drawing.py) with the Drawing view to try it. Ask and
Connect need [Claude Code](https://claude.com/claude-code) installed and logged in, and Debug also
needs the [marimo-pair](https://github.com/marimo-team/marimo-pair) skill in `~/.claude/skills`.
The development server runs notebooks offline, so a cell can only use packages its notebook
declares and uv has already cached. Warm the cache for the demo once with
`uv run --no-project --with marimo --with numpy --with pandas --with altair --with wigglystuff --with drawdata --with matplotlib python -c ""`.

Select a card together with some notes drawn on it and Ask again (_make it red_, an arrow and
_log scale here_) to change that cell. Cards react to each other like any marimo cells, because
they are marimo cells.

To connect two cards, pick the Connect tool (`C`), drag from one card to the other and say how
they should connect, for example _scale normal samples by the amplitude_. The prompt lists what
the first card offers, so you can click the output you mean or press ↩ and let Claude choose.
Claude rewrites the second card's cell to use the first one. When the connection needs code of
its own, such as simulating the data a histogram shows, Claude puts it in helper cells, which are
ordinary marimo cells without a card. The connection becomes a wire between the cards, labelled
with what flows along it. Solid blue wires are connections you made, dashed grey ones are
dependencies created some other way, and a red one has lost its dependency because a cell was
edited elsewhere. Click a wire to ask again (⌘K) or disconnect it (⌫), and double-click it to see
its helper cells.

**Debug** starts a Claude agent that works inside the running kernel with marimo-pair to fix
failing cells. It runs when you press Debug, and on its own for newly failing cells while auto
debugging is on. The agent may only run marimo-pair's script against this notebook's session and
read marimo-pair's docs and the notebook's folder.

## How it fits together

The board is the Sketcher web component, vendored in [vendor/sketcher](../../../../../vendor/sketcher).
It knows nothing about notebooks. It has embed items, which are cards whose content the host
mounts, links between them, and Ask and Connect actions that hand the host a picture of the board
and the prompt. This plugin is the host. `controller.ts` runs a board for one notebook,
`reconcile.ts` keeps cards and cells in step, `ask.ts` builds what Claude is told and checks what
comes back, and `wires.ts` derives which cards depend on which from marimo's dependency analysis.

A card names its cell by cell name, because marimo files keep names but not cell IDs, and it
carries the code it was made with. That lets undo, redo, paste and Revert to Ink always recreate
or remove the cell. A link does the same for its helper cells, so undoing a connection or deleting
either card also removes the helpers. When a card appears or is re-asked, the board's code wins.
Otherwise the cell wins, so edits made in the Notebook view flow back into the card.

The board's ink and layout live in the notebook file itself, as a compressed string in a disabled,
hidden cell named `sketcher_board`. The file stays an ordinary marimo notebook that `marimo edit`
opens with the generated cells while ignoring the board.

The Vite plugin in `vite/` adds two dev-server routes. `/__sketcher/ask` runs `claude -p` with
fixed arguments, no tools, and one of the prompts in `vite/ask.json`. `/__sketcher/debug` runs the
Debug agent with the instructions in `vite/debug.md`. Both only answer same-origin JSON requests.
Every exchange is written to `ask-logs/` at the repository root. Set `SKETCHER_ASK_MODEL` to choose
the model passed to `claude --model`.

## Limits

One Ask writes one cell. A slider and a plot of it take two asks, which is also how marimo wants
them, since a control's value can only be read by another cell, and the Connect tool is the
quickest way to wire them together. Interactive outputs that compute pointer positions themselves,
such as Vega brushing and some anywidgets, can be off while the board is zoomed, and are exact at
100% (⇧0). Renaming a cell in another view disconnects its card, which then offers to bring the
cell back or remove the card.
