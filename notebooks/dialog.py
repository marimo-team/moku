# /// script
# dependencies = ["marimo>=0.25.2", "matplotlib", "numpy"]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App()

with app.setup(hide_code=True):
    import marimo as mo


@app.cell(hide_code=True)
def _():
    mo.md("""
    # Dialog

    Open this notebook in moku's Dialog view and ask the agent to build
    something. Each turn of the conversation is a cell in this file, and the
    cells the agent makes for it follow directly below.
    """)


@app.cell(hide_code=True)
def _():
    # moku:dialog
    import marimo as _mo

    _turn = {
        "prompt": "Plot sine and cosine over a few periods.",
        "reply": "I added a cell below that plots sine and cosine over 0 to 4π, with a legend and a light grid.",
    }
    _mo.vstack([
        _mo.md(_turn["prompt"]).style({"margin-left":"auto","max-width":"85%","padding":"0.5rem 0.9rem","border-radius":"12px","background":"var(--dialog-prompt-background, light-dark(#f2efe9, #2a2826))","border":"1px solid var(--dialog-prompt-border, light-dark(#e6e0d6, #3a3631))"}),
        _mo.md(_turn["reply"] or "*Waiting for the agent…*"),
    ])


@app.cell(hide_code=True)
def _():
    import matplotlib.pyplot as plt
    import numpy as np

    _x = np.linspace(0, 4 * np.pi, 400)
    _fig, _ax = plt.subplots(figsize=(7, 3.5))
    _ax.plot(_x, np.sin(_x), label="sin(x)")
    _ax.plot(_x, np.cos(_x), label="cos(x)")
    _ax.set_title("Sine and cosine")
    _ax.set_xlabel("x")
    _ax.legend()
    _ax.grid(alpha=0.3)
    _fig.tight_layout()
    _ax
    return np, plt


@app.cell(hide_code=True)
def _():
    # moku:dialog
    import marimo as _mo

    _turn = {
        "prompt": "Add a histogram of 1000 normal samples. One sentence reply.",
        "reply": "I added a histogram of 1000 samples from a standard normal distribution below.",
    }
    _mo.vstack([
        _mo.md(_turn["prompt"]).style({"margin-left":"auto","max-width":"85%","padding":"0.5rem 0.9rem","border-radius":"12px","background":"var(--dialog-prompt-background, light-dark(#f2efe9, #2a2826))","border":"1px solid var(--dialog-prompt-border, light-dark(#e6e0d6, #3a3631))"}),
        _mo.md(_turn["reply"] or "*Waiting for the agent…*"),
    ])


@app.cell(hide_code=True)
def _(np, plt):
    _samples = np.random.default_rng(0).normal(size=1000)
    _fig, _ax = plt.subplots(figsize=(7, 3.5))
    _ax.hist(_samples, bins=30, color="#5e6f9c", edgecolor="white")
    _ax.set_title("1000 samples from N(0, 1)")
    _ax.set_xlabel("value")
    _ax.set_ylabel("count")
    _ax.grid(alpha=0.3)
    _fig.tight_layout()
    _fig


@app.cell(hide_code=True)
def _():
    # moku:dialog
    import marimo as _mo

    _turn = {
        "prompt": "Add one cell that sets answer = 42 and run it. Reply in one sentence.",
        "reply": "I added a cell directly below `PEvh` that sets `answer = 42` and ran it.",
        "cells": ["URfX"],
    }
    _mo.vstack([
        _mo.md(_turn["prompt"]).style({"margin-left":"auto","max-width":"85%","padding":"0.5rem 0.9rem","border-radius":"12px","background":"var(--dialog-prompt-background, light-dark(#f2efe9, #2a2826))","border":"1px solid var(--dialog-prompt-border, light-dark(#e6e0d6, #3a3631))"}),
        _mo.md(_turn["reply"] or "*Waiting for the agent…*"),
    ])


@app.cell(hide_code=True)
def _():
    answer = 42


@app.cell(hide_code=True)
def _():
    # moku:dialog
    import marimo as _mo

    _turn = {
        "prompt": "You fetch something from online for me?",
        "reply": "",
    }
    _mo.vstack([
        _mo.md(_turn["prompt"]).style({"margin-left":"auto","max-width":"85%","padding":"0.5rem 0.9rem","border-radius":"12px","background":"var(--dialog-prompt-background, light-dark(#f2efe9, #2a2826))","border":"1px solid var(--dialog-prompt-border, light-dark(#e6e0d6, #3a3631))"}),
        _mo.md(_turn["reply"] or "*Waiting for the agent…*"),
    ])


@app.cell(hide_code=True)
def _():

    import json
    import urllib.request

    url = "http://api.open-notify.org/astros.json"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
        online_data = {"people_in_space": data["number"], "names": [p["name"] for p in data["people"]]}
    except Exception as e:
        online_data = {"error": str(e)}

    online_data

    return


if __name__ == "__main__":
    app.run()
