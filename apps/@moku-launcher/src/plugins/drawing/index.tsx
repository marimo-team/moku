/**
 * Drawing: a notebook view where the board is the notebook.
 *
 * Draw, lasso what you drew, and Ask (⌘K) what it should be. Claude writes a cell, and its
 * live output takes the drawing's place on the board.
 *
 * @module
 */
import { Plugin } from "@moku/plugin";
import { DrawingView } from "./DrawingView.tsx";
import "./style.css";

export default Plugin.define({
  id: "drawing",
  effect: (ctx) =>
    ctx.view.add({
      id: "board",
      title: "Drawing",
      render: DrawingView,
    }),
});
