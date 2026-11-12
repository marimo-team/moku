# /// script
# dependencies = ["marimo>=0.25.2"]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App()

with app.setup(hide_code=True):
    import marimo as mo


@app.cell(hide_code=True)
def title():
    mo.md("""
    # Controls
    """)


@app.cell(hide_code=True)
def text_controls():
    text = mo.ui.dictionary(
        {
            "text": mo.ui.text(value="Hello", label="Text"),
            "notes": mo.ui.text_area(value="A little more room.", label="Notes"),
            "date": mo.ui.date(value="2026-01-01", label="Date"),
        }
    )
    text
    return (text,)


@app.cell
def text_values(text):
    text.value


@app.cell(hide_code=True)
def numeric_controls():
    numbers = mo.ui.dictionary(
        {
            "slider": mo.ui.slider(0, 10, value=4, label="Slider"),
            "number": mo.ui.number(0, 20, value=3, label="Number"),
            "range": mo.ui.range_slider(0, 100, value=[20, 80], label="Range"),
        }
    )
    numbers
    return (numbers,)


@app.cell
def numeric_values(numbers):
    numbers.value


@app.cell(hide_code=True)
def choice_controls():
    choices = mo.ui.dictionary(
        {
            "checkbox": mo.ui.checkbox(value=True, label="Checkbox"),
            "switch": mo.ui.switch(value=False, label="Switch"),
            "dropdown": mo.ui.dropdown(
                ["Small", "Medium", "Large"], value="Medium", label="Size"
            ),
            "radio": mo.ui.radio(["Light", "Dark"], value="Light", label="Theme"),
            "multiselect": mo.ui.multiselect(
                ["Red", "Green", "Blue"], value=["Green"], label="Colors"
            ),
        }
    )
    choices
    return (choices,)


@app.cell
def choice_values(choices):
    choices.value


@app.cell(hide_code=True)
def counter():
    clicks = mo.ui.button(value=0, on_click=lambda value: value + 1, label="Add one")
    clicks
    return (clicks,)


@app.cell
def click_count(clicks):
    clicks.value


@app.cell(hide_code=True)
def selectable_table():
    table = mo.ui.table(
        [
            {"name": f"Item {i}", "group": "ABC"[i % 3], "score": (i * 7) % 20}
            for i in range(1, 13)
        ],
        selection="multi",
        pagination=True,
        page_size=5,
        label="Select a few rows",
    )
    table
    return (table,)


@app.cell
def selected_rows(table):
    table.value


if __name__ == "__main__":
    app.run()
