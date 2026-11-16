# Sheet

Sheet is a spreadsheet view of a marimo notebook in which every grid cell is one
marimo cell and the host does all the recalculation.

Open `notebooks/sheet.py` with the Sheet view. If the notebook's runtime has
not calculated the sheet yet, the view starts one and recalculates. Until the
values arrive, constants show as typed and formulas show dimmed. Change the
quantity in `B2` and the subtotal, tax, and total update, because the host reran
the cells that read `B2`. Change a month's revenue in the table below and its
profit, the totals, and the chart under the table update the same way. The view
never works out what depends on what.

## How the grid maps to the notebook

A grid cell at `B2` is a marimo cell named `B2` that assigns a variable named
`B2`. What you type decides the Python that is written.

| You type      | Cell source                       |
| ------------- | --------------------------------- |
| `42`          | `B2 = 42`                         |
| `hello`       | `B2 = "hello"`                    |
| `=A1 * 2`     | `B2 = A1 * 2` and `B2`            |
| `=sum(A1:A3)` | `B2 = sum([A1, A2, A3])` and `B2` |

A formula is any Python expression, and other cells are referenced by address.
A range such as `A1:A3` becomes a list of its addresses, and a block such as
`A1:B2` a list of rows, so marimo still sees every cell it reads. The formula
bar shows those lists as ranges again. Ranges inside string literals are left
alone, so a format spec such as `{B7:,.2f}` is not mistaken for one.
A formula cell ends with its own name so that its value is also the cell's
output, which renders in the grid and in any other notebook client.

The grid shows the preview the host publishes for the variable named after the
address when the value is plain, such as a number, a string, or a list of
numbers. Any other value shows the cell's output exactly as marimo renders it in
a notebook, so Markdown, tables, plots, and widgets appear inline. The choice
follows the value's type rather than its preview, because the host previews a
widget by its current value. Rich output grows the row up to a limit and covers
up to three empty cells to its right, the way spreadsheet text overflows.

Widgets work in place. The demo's `B8` holds
`=mo.ui.slider(0, 0.5, step=0.05, value=0.1, show_value=True)`, and the
forecast column reads it as `B8.value`. Dragging the slider sends its value to
the host, which reruns the forecast, its total, and the chart that plots it.
The view runs nothing itself.

Clearing a cell deletes the marimo cell. Errors use spreadsheet-style labels,
with the message as a tooltip and beside the formula bar. `#CYCLE!` and `#DUP!` come from
the host's analysis, `#NAME?` and `#DIV/0!` from the exception a cell raised,
and `#BLOCKED!` marks a cell the host skipped because a cell it reads failed.

The address is stored in the cell name because cell configuration has no room
for extra metadata. The saved file is therefore an ordinary marimo notebook
that opens in the Notebook view or in marimo itself.

Cells with any other name, such as an import, are not on the grid. They are
listed as Python cells in the toolbar, where they can be added and selected.

The formula bar edits whatever is selected. A value or a one-line formula is
edited as typed input. A chart, a Python cell, or a grid cell holding several
statements turns the bar into a Python editor that grows with its code, with
Run (also Mod-Enter) and, for cells off the grid, Delete. Escape returns to
the grid. A grid cell can hold several statements as long as it still assigns
its address. Internal names such as `chart_F9` never appear in the view.

Plots need no special support. The demo imports pyplot in a Python cell, and
`A19` holds `=plt.bar(A11:A16, D11:D16)`, which marimo renders as its figure.
marimo closes figures after every cell, so each plotting formula draws on a
fresh figure, and the import cell sets `figure.figsize` so plots fit the grid.

## Floating charts

A chart can also float over the grid, as charts do in other spreadsheets. It is
a cell named `chart_` and an address, such as `chart_F9`, whose output is drawn
with its top-left corner at that address. Its code is ordinary Python, edited
in the formula bar like any other cell, and it reads the grid like any formula, so it
redraws when the data changes. The figure's size is the chart's size.

Dragging a chart by the strip along its top pins it to the cell under its top-left corner by renaming the
marimo cell, so the position is saved in the notebook file with nothing else
to store. Nothing reads a chart, so moving one needs no evaluation. A numeric
suffix such as `chart_F9_2` keeps names unique when charts share an anchor.

The Chart button drafts one from the selection. In a column of numbers it plots
that column, labelled by the nearest text column to its left and titled by the
header above, stopping before a total. The draft names its figure `_fig` and
`_ax`, which marimo keeps private to the cell, and adds an import cell when the
notebook does not already define `plt`. Select a chart to edit, run, or delete
it, or press Delete while it is selected.

## Limits

This is a prototype. Values do not spill across cells, ranges include empty
cells (which then raise `NameError`), and a slice such as `x[A1:A3]` reads as a
range. There is no copy and paste, fill handle, column resizing, or number
formatting. Columns stop at `Z`.
