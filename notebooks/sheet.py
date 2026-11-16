# /// script
# dependencies = ["marimo>=0.25.2", "matplotlib"]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App()


@app.cell
def _():
    import marimo as mo
    import matplotlib.pyplot as plt

    # Size figures to fit four grid columns.
    plt.rcParams["figure.figsize"] = (4.2, 2.6)
    plt.rcParams["figure.dpi"] = 100
    return mo, plt


@app.cell
def A1():
    A1 = "Price"
    return (A1,)


@app.cell
def B1():
    B1 = 19.5
    return (B1,)


@app.cell
def A2():
    A2 = "Quantity"
    return (A2,)


@app.cell
def B2():
    B2 = 12
    return (B2,)


@app.cell
def A3():
    A3 = "Tax rate"
    return (A3,)


@app.cell
def B3():
    B3 = 0.08
    return (B3,)


@app.cell
def A5():
    A5 = "Subtotal"
    return (A5,)


@app.cell
def B5(B1, B2):
    B5 = B1 * B2
    B5
    return (B5,)


@app.cell
def A6():
    A6 = "Tax"
    return (A6,)


@app.cell
def B6(B3, B5):
    B6 = round(B5 * B3, 2)
    B6
    return (B6,)


@app.cell
def A7():
    A7 = "Total"
    return (A7,)


@app.cell
def B7(B5, B6):
    B7 = B5 + B6
    B7
    return (B7,)


@app.cell
def D1(mo):
    D1 = mo.md(f"## Total due: **{B7:,.2f}**")
    D1
    return (D1,)


@app.cell
def A8():
    A8 = "Growth"
    return (A8,)


@app.cell
def B8(mo):
    B8 = mo.ui.slider(0, 0.5, step=0.05, value=0.1, show_value=True)
    B8
    return (B8,)


@app.cell
def A9():
    A9 = "Monthly results"
    return (A9,)


@app.cell
def A10():
    A10 = "Month"
    return (A10,)


@app.cell
def B10():
    B10 = "Revenue"
    return (B10,)


@app.cell
def C10():
    C10 = "Cost"
    return (C10,)


@app.cell
def D10():
    D10 = "Profit"
    return (D10,)


@app.cell
def E10():
    E10 = "Forecast"
    return (E10,)


@app.cell
def A11():
    A11 = "Jan"
    return (A11,)


@app.cell
def B11():
    B11 = 120
    return (B11,)


@app.cell
def C11():
    C11 = 80
    return (C11,)


@app.cell
def D11(B11, C11):
    D11 = B11 - C11
    D11
    return (D11,)


@app.cell
def E11(B8, B11):
    E11 = round(B11 * (1 + B8.value), 1)
    E11
    return (E11,)


@app.cell
def A12():
    A12 = "Feb"
    return (A12,)


@app.cell
def B12():
    B12 = 135
    return (B12,)


@app.cell
def C12():
    C12 = 85
    return (C12,)


@app.cell
def D12(B12, C12):
    D12 = B12 - C12
    D12
    return (D12,)


@app.cell
def E12(B8, B12):
    E12 = round(B12 * (1 + B8.value), 1)
    E12
    return (E12,)


@app.cell
def A13():
    A13 = "Mar"
    return (A13,)


@app.cell
def B13():
    B13 = 150
    return (B13,)


@app.cell
def C13():
    C13 = 96
    return (C13,)


@app.cell
def D13(B13, C13):
    D13 = B13 - C13
    D13
    return (D13,)


@app.cell
def E13(B8, B13):
    E13 = round(B13 * (1 + B8.value), 1)
    E13
    return (E13,)


@app.cell
def A14():
    A14 = "Apr"
    return (A14,)


@app.cell
def B14():
    B14 = 142
    return (B14,)


@app.cell
def C14():
    C14 = 90
    return (C14,)


@app.cell
def D14(B14, C14):
    D14 = B14 - C14
    D14
    return (D14,)


@app.cell
def E14(B8, B14):
    E14 = round(B14 * (1 + B8.value), 1)
    E14
    return (E14,)


@app.cell
def A15():
    A15 = "May"
    return (A15,)


@app.cell
def B15():
    B15 = 168
    return (B15,)


@app.cell
def C15():
    C15 = 101
    return (C15,)


@app.cell
def D15(B15, C15):
    D15 = B15 - C15
    D15
    return (D15,)


@app.cell
def E15(B8, B15):
    E15 = round(B15 * (1 + B8.value), 1)
    E15
    return (E15,)


@app.cell
def A16():
    A16 = "Jun"
    return (A16,)


@app.cell
def B16():
    B16 = 190
    return (B16,)


@app.cell
def C16():
    C16 = 110
    return (C16,)


@app.cell
def D16(B16, C16):
    D16 = B16 - C16
    D16
    return (D16,)


@app.cell
def E16(B8, B16):
    E16 = round(B16 * (1 + B8.value), 1)
    E16
    return (E16,)


@app.cell
def A17():
    A17 = "Total"
    return (A17,)


@app.cell
def B17(B11, B12, B13, B14, B15, B16):
    B17 = sum([B11, B12, B13, B14, B15, B16])
    B17
    return (B17,)


@app.cell
def C17(C11, C12, C13, C14, C15, C16):
    C17 = sum([C11, C12, C13, C14, C15, C16])
    C17
    return (C17,)


@app.cell
def D17(D11, D12, D13, D14, D15, D16):
    D17 = sum([D11, D12, D13, D14, D15, D16])
    D17
    return (D17,)


@app.cell
def E17(E11, E12, E13, E14, E15, E16):
    E17 = sum([E11, E12, E13, E14, E15, E16])
    E17
    return (E17,)


@app.cell
def A18():
    A18 = "Profit"
    return (A18,)


@app.cell
def A19(A11, A12, A13, A14, A15, A16, D11, D12, D13, D14, D15, D16, plt):
    A19 = plt.bar([A11, A12, A13, A14, A15, A16], [D11, D12, D13, D14, D15, D16])
    A19
    return (A19,)


@app.cell
def chart_G9(A11, A12, A13, A14, A15, A16, B11, B12, B13, B14, B15, B16, C11, C12, C13, C14, C15, C16, E11, E12, E13, E14, E15, E16, plt):
    _fig, _ax = plt.subplots(figsize=(5, 3))
    _ax.plot([A11, A12, A13, A14, A15, A16], [B11, B12, B13, B14, B15, B16], marker="o", label="Revenue")
    _ax.plot([A11, A12, A13, A14, A15, A16], [C11, C12, C13, C14, C15, C16], marker="o", label="Cost")
    _ax.plot([A11, A12, A13, A14, A15, A16], [E11, E12, E13, E14, E15, E16], linestyle="--", label="Forecast")
    _ax.set_title("Revenue, cost, and forecast")
    _ax.legend(frameon=False)
    _fig
    return


if __name__ == "__main__":
    app.run()
