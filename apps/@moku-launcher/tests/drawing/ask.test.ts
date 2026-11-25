import * as Vitest from "vite-plus/test";
import * as Ask from "../../src/plugins/drawing/ask.ts";

const request = (overrides: Partial<Ask.Request> = {}): Ask.Request => ({
  prompt: "a plot of this curve",
  png: "iVBOR",
  context: "iVBOR",
  size: { w: 480, h: 300 },
  cells: [
    { name: "setup", code: "import numpy as np", defs: ["np"], refs: [] },
    {
      name: "amp",
      code: "amp = mo.ui.slider(0, 10)\namp",
      defs: ["amp"],
      refs: ["mo"],
    },
  ],
  variables: [{ name: "amp", type: "UISlider", preview: "3" }],
  target: null,
  selected: [],
  arrows: [],
  ...overrides,
});

/** `claude -p` stream-json output carrying `answer` as structured output. */
const reply = (answer: object) => ({
  stdout: `{"type":"system"}\n${JSON.stringify({ type: "result", is_error: false, result: "", structured_output: answer })}\n`,
  stderr: "",
  status: 0,
});

const answer = (code: string, defines: string[] = []) => ({
  action: "create",
  name: "Curve Plot!",
  title: "Curve",
  code,
  defines,
});

Vitest.test("the request tells Claude the globals, the target and the size", () => {
  const text = Ask.describe(
    request({ target: { name: "amp", code: "amp = 1", defs: ["amp"], refs: [] } }),
  );
  Vitest.expect(text).toContain("Request: a plot of this curve");
  Vitest.expect(text).toContain("Mode: edit the cell `amp`");
  Vitest.expect(text).toContain("about 480×300 px");
  // The target's own names aren't off limits when editing it.
  Vitest.expect(text).toMatch(/Globals \(.*\): np\n/);
  Vitest.expect(text).toContain("- amp: UISlider = 3");
});

Vitest.test("with nothing typed, Claude is told to read the sketch", () => {
  Vitest.expect(Ask.describe(request({ prompt: "  " }))).toContain(
    "Request: (none: work out from the picture alone what this sketch should become)",
  );
  Vitest.expect(
    Ask.describe(
      request({
        prompt: "",
        target: { name: "amp", code: "amp = 1", defs: ["amp"], refs: [] },
      }),
    ),
  ).toContain(
    "Request: (none: notes on the card, and arrows into it from other cells, say what to change)",
  );
});

Vitest.test(
  "answers are checked against the cells as they are when they arrive",
  async () => {
    const answers = [
      answer("text_input = mo.ui.text()\ntext_input", ["text_input"]),
      answer("name_input = mo.ui.text()\nname_input", ["name_input"]),
    ];
    const texts: string[] = [];
    // Another ask added a cell defining `text_input` while Claude worked on this one.
    const later = [
      ...request().cells,
      {
        name: "text_input",
        code: "text_input = mo.ui.text()",
        defs: ["text_input"],
        refs: [],
      },
    ];
    const result = await Ask.run(
      request(),
      async ({ text }) => {
        texts.push(text);
        return reply(answers.shift()!);
      },
      new AbortController().signal,
      () => later,
    );
    Vitest.expect(result.defines).toEqual(["name_input"]);
    Vitest.expect(texts[1]).toContain("`text_input`, which other cells already define");
    Vitest.expect(texts[1]).toContain("### text_input");
  },
);

Vitest.test(
  "an answer may rewrite the cells an arrow from the selection points at",
  async () => {
    const result = await Ask.run(
      request(),
      async () =>
        reply({
          ...answer('color = mo.ui.text("#f00")\ncolor', ["color"]),
          updates: [{ name: "amp", code: "amp = mo.ui.slider(0, 10)\namp" }],
        }),
      new AbortController().signal,
    );
    Vitest.expect(result.updates).toEqual([
      { name: "amp", code: "amp = mo.ui.slider(0, 10)\namp" },
    ]);
  },
);

Vitest.test(
  "an arrow from the selection into a cell means that cell must be rewired",
  async () => {
    const texts: string[] = [];
    const answers = [
      answer('color = mo.ui.text("#f00")\ncolor', ["color"]),
      {
        ...answer('color = mo.ui.text("#f00")\ncolor', ["color"]),
        updates: [{ name: "amp", code: "amp = mo.ui.slider(0, 10)\namp" }],
      },
    ];
    const result = await Ask.run(
      request({ arrows: [{ from: null, to: "amp" }] }),
      async ({ text }) => {
        texts.push(text);
        return reply(answers.shift()!);
      },
      new AbortController().signal,
    );
    Vitest.expect(texts[0]).toContain(
      "Arrows drawn on the board: from the selection into cell `amp`.",
    );
    Vitest.expect(texts[1]).toContain("An arrow points from the selection into `amp`");
    Vitest.expect(result.updates?.map((u) => u.name)).toEqual(["amp"]);
  },
);

Vitest.test("suggested names become cell names", () => {
  Vitest.expect(Ask.cellName("Curve Plot!")).toBe("curve_plot");
  Vitest.expect(Ask.cellName("3d view")).toBe("cell_3d_view");
  Vitest.expect(Ask.cellName("class")).toBe("cell");
  Vitest.expect(Ask.cellName("sketcher_board")).toBe("cell");
});

Vitest.test("an answer that redefines a global gets one more try", async () => {
  const texts: string[] = [];
  const answers = [answer("np = 1\nnp", ["np"]), answer("_y = np.sin(1)\n_y")];
  const result = await Ask.run(
    request(),
    async (body) => {
      texts.push(body.text);
      return reply(answers[texts.length - 1]);
    },
    new AbortController().signal,
  );
  Vitest.expect(result.code).toBe("_y = np.sin(1)\n_y");
  Vitest.expect(texts).toHaveLength(2);
  Vitest.expect(texts[1]).toContain("`np`, which other cells already define");
});

Vitest.test("host errors and malformed answers explain themselves", async () => {
  const signal = new AbortController().signal;
  await Vitest.expect(
    Ask.run(request(), async () => ({ error: "not_found" }), signal),
  ).rejects.toThrow("Couldn't find Claude Code");
  await Vitest.expect(
    Ask.run(request(), async () => reply({ code: 1 }), signal),
  ).rejects.toThrow("wasn't a cell");
});

const slider = {
  name: "amp",
  code: "amp = mo.ui.slider(0, 10)\namp",
  defs: ["amp"],
  refs: ["mo"],
};
const chart = {
  name: "chart",
  code: "_x = np.arange(10)\nalt.Chart()",
  defs: [],
  refs: ["np", "alt"],
};
const connect = (overrides: Partial<Ask.ConnectRequest> = {}): Ask.ConnectRequest => ({
  prompt: "scale the samples by it",
  context: "iVBOR",
  source: slider,
  sink: chart,
  cells: [
    { name: "setup", code: "import numpy as np", defs: ["np"], refs: [] },
    slider,
    chart,
  ],
  variables: [{ name: "amp", type: "UISlider", preview: "3" }],
  helpers: [],
  mode: "connect",
  ...overrides,
});
const connectAnswer = (
  overrides: Partial<Ask.ConnectAnswer> = {},
): Ask.ConnectAnswer => ({
  sink_code: "alt.Chart(samples)",
  source_code: "",
  helpers: [
    { name: "samples", code: "samples = np.random.normal(scale=amp.value, size=500)" },
  ],
  label: "amp via samples",
  defines: ["samples"],
  ...overrides,
});

Vitest.test(
  "a connect request names the source and sink and shows both in full",
  () => {
    const text = Ask.describeConnect(connect());
    Vitest.expect(text).toContain("Request: scale the samples by it");
    Vitest.expect(text).toContain(
      "from the cell `amp` (the source) to the cell `chart` (the sink)",
    );
    Vitest.expect(text).toContain("The source defines: amp.");
    Vitest.expect(text).toContain("Sink `chart`:\n```python\n_x = np.arange(10)");
    Vitest.expect(text).toMatch(/Globals of other cells \(.*\): np\n/);
    Vitest.expect(Ask.describeConnect(connect({ prompt: "" }))).toContain(
      "Request: (none: pick",
    );
    const again = Ask.describeConnect(
      connect({ helpers: [{ name: "samples", code: "samples = 1" }] }),
    );
    Vitest.expect(again).toContain(
      "The connection has these helper cells now: `samples`",
    );
    Vitest.expect(again).toContain("Helper `samples`:");
    Vitest.expect(Ask.describeConnect(connect({ mode: "disconnect" }))).toContain(
      "Mode: disconnect.",
    );
  },
);

Vitest.test(
  "a connection must read from the source, through a helper if need be",
  () => {
    Vitest.expect(Ask.connectProblem(connectAnswer(), connect())).toBeNull();
    Vitest.expect(
      Ask.connectProblem(
        connectAnswer({ helpers: [], sink_code: "alt.Chart()" }),
        connect(),
      ),
    ).toContain("Nothing reads from `amp`");
    // A source with no global of its own can get one.
    const unnamed = connect({ source: { ...slider, defs: [] } });
    Vitest.expect(
      Ask.connectProblem(
        connectAnswer({
          source_code: "amp = mo.ui.slider(0, 10)\namp",
          defines: ["amp", "samples"],
        }),
        unnamed,
      ),
    ).toBeNull();
  },
);

Vitest.test(
  "helper names must be free, and nothing may redefine another cell's globals",
  () => {
    Vitest.expect(
      Ask.connectProblem(connectAnswer(), connect(), (n) => n === "samples"),
    ).toContain("A cell called `samples` already exists");
    // Unless it's one of the connection's own helpers.
    Vitest.expect(
      Ask.connectProblem(
        connectAnswer(),
        connect({ helpers: [{ name: "samples", code: "samples = 1" }] }),
        (n) => n === "samples",
      ),
    ).toBeNull();
    Vitest.expect(
      Ask.connectProblem(
        connectAnswer({ helpers: [{ name: "import", code: "x = amp.value" }] }),
        connect(),
      ),
    ).toContain("isn't a usable helper cell name");
    Vitest.expect(
      Ask.connectProblem(connectAnswer({ defines: ["np", "samples"] }), connect()),
    ).toContain("`np`");
  },
);

Vitest.test("disconnecting must leave the sink without the source", () => {
  const request = connect({ mode: "disconnect" });
  Vitest.expect(
    Ask.connectProblem(connectAnswer({ sink_code: "alt.Chart(amp.value)" }), request),
  ).toContain("still reads `amp`");
  Vitest.expect(
    Ask.connectProblem(connectAnswer({ sink_code: "alt.Chart(3)" }), request),
  ).toBeNull();
});

Vitest.test(
  "connecting retries once when the answer doesn't read the source",
  async () => {
    const replies = [
      connectAnswer({ helpers: [], sink_code: "alt.Chart()" }),
      connectAnswer(),
    ];
    const sent: { text: string; mode?: string }[] = [];
    const answer = await Ask.runConnect(
      connect(),
      async (body) => (sent.push(body), reply(replies[sent.length - 1])),
      new AbortController().signal,
    );
    Vitest.expect(answer.helpers.map((h) => h.name)).toEqual(["samples"]);
    Vitest.expect(sent.map((b) => b.mode)).toEqual(["connect", "connect"]);
    Vitest.expect(sent[1].text).toContain(
      "Your previous answer had a problem: Nothing reads from `amp`",
    );
  },
);
