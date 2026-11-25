import * as Vitest from "vite-plus/test";
import * as Board from "../../src/plugins/drawing/board.ts";
import { emptyDrawing } from "sketcher";
import { card } from "./fixtures.ts";

const stroke = (n: number) => ({
  id: `S${n}`,
  tool: "pen" as const,
  color: { r: 0, g: 0, b: 0, a: 1 },
  swatch: 0,
  width: 3,
  points: Array.from({ length: 50 }, (_, i) => ({
    x: i * 1.23456,
    y: Math.sin(i) * 40,
  })),
});

Vitest.test("a board survives the round trip through a cell", async () => {
  const drawing = {
    ...emptyDrawing("grid"),
    strokes: [stroke(1), stroke(2)],
    embeds: [card("slider", 'slider = mo.ui.slider(0, 100)\nslider  # "quoted"')],
  };
  const code = await Board.encode(drawing);
  Vitest.expect(Board.isBoard(code)).toBe(true);
  Vitest.expect(code).toMatch(/^# sketcher:board v1/);
  Vitest.expect(code.split("\n").every((line) => line.length <= 88)).toBe(true);
  const back = await Board.decode(code);
  Vitest.expect(back.embeds).toEqual(drawing.embeds);
  Vitest.expect(back.background).toBe("grid");
  Vitest.expect(back.strokes[0].points[1].x).toBeCloseTo(1.235, 3);
});

Vitest.test(
  "the cell is valid-looking Python that only assigns a private name",
  async () => {
    const code = await Board.encode(emptyDrawing());
    Vitest.expect(code).toMatch(/\n_board = \(\n {4}"[A-Za-z0-9+/=]+"\n\)$/);
  },
);

Vitest.test("reformatted cells still decode; other code doesn't", async () => {
  const code = await Board.encode({ ...emptyDrawing(), strokes: [stroke(1)] });
  const reflowed = code.replace(/\n {4}"/g, '\n  "');
  Vitest.expect((await Board.decode(reflowed)).strokes).toHaveLength(1);
  await Vitest.expect(Board.decode("x = 1")).rejects.toThrow("Not a Sketcher board");
});
