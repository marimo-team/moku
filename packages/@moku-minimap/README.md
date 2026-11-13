# @moku/minimap

A React minimap for exploring dependencies between notebook cells.

```tsx
import * as Minimap from "@moku/minimap";
import "@moku/minimap/style.css";

<Minimap.Minimap notebook={notebook}>
  <Minimap.List>
    {(cell) => cell.definitions.join(", ") || cell.code || "empty"}
  </Minimap.List>
  <Minimap.Selection>
    {(selection, unselect) => (
      <footer>
        {selection.graph.current && (
          <span>
            {selection.upstream.size} upstream · {selection.downstream.size} downstream
          </span>
        )}
        <button onClick={unselect}>Unselect</button>
      </footer>
    )}
  </Minimap.Selection>
</Minimap.Minimap>;
```

Pass the notebook and use its existing Effect atom registry. List rows are buttons
that render your labels, and selection content appears when a cell is selected.
The stylesheet supplies default styles that you can customize in your application.
