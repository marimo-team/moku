/**
 * Runs one board for one notebook: loads it from the board cell, writes it back, turns asks
 * into cells, and keeps cards and cells in step (see {@link reconcile}).
 *
 * React only renders what goes inside the cards (through portals) and the status bar.
 *
 * @module
 */
import { Effect, Predicate } from "effect";
import { AsyncResult } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import * as Ask from "./ask.ts";
import * as Board from "./board.ts";
import * as Debug from "./debug.ts";
import {
  type CellInfo,
  type Owner,
  codeOf,
  freshName,
  helperOf,
  helpersOf,
  ownersOf,
  reconcile,
  staleCode,
} from "./reconcile.ts";
import {
  type Appearance,
  type AskRequest,
  type AskResult,
  type AskSideUpdate,
  type ConnectRequest,
  type ConnectResult,
  type Drawing,
  type EmbedItem,
  type EmbedOutput,
  type LinkItem,
  Sketcher,
  emptyDrawing,
} from "sketcher";
import { dataflow } from "./wires.ts";

/** A card's content element, for React to portal into. */
export interface Card {
  readonly id: string;
  readonly ref: string;
  readonly el: HTMLElement;
}

/** Whether the board has reached the notebook file. */
export type SaveState =
  | { readonly kind: "saved" | "unsaved" | "saving" }
  | { readonly kind: "error"; readonly message: string };

export interface Callbacks {
  readonly cards: (cards: ReadonlyMap<string, Card>) => void;
  readonly save: (state: SaveState) => void;
  /** Something went wrong outside of an ask (running cells, writing the board). */
  readonly problem: (message: string | null) => void;
  /** The board's own light/dark button. */
  readonly appearance: (appearance: Appearance) => void;
  /** A double-click on a card's header. */
  readonly open: (item: EmbedItem) => void;
  /** A double-click on a link, or Show Code from its menu. */
  readonly openLink: (link: LinkItem) => void;
  /** The Debug agent's progress. */
  readonly debug: (state: Debug.DebugState) => void;
}

const WRITE_DELAY = 400;
/** How long cells must keep failing before the board sends the agent (a rerun may be on its way). */
const AUTO_DEBUG_DELAY = 2000;
const SAVE_DELAY = 1500;

export class Controller {
  readonly sketcher: Sketcher;
  private readonly registry: Document.Interface["registry"];
  private readonly cards = new Map<string, Card>();
  /** What owns cells (cards and links' helpers) as of the last change, to see what an edit did. */
  private owners: readonly Owner[];
  /** The analysis and cards the wires were last worked out from. */
  private wiresKey = "";
  /** The board cell's code as last written or read, to tell our writes from others'. */
  private written: string | null;
  private writeTimer = 0;
  private saveTimer = 0;
  private writing = false;
  private applying = false;
  private destroyed = false;
  private readonly unsubscribe: () => void;
  private debugState: Debug.DebugState = { kind: "idle" };
  private debugAbort: AbortController | null = null;
  /** Cells failing now, as last reported by the view. */
  private failing: readonly (Debug.CellError & { code: string })[] = [];
  /** Failures the agent was already sent for, and how often each cell was tried. */
  private readonly autoSeen = new Set<string>();
  private readonly autoAttempts = new Map<string, number>();
  private autoTimer = 0;
  /** Fix failing cells on their own (the person can turn it off in the status bar). */
  autoDebug = true;

  private constructor(
    host: HTMLElement,
    private readonly notebook: Notebook.Interface,
    private readonly document: Document.Interface,
    drawing: Drawing,
    boardCode: string | null,
    appearance: Appearance,
    private readonly callbacks: Callbacks,
    private readonly transport: Ask.Transport,
    private readonly debugTransport: Debug.DebugTransport,
  ) {
    this.registry = document.registry;
    this.owners = ownersOf(drawing.embeds, drawing.links);
    this.written = boardCode;
    this.sketcher = new Sketcher(host, {
      drawing,
      appearance,
      fileName: "Drawing",
      onChange: (next) => this.changed(next),
      onAppearanceChange: (a) => callbacks.appearance(a),
      mountEmbed: (item, el) => this.mount(item, el),
      ask: (request) => this.ask(request),
      onEmbedOpen: (item) => callbacks.open(item),
      connect: (request) => this.connect(request),
      describeEmbed: (item) => this.describeEmbed(item),
      disconnect: (link, signal) => this.disconnect(link, signal),
      onLinkOpen: (link) => callbacks.openLink(link),
    });
    const offDocument = this.registry.subscribe(document.state, () => {
      this.documentChanged();
      this.updateWires();
    });
    const offNotebook = this.registry.subscribe(notebook.state, () =>
      this.updateWires(),
    );
    this.unsubscribe = () => {
      offDocument();
      offNotebook();
    };
  }

  /** Reads the board cell (if any) and mounts the board in `host`. */
  static async open(options: {
    host: HTMLElement;
    notebook: Notebook.Interface;
    document: Document.Interface;
    appearance: Appearance;
    callbacks: Callbacks;
    transport?: Ask.Transport;
    debugTransport?: Debug.DebugTransport;
  }): Promise<Controller> {
    const code =
      boardCell(options.document.registry.get(options.document.state))?.code ?? null;
    let drawing = emptyDrawing();
    let problem: string | null = null;
    if (code) {
      try {
        drawing = await Board.decode(code);
      } catch (error) {
        problem = `Couldn't read the board cell, so this is a blank board. ${message(error)}`;
      }
    }
    const controller = new Controller(
      options.host,
      options.notebook,
      options.document,
      drawing,
      problem ? null : code,
      options.appearance,
      options.callbacks,
      options.transport ?? Ask.fetchTransport,
      options.debugTransport ?? Debug.fetchDebug,
    );
    options.callbacks.problem(problem);
    // Keys (tools, ⌘K) go to the board straight away.
    controller.sketcher.root.focus({ preventScroll: true });
    controller.runOnOpen();
    controller.updateWires();
    return controller;
  }

  destroy(): void {
    this.destroyed = true;
    this.debugAbort?.abort();
    clearTimeout(this.autoTimer);
    clearTimeout(this.writeTimer);
    clearTimeout(this.saveTimer);
    this.unsubscribe();
    // Don't lose the last few strokes.
    if (this.writeTimer) void this.write();
    this.sketcher.destroy();
  }

  // MARK: Debugging

  /**
   * Sends the Debug agent to work in the notebook's kernel: on what the person wrote, plus every
   * cell failing right now. One run at a time; a new one replaces a run in progress.
   */
  debug(
    note: string,
    {
      auto = false,
      errors = this.failing,
    }: { auto?: boolean; errors?: readonly Debug.CellError[] } = {},
  ): void {
    if (this.destroyed) return;
    this.debugAbort?.abort();
    const abort = new AbortController();
    this.debugAbort = abort;
    const about =
      note.trim() ||
      (errors.length > 0
        ? `${errors.map((e) => e.cell).join(", ")} ${errors.length > 1 ? "fail" : "fails"}`
        : "Looking for problems");
    let steps: string[] = [];
    const show = (kind: Debug.DebugRun["kind"], summary: string | null = null) => {
      if (this.debugAbort !== abort && kind === "running") return;
      this.debugState = { kind, auto, about, steps, summary };
      this.callbacks.debug(this.debugState);
    };
    show("running");
    const path =
      this.notebookState()?.notebook?.path ??
      this.notebookState()?.notebook?.name ??
      "";
    this.debugTransport(
      { path, note, errors: errors.map(({ cell, error }) => ({ cell, error })), auto },
      abort.signal,
      (event) => {
        if (event.type === "done") return;
        steps = [...steps, event.text].slice(-40);
        show("running");
      },
    ).then(
      (done) => {
        if (this.debugAbort !== abort) return;
        this.debugAbort = null;
        show(done.ok ? "done" : "failed", done.summary);
        // Whatever still fails after this run gets looked at again (up to the attempt limit).
        this.scheduleAutoDebug();
      },
      (error) => {
        if (this.debugAbort !== abort) return;
        this.debugAbort = null;
        show(
          abort.signal.aborted ? "stopped" : "failed",
          abort.signal.aborted ? "Stopped." : message(error),
        );
      },
    );
  }

  /** Stops the Debug agent. */
  stopDebug(): void {
    const abort = this.debugAbort;
    if (!abort) return;
    this.debugAbort = null;
    abort.abort();
    if (this.debugState.kind === "running") {
      this.debugState = { ...this.debugState, kind: "stopped", summary: "Stopped." };
      this.callbacks.debug(this.debugState);
    }
  }

  dismissDebug(): void {
    if (this.debugAbort) return;
    this.debugState = { kind: "idle" };
    this.callbacks.debug(this.debugState);
  }

  /**
   * The view reports the cells failing now (with their code, so a fix that changed the code
   * counts as a new attempt). New failures send the agent after a moment, unless it's busy.
   */
  reportErrors(errors: readonly (Debug.CellError & { code: string })[]): void {
    this.failing = errors;
    const failing = new Set(errors.map((e) => e.cell));
    // A cell that works again starts over.
    for (const cell of this.autoAttempts.keys())
      if (!failing.has(cell)) this.autoAttempts.delete(cell);
    this.scheduleAutoDebug();
  }

  private scheduleAutoDebug(): void {
    clearTimeout(this.autoTimer);
    if (!this.autoDebug || this.debugAbort || this.destroyed) return;
    if (Debug.autoTargets(this.failing, this.autoSeen, this.autoAttempts).length === 0)
      return;
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = 0;
      if (!this.autoDebug || this.debugAbort || this.destroyed) return;
      // Asks still running write cells that may fail for a moment; wait for them.
      if (this.sketcher.isConverting) return this.scheduleAutoDebug();
      const targets = Debug.autoTargets(this.failing, this.autoSeen, this.autoAttempts);
      if (targets.length === 0) return;
      for (const t of targets) {
        this.autoSeen.add(t.key);
        this.autoAttempts.set(t.cell, (this.autoAttempts.get(t.cell) ?? 0) + 1);
      }
      this.debug("", { auto: true, errors: targets });
    }, AUTO_DEBUG_DELAY);
  }

  /** The Debug agent on one card's error. */
  fix(id: string, error: string): void {
    const item = this.sketcher.getEmbeds().find((e) => e.id === id);
    this.debug("", { errors: item ? [{ cell: item.ref, error }] : this.failing });
  }

  /** Brings back a card's cell from the code the board kept. */
  recreate(id: string): void {
    const item = this.sketcher.getEmbeds().find((e) => e.id === id);
    if (!item) return;
    const code = codeOf(item);
    if (code === null) return;
    this.applyOps([{ kind: "create", name: item.ref, code }]);
    void this.runCells([item.ref]);
  }

  remove(id: string): void {
    this.sketcher.setSelection([id]);
    this.sketcher.deleteSelection();
  }

  /** Runs every cell, e.g. after the runtime restarted. */
  runAll(): void {
    void this.runCells(null);
  }

  // MARK: Cards

  private mount(item: EmbedItem, el: HTMLElement): () => void {
    this.cards.set(item.id, { id: item.id, ref: item.ref, el });
    this.callbacks.cards(new Map(this.cards));
    return () => {
      if (this.cards.get(item.id)?.el !== el) return;
      this.cards.delete(item.id);
      if (!this.destroyed) this.callbacks.cards(new Map(this.cards));
    };
  }

  private changed(drawing: Drawing): void {
    const prev = this.owners;
    this.owners = ownersOf(drawing.embeds, drawing.links);
    const cells = this.cellsByName();
    const plan = reconcile(
      prev,
      this.owners,
      cells,
      (name) => name === Board.CELL_NAME,
    );
    this.applying = true;
    try {
      this.applyOps(plan.ops);
    } finally {
      this.applying = false;
    }
    for (const { id, ref } of plan.renames) {
      const helper = helperOf(id);
      if (helper) this.renameHelper(helper.link, helper.name, ref);
      else this.sketcher.updateEmbed(id, { ref }, { undoable: false, name: "Rename" });
    }
    if (plan.run.length > 0) void this.runCells(plan.run);
    this.scheduleWrite();
  }

  private applyOps(ops: ReturnType<typeof reconcile>["ops"]): void {
    if (ops.length === 0) return;
    const doc = this.registry.get(this.document.state).document;
    if (!doc) return;
    const byName = new Map([...doc.cells.values()].map((c) => [c.name, c.id]));
    const board = byName.get(Board.CELL_NAME);
    this.document.edit((edit) => {
      for (const op of ops) {
        const id = byName.get(op.name);
        if (op.kind === "delete") {
          if (id) edit.deleteCell(id);
        } else if (id) {
          edit.setCode(id, op.code);
        } else {
          // New cells go above the board cell, which stays last.
          const created = edit.createCell(
            { code: op.code, name: op.name },
            board ? { before: board } : {},
          );
          byName.set(op.name, created);
        }
      }
    });
  }

  /** Edits made in other views flow back into the cards, so undo can restore them. */
  private documentChanged(): void {
    if (this.applying || this.destroyed) return;
    const state = this.registry.get(this.document.state);
    const code = boardCell(state)?.code ?? null;
    if (
      code !== null &&
      code !== this.written &&
      !this.writing &&
      !this.writeTimer &&
      !this.sketcher.isConverting
    ) {
      // Someone else changed the board (another client, or the file was reverted).
      this.written = code;
      Board.decode(code).then(
        (drawing) => {
          if (this.destroyed || this.written !== code) return;
          this.owners = ownersOf(drawing.embeds, drawing.links);
          this.sketcher.setDrawing(drawing);
        },
        () => {},
      );
      return;
    }
    const drawing = this.sketcher.getDrawing();
    for (const { id, code: fresh } of staleCode(
      ownersOf(drawing.embeds, drawing.links),
      this.cellsByName(),
    )) {
      const helper = helperOf(id);
      if (helper) {
        this.patchHelpers(
          helper.link,
          (h) => (h.name === helper.name ? { ...h, code: fresh } : h),
          "Sync Code",
        );
        continue;
      }
      const item = this.sketcher.getEmbeds().find((e) => e.id === id)!;
      this.sketcher.updateEmbed(
        id,
        { data: { ...item.data, code: fresh } },
        { undoable: false, name: "Sync Code" },
      );
    }
  }

  private renameHelper(linkId: string, from: string, to: string): void {
    this.patchHelpers(
      linkId,
      (h) => (h.name === from ? { ...h, name: to } : h),
      "Rename",
    );
  }

  /** Changes a link's helpers in step with the notebook (not something to undo). */
  private patchHelpers(
    linkId: string,
    patch: (helper: Ask.HelperCell) => Ask.HelperCell,
    name: string,
  ): void {
    const link = this.sketcher.getLinks().find((l) => l.id === linkId);
    if (!link) return;
    this.sketcher.updateLink(
      linkId,
      { data: { ...link.data, helpers: helpersOf(link).map(patch) } },
      { undoable: false, name },
    );
  }

  // MARK: Asking

  private async ask(request: AskRequest): Promise<AskResult> {
    const state = this.notebookState();
    const cells = this.cellContexts(state);
    const card = request.embeds.length === 1 ? request.embeds[0] : null;
    const target = card ? (cells.find((c) => c.name === card.ref) ?? null) : null;
    const answer = await Ask.run(
      {
        prompt: request.prompt,
        png: request.png,
        context: request.context,
        size: request.size,
        cells,
        variables: this.variables(state),
        target,
        selected: request.embeds.map((e) => e.ref),
        arrows: request.arrows.map((a) => ({
          from: a.from?.ref ?? null,
          to: a.to?.ref ?? null,
        })),
      },
      this.transport,
      request.signal,
      () => this.cellContexts(this.notebookState()),
    );
    const askId = crypto.randomUUID();
    // Other cards the answer rewires (an arrow from the new cell into them). Cells without a
    // card aren't the board's to change.
    const updates = (answer.updates ?? []).flatMap((u) => {
      const item = this.sketcher
        .getEmbeds()
        .find((e) => e.ref === u.name && e.id !== card?.id);
      if (!item || !u.code.trim()) return [];
      return [
        {
          id: item.id,
          data: {
            ...item.data,
            code: u.code,
            askId: crypto.randomUUID(),
            prompt: request.prompt,
          },
        },
      ];
    });
    if (card && target && answer.action === "edit") {
      return {
        kind: "update",
        updates,
        id: card.id,
        title: answer.title.trim() || card.title,
        data: {
          ...card.data,
          code: answer.code,
          defines: answer.defines,
          askId,
          prompt: request.prompt,
        },
      };
    }
    const taken = new Set([
      ...this.cellsByName().keys(),
      ...this.sketcher.getEmbeds().map((e) => e.ref),
      Board.CELL_NAME,
    ]);
    const name = freshName(Ask.cellName(answer.name), (n) => taken.has(n));
    return {
      kind: "insert",
      updates,
      ref: name,
      title: answer.title.trim() || name,
      data: {
        code: answer.code,
        defines: answer.defines,
        askId,
        prompt: request.prompt,
      },
    };
  }

  // MARK: Connecting

  /** A wire from one card to another: Claude rewrites the sink (and maybe adds helper cells). */
  private async connect(request: ConnectRequest): Promise<ConnectResult> {
    const state = this.notebookState();
    const cells = this.cellContexts(state);
    const source = cells.find((c) => c.name === request.from.ref);
    const sink = cells.find((c) => c.name === request.to.ref);
    if (!source || !sink) {
      return {
        kind: "none",
        message: `The cell \`${(source ? request.to : request.from).ref}\` isn't in the notebook any more. Bring it back first.`,
      };
    }
    const helpers = request.link ? helpersOf(request.link) : [];
    const answer = await Ask.runConnect(
      {
        prompt: request.prompt,
        context: request.context,
        source,
        sink,
        cells,
        variables: this.variables(state),
        helpers,
        mode: "connect",
      },
      this.transport,
      request.signal,
      (name) => this.nameTaken(name),
    );
    // Helper names the notebook doesn't have yet (the connection's own ones can stay).
    const own = new Set(helpers.map((h) => h.name));
    const used = new Set<string>();
    const fresh = answer.helpers
      .filter((h) => h.code.trim())
      .map((h) => {
        let name = Ask.cellName(h.name);
        if (!own.has(name) || used.has(name))
          name = freshName(
            name,
            (n) => used.has(n) || (!own.has(n) && this.nameTaken(n)),
          );
        used.add(name);
        return { name, code: h.code };
      });
    const before = request.link?.data ?? {};
    const sourceCode = answer.source_code.trim() ? answer.source_code : null;
    const updates: AskSideUpdate[] = [
      {
        id: request.to.id,
        data: {
          ...request.to.data,
          code: answer.sink_code,
          askId: crypto.randomUUID(),
          prompt: request.prompt,
        },
      },
      ...(sourceCode
        ? [
            {
              id: request.from.id,
              data: {
                ...request.from.data,
                code: sourceCode,
                askId: crypto.randomUUID(),
              },
            },
          ]
        : []),
    ];
    return {
      kind: "link",
      label: answer.label.trim(),
      updates,
      data: {
        askId: crypto.randomUUID(),
        prompt: request.prompt,
        helpers: fresh,
        // What disconnecting puts back: the code from before the first connection, if the cells
        // still hold what this one wrote.
        sinkBefore: Predicate.isString(before.sinkBefore)
          ? before.sinkBefore
          : sink.code,
        sinkCode: answer.sink_code,
        sourceBefore: Predicate.isString(before.sourceBefore)
          ? before.sourceBefore
          : sourceCode
            ? source.code
            : null,
        sourceCode:
          sourceCode ??
          (Predicate.isString(before.sourceCode) ? before.sourceCode : null),
      },
    };
  }

  /**
   * A link deleted on its own: its helper cells go with it (see reconcile), and the sink goes back
   * to its code from before the connection. If the sink was changed since, Claude takes the
   * connection out of it instead.
   */
  private async disconnect(
    link: LinkItem,
    signal: AbortSignal,
  ): Promise<AskSideUpdate[]> {
    const embeds = this.sketcher.getEmbeds();
    const from = embeds.find((e) => e.id === link.from);
    const to = embeds.find((e) => e.id === link.to);
    const data = link.data ?? {};
    const updates: AskSideUpdate[] = [];
    if (
      from &&
      Predicate.isString(data.sourceBefore) &&
      codeOf(from) === data.sourceCode
    ) {
      updates.push({
        id: from.id,
        data: { ...from.data, code: data.sourceBefore, askId: crypto.randomUUID() },
      });
    }
    if (!to || !Predicate.isString(data.sinkBefore)) return updates;
    if (codeOf(to) === data.sinkCode) {
      updates.push({
        id: to.id,
        data: { ...to.data, code: data.sinkBefore, askId: crypto.randomUUID() },
      });
      return updates;
    }
    const state = this.notebookState();
    const cells = this.cellContexts(state);
    const source = from && cells.find((c) => c.name === from.ref);
    const sink = cells.find((c) => c.name === to.ref);
    if (!source || !sink) return updates;
    const answer = await Ask.runConnect(
      {
        prompt: "",
        context: "",
        source,
        sink,
        cells,
        variables: this.variables(state),
        helpers: helpersOf(link),
        mode: "disconnect",
      },
      this.transport,
      signal,
    );
    updates.push({
      id: to.id,
      data: { ...to.data, code: answer.sink_code, askId: crypto.randomUUID() },
    });
    return updates;
  }

  /** What a card's cell offers other cells: its globals, with their values when the kernel has them. */
  private describeEmbed(item: EmbedItem): EmbedOutput[] {
    const state = this.notebookState();
    const cell = this.cellContexts(state).find((c) => c.name === item.ref);
    if (!cell) return [];
    const variables = new Map(this.variables(state).map((v) => [v.name, v]));
    return cell.defs
      .filter((name) => !name.startsWith("_"))
      .map((name) => {
        const v = variables.get(name);
        const detail = [v?.type, v?.preview].filter(Boolean).join(" = ");
        return {
          name,
          detail: detail.length > 40 ? `${detail.slice(0, 39)}…` : detail || undefined,
        };
      });
  }

  /**
   * Tells the board which cards depend on which, once marimo has analysed the notebook as it is
   * now. While edits are on their way the analysis is stale, and the wires stay as they were.
   */
  private updateWires(): void {
    if (this.destroyed) return;
    const draft = this.registry.get(this.document.state);
    const state = this.notebookState();
    const analysis = state?.analysis;
    const doc = draft.document;
    if (
      !analysis ||
      !doc ||
      draft.dirty ||
      analysis.document_etag !== state?.document?.etag
    )
      return;
    const refs = this.sketcher.getEmbeds().map((e) => e.ref);
    const key = `${analysis.document_etag}|${refs.join(",")}`;
    if (key === this.wiresKey) return;
    this.wiresKey = key;
    const flow = [...doc.cells.values()].flatMap((cell) => {
      const a = analysis.cells[cell.id];
      return a && cell.name !== Board.CELL_NAME && cell.name !== "_"
        ? [{ name: cell.name, defs: a.defs, refs: a.refs }]
        : [];
    });
    this.sketcher.setWires(dataflow(flow, new Set(refs)));
  }

  private nameTaken(name: string): boolean {
    return (
      name === Board.CELL_NAME ||
      this.cellsByName().has(name) ||
      this.sketcher.getEmbeds().some((e) => e.ref === name)
    );
  }

  private variables(state: Notebook.State | null): Ask.VariableContext[] {
    return Object.values(state?.variables ?? {}).map((v) => ({
      name: v.name,
      type: v.type,
      preview: v.preview,
    }));
  }

  private cellContexts(state: Notebook.State | null): Ask.CellContext[] {
    const doc = this.registry.get(this.document.state).document;
    if (!doc) return [];
    const analysis = state?.analysis?.cells ?? {};
    // A cell an ask just created isn't analysed yet; its card knows what it defines.
    const answered = new Map(
      this.sketcher
        .getEmbeds()
        .map((e) => [e.ref, e.data?.defines] as const)
        .filter((entry): entry is readonly [string, string[]] =>
          Array.isArray(entry[1]),
        ),
    );
    const out: Ask.CellContext[] = [];
    for (const id of doc.order) {
      const cell = doc.cells.get(id);
      if (
        !cell ||
        cell.code === null ||
        cell.name === Board.CELL_NAME ||
        Board.isBoard(cell.code)
      )
        continue;
      out.push({
        name: cell.name === "_" ? `(unnamed ${id})` : cell.name,
        code: cell.code,
        defs: analysis[id]?.defs ?? answered.get(cell.name) ?? [],
        refs: analysis[id]?.refs ?? [],
      });
    }
    return out;
  }

  // MARK: Running

  /** Runs these cells (by name), or all of them. Starts the runtime if needed. */
  private async runCells(names: readonly string[] | null): Promise<void> {
    const { document, notebook } = this;
    const program = Effect.gen(function* () {
      yield* document.flush;
      yield* notebook.ensureRunning;
      const confirmed = yield* document.flush;
      const cells =
        names === null
          ? confirmed.cells.filter((c) => !c.config.disabled)
          : confirmed.cells.filter((c) => names.includes(c.name));
      if (cells.length === 0) return;
      yield* notebook.runtime.run({ cells });
    });
    try {
      await Effect.runPromise(program);
      this.callbacks.problem(null);
    } catch (error) {
      if (!this.destroyed)
        this.callbacks.problem(`Couldn't run the cells. ${message(error)}`);
    }
  }

  /** Cards need outputs: on opening a board whose cells haven't run in this runtime, run them all. */
  private runOnOpen(): void {
    if (this.sketcher.getEmbeds().length === 0) return;
    const state = this.notebookState();
    const byName = this.cellsByName();
    const ran = new Set<string | null>(
      Object.values(state?.executions ?? {})
        .filter((e) => e.runtime_id !== null && e.runtime_id === state?.runtime?.id)
        .map((e) => e.cell_id),
    );
    if (this.sketcher.getEmbeds().some((e) => !ran.has(byName.get(e.ref)?.id ?? "")))
      this.runAll();
  }

  // MARK: Writing the board

  private scheduleWrite(): void {
    clearTimeout(this.writeTimer);
    this.callbacks.save({ kind: "unsaved" });
    this.writeTimer = window.setTimeout(() => void this.write(), WRITE_DELAY);
  }

  private async write(): Promise<void> {
    this.writeTimer = 0;
    this.writing = true;
    try {
      const code = await Board.encode(this.sketcher.getDrawing());
      if (code.length > Board.LARGE_BOARD) {
        this.callbacks.problem(
          "This board is getting large for a notebook file. Consider clearing old ink.",
        );
      }
      if (code === this.written) {
        // Nothing new (a card re-fitting itself on load, say).
        if (!this.saveTimer) this.callbacks.save({ kind: "saved" });
        return;
      }
      const doc = this.registry.get(this.document.state).document;
      if (!doc) return;
      const existing = boardCell(this.registry.get(this.document.state));
      this.document.edit((edit) => {
        if (existing) edit.setCode(existing.id, code);
        else
          edit.createCell({
            code,
            name: Board.CELL_NAME,
            config: { disabled: true, hide_code: true },
          });
      });
      this.written = code;
      this.scheduleSave();
    } catch (error) {
      this.callbacks.save({
        kind: "error",
        message: `Couldn't write the board. ${message(error)}`,
      });
    } finally {
      this.writing = false;
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    if (this.destroyed) {
      void this.save();
      return;
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      void this.save();
    }, SAVE_DELAY);
  }

  /** Writes the notebook file, if the host allows it. */
  private async save(): Promise<void> {
    if (!this.notebookState()?.notebook?.operations.includes("notebook.save")) {
      this.callbacks.save({ kind: "unsaved" });
      return;
    }
    const { document, notebook } = this;
    this.callbacks.save({ kind: "saving" });
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const confirmed = yield* document.flush;
          return yield* notebook.save(confirmed);
        }),
      );
      if (!this.writeTimer && !this.writing) this.callbacks.save({ kind: "saved" });
    } catch (error) {
      this.callbacks.save({
        kind: "error",
        message: `Couldn't save the notebook. ${message(error)}`,
      });
    }
  }

  // MARK: Helpers

  private notebookState(): Notebook.State | null {
    return AsyncResult.getOrElse(this.registry.get(this.notebook.state), () => null);
  }

  private cellsByName(): Map<string, CellInfo> {
    const doc = this.registry.get(this.document.state).document;
    const out = new Map<string, CellInfo>();
    for (const cell of doc?.cells.values() ?? []) {
      if (cell.name !== "_") out.set(cell.name, { id: cell.id, code: cell.code });
    }
    return out;
  }
}

function boardCell(state: Document.State): { id: string; code: string | null } | null {
  for (const cell of state.document?.cells.values() ?? []) {
    if (cell.name === Board.CELL_NAME) return { id: cell.id, code: cell.code };
  }
  return null;
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error);
}
