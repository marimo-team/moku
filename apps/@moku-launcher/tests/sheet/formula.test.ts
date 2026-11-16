import * as Vitest from "vite-plus/test";
import * as Address from "../../src/plugins/sheet/address.ts";
import * as Formula from "../../src/plugins/sheet/formula.ts";

Vitest.test("reads only single-letter addresses as grid positions", () => {
  Vitest.expect(Address.parse("B2")).toEqual({ col: 1, row: 1 });
  Vitest.expect(Address.format({ col: 25, row: 998 })).toBe("Z999");
  for (const name of ["_", "b2", "A0", "AA1", "A1000", "total"])
    Vitest.expect(Address.parse(name)).toBeNull();
});

Vitest.test("keeps a moved position inside the grid", () => {
  const size = { cols: 3, rows: 3 };
  Vitest.expect(Address.move({ col: 0, row: 0 }, { col: -1 }, size)).toEqual({
    col: 0,
    row: 0,
  });
  Vitest.expect(Address.move({ col: 2, row: 1 }, { col: 1, row: 1 }, size)).toEqual({
    col: 2,
    row: 2,
  });
});

Vitest.test.each([
  ["42", "A1 = 42"],
  [" -1.5e3 ", "A1 = -1.5e3"],
  ["hello", 'A1 = "hello"'],
  ['say "hi"\\', 'A1 = "say \\"hi\\"\\\\"'],
  // Python has no integer literal with leading zeros.
  ["007", 'A1 = "007"'],
  ["=B1 * 2", "A1 = B1 * 2\nA1"],
])("writes %j as Python and reads it back", (input, source) => {
  Vitest.expect(Formula.toSource("A1", input)).toBe(source);
  Vitest.expect(Formula.toInput("A1", source)).toBe(input.trim());
});

Vitest.test("treats blank input as no cell", () => {
  Vitest.expect(Formula.toSource("A1", "  ")).toBeNull();
  Vitest.expect(Formula.toSource("A1", "=")).toBeNull();
});

Vitest.test("shows hand-written assignments as formulas", () => {
  Vitest.expect(Formula.toInput("B5", "B5 = B1 * B2")).toBe("=B1 * B2");
  Vitest.expect(Formula.toInput("B5", "B5 = 'text'")).toBe("='text'");
  // Text that would be read back as a number must stay a quoted formula.
  Vitest.expect(Formula.toInput("B5", 'B5 = "12"')).toBe('="12"');
});

Vitest.test("leaves other Python to the source editor", () => {
  for (const code of [
    "import marimo as mo",
    "A1 == 2",
    "A10 = 1",
    "x = 1\nA1 = x",
    "A1 = 1\nprint(A1)",
  ])
    Vitest.expect(Formula.toInput("A1", code)).toBeNull();
});

Vitest.test.each([
  ["=sum(B2:B4)", "A1 = sum([B2, B3, B4])\nA1"],
  ["=B2:D2", "A1 = [B2, C2, D2]\nA1"],
  ["=B2:C3", "A1 = [[B2, C2], [B3, C3]]\nA1"],
  ["=chart(A2:A3, cost=C2:C3)", "A1 = chart([A2, A3], cost=[C2, C3])\nA1"],
])("writes the range in %j as lists and reads it back", (input, source) => {
  Vitest.expect(Formula.toSource("A1", input)).toBe(source);
  Vitest.expect(Formula.toInput("A1", source)).toBe(input);
});

Vitest.test("reads a reversed range in its usual order", () => {
  Vitest.expect(Formula.toSource("A1", "=B4:B2")).toBe("A1 = [B2, B3, B4]\nA1");
});

Vitest.test("leaves ranges inside strings alone", () => {
  const input = '=f"{B7:,.2f} from B2:B4"';
  Vitest.expect(Formula.toSource("A1", input)).toBe(`A1 = ${input.slice(1)}\nA1`);
});

Vitest.test("shows only contiguous lists as ranges", () => {
  Vitest.expect(Formula.toInput("A1", "A1 = [B2, B4]")).toBe("=[B2, B4]");
  Vitest.expect(Formula.toInput("A1", "A1 = [[B2, C2], [B3]]")).toBe("=[B2:C2, [B3]]");
});

Vitest.test("reads a formula a formatter wrapped across lines", () => {
  const code = ["A1 = chart(", "    [B2, B3],", "    cost=[C2, C3],", ")", "A1"].join(
    "\n",
  );
  Vitest.expect(Formula.toInput("A1", code)).toBe("=chart(B2:B3, cost=C2:C3,)");
  Vitest.expect(Formula.toInput("A1", "A1 = (1 +\n  2)")).toBe("=(1 + 2)");
  Vitest.expect(Formula.toInput("A1", 'A1 = """a\nb"""')).toBeNull();
});
