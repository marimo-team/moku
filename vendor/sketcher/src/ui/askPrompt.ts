// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/askPrompt.ts. Edit it there and rerun scripts/sketcher.ts.
import type { Rect } from "../core/geometry";
import { h, isolate, placePopover, shortcut } from "./dom";

export interface AskPromptActions {
  submit(prompt: string): void;
  cancel(): void;
}

/** Something to offer as a chip under the label, e.g. one of a card's outputs. */
export interface AskChip {
  /** Inserted into the text when clicked. */
  name: string;
  /** Shown after the name, e.g. a type or value. */
  detail?: string;
}

export interface AskPromptOptions {
  placeholder?: string;
  chips?: readonly AskChip[];
  /** What the Ask button says. */
  action?: string;
}

const PLACEHOLDER = "Describe it, or press ↩ to let Claude read the sketch";

/** A popover asking what the selection should become (or how a selected item should change). */
export class AskPrompt {
  readonly el: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly text: HTMLTextAreaElement;
  private readonly chips: HTMLDivElement;
  private readonly send: HTMLButtonElement;
  /** A failed ask, offered again so it's easy to retry. Empty after one that worked. */
  private last = "";

  constructor(private readonly host: HTMLElement, private readonly actions: AskPromptActions) {
    this.label = h("div", { class: "sk-ask-label" });
    this.text = h("textarea", {
      class: "sk-editor-text sk-ask-text", rows: "2", spellcheck: "true", "aria-label": "Ask Claude",
      placeholder: PLACEHOLDER,
    });
    this.chips = h("div", { class: "sk-ask-chips", hidden: "" });
    const cancel = h("button", { type: "button", class: "sk-editor-button" }, ["Cancel"]);
    const send = h("button", { type: "button", class: "sk-editor-button sk-primary", title: "↩" }, ["Ask"]);
    this.send = send;
    cancel.addEventListener("click", () => this.actions.cancel());
    send.addEventListener("click", () => this.submit());
    this.el = h("div", { class: "sk-editor sk-ask sk-glass", hidden: "" }, [
      this.label,
      this.chips,
      this.text,
      h("div", { class: "sk-editor-buttons" }, [
        h("span", { class: "sk-ask-hint" }, [`↩ to ask · ⇧↩ new line · ${shortcut("K")} opens this`]),
        cancel,
        send,
      ]),
    ]);
    this.el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.actions.cancel();
      } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit();
      }
    });
    isolate(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Shows the prompt next to `anchor` (view coordinates). `label` says what the answer will do. */
  open(label: string, anchor: Rect, options: AskPromptOptions = {}): void {
    this.label.textContent = label;
    this.text.placeholder = options.placeholder ?? PLACEHOLDER;
    this.send.textContent = options.action ?? "Ask";
    this.chips.replaceChildren(
      ...(options.chips ?? []).map((chip) => {
        const b = h("button", { type: "button", class: "sk-ask-chip", title: `Mention ${chip.name}` }, [
          h("code", {}, [chip.name]),
          ...(chip.detail ? [h("span", {}, [chip.detail])] : []),
        ]);
        b.addEventListener("click", () => this.insert(chip.name));
        return b;
      }),
    );
    this.chips.hidden = this.chips.childElementCount === 0;
    this.text.value = this.last;
    this.el.hidden = false;
    this.position(anchor);
    this.text.focus({ preventScroll: true });
    this.text.select();
  }

  /** Offers `prompt` again the next time the prompt opens (after an ask failed). */
  remember(prompt: string): void {
    this.last = prompt;
  }

  /** Opens empty next time (after an ask worked). */
  forget(): void {
    this.last = "";
  }

  close(): void {
    this.el.hidden = true;
  }

  position(anchor: Rect): void {
    placePopover(this.el, anchor, this.host);
  }

  /** Puts `name` in the text at the cursor, with spaces around it as needed. */
  private insert(name: string): void {
    const t = this.text;
    const start = t.selectionStart ?? t.value.length, end = t.selectionEnd ?? start;
    const before = t.value.slice(0, start), after = t.value.slice(end);
    const pre = before && !/\s$/.test(before) ? " " : "";
    const post = after && !/^\s/.test(after) ? " " : "";
    t.value = `${before}${pre}${name}${post}${after}`;
    const caret = before.length + pre.length + name.length + post.length;
    t.focus({ preventScroll: true });
    t.setSelectionRange(caret, caret);
  }

  /** Sends what's typed. Nothing typed is fine: Claude works it out from the sketch. */
  private submit(): void {
    this.actions.submit(this.text.value.trim());
  }
}
