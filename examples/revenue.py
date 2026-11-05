import marimo

__generated_with = "0.25.2"
app = marimo.App()

with app.setup:
    import time


@app.cell
def pull_orders():
    time.sleep(8)
    orders = [120, 75, 310, 90]
    print(f"Fetched {len(orders)} orders")
    return (orders,)


@app.cell
def fetch_exchange_rate():
    time.sleep(6)
    exchange_rate = 0.92
    return (exchange_rate,)


@app.cell
def normalize_revenue(exchange_rate, orders):
    time.sleep(7)
    revenue = [round(order * exchange_rate, 2) for order in orders]
    return (revenue,)


@app.cell
def quality_check(revenue):
    time.sleep(4)
    assert all(value > 0 for value in revenue), "Revenue must be positive"
    checked_revenue = revenue
    return (checked_revenue,)


@app.cell
def publish_summary(checked_revenue):
    time.sleep(5)
    total = sum(checked_revenue)
    print(f"Revenue: €{total:.2f}")
    {"orders": len(checked_revenue), "total_eur": total}


if __name__ == "__main__":
    app.run()
