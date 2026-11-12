# /// script
# dependencies = ["marimo>=0.25.2"]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App()

with app.setup(hide_code=True):
    import asyncio
    import marimo as mo


@app.cell(hide_code=True)
def publish_control():
    release = mo.ui.checkbox(label="Publish the bundle", value=False)
    mo.vstack(
        [
            mo.md("# Pipeline"),
            release,
        ]
    )
    return (release,)


@app.cell
async def load_source():
    await asyncio.sleep(1)
    source = {"title": "Hello", "color": "seagreen"}
    print("Source loaded")
    return (source,)


@app.cell
async def build_markup(source):
    await asyncio.sleep(3)
    markup = f"<h1>{source['title']}</h1>"
    print("Markup built")
    return (markup,)


@app.cell
async def build_styles(source):
    await asyncio.sleep(2)
    styles = f"h1 {{ color: {source['color']}; }}"
    print("Styles built")
    return (styles,)


@app.cell
async def health_check():
    await asyncio.sleep(1)
    healthy = True
    print("Health check passed")
    return (healthy,)


@app.cell
async def assemble_bundle(markup, styles):
    await asyncio.sleep(2)
    bundle = {"html": markup, "css": styles}
    print("Bundle assembled")
    return (bundle,)


@app.cell
def approve_bundle(bundle, release):
    mo.stop(not release.value, "Ready to publish.")
    approved_bundle = bundle
    return (approved_bundle,)


@app.cell
async def publish(approved_bundle, healthy):
    await asyncio.sleep(1)
    assert healthy
    print("Published!")
    {"status": "published", "bytes": sum(map(len, approved_bundle.values()))}


if __name__ == "__main__":
    app.run()
