# /// script
# dependencies = ["marimo>=0.25.2", "numpy", "pandas", "altair", "wigglystuff", "drawdata", "matplotlib"]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App()

with app.setup(hide_code=True):
    import marimo as mo
    import numpy as np
    import pandas as pd
    import altair as alt


@app.cell(hide_code=True)
def intro():
    mo.md("""
    # Drawing

    Open this notebook in moku's **Drawing** view. Sketch something, lasso it with the
    select tool (`S`), press **Ask** (`⌘K`) and say what it should become: *a slider from
    0 to 100*, *a plot of this curve*, *a table of these numbers*. Claude writes a cell
    and its output takes the drawing's place on the board.
    """)


@app.cell
def mu_slider():
    mu = mo.ui.slider(0, 100, value=65, label="mu", full_width=True)
    mu
    return (mu,)


@app.cell
def sigma_slider():
    sigma = mo.ui.slider(0, 100, value=75, label="sigma", full_width=True)
    sigma
    return (sigma,)


@app.cell
def normal_histogram(color, mu, sigma):
    _rng = np.random.default_rng(0)
    _samples = _rng.normal(mu.value, max(sigma.value, 0.1), size=2000)
    _df = pd.DataFrame({"x": _samples})

    alt.Chart(_df).mark_bar(color=color.value["color"]).encode(
        x=alt.X("x:Q", bin=alt.Bin(maxbins=40), title="value"),
        y=alt.Y("count():Q", title="count"),
    ).properties(
        title=f"histogram (mu={mu.value}, sigma={sigma.value})",
        width=490,
        height=520,
    )


@app.cell
def color_picker():
    from wigglystuff import ColorPicker as _ColorPicker

    color = mo.ui.anywidget(_ColorPicker(color="#1f6fe0"))
    color
    return (color,)


@app.cell(disabled=True, hide_code=True)
def sketcher_board():
    # sketcher:board v1: the Drawing view's ink and card layout (deflate, base64)
    _board = (
        "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"
    )


if __name__ == "__main__":
    app.run()
