/** Keep rich output markup and styles inside an independent shadow tree. @module */
import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const sheets = new Map<string, CSSStyleSheet>();
const frame = `
:host { display: block; min-width: 0; }
:host > .marimo {
  width: 100%;
  min-width: 0;
  margin: 0;
  background: transparent;
}
.output > .markdown > :first-child { margin-block-start: 0; }
.output > .markdown > :last-child { margin-block-end: 0; }
`;

export function ShadowOutput({ css, children }: { css: string; children: ReactNode }) {
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const shadow = element.shadowRoot ?? element.attachShadow({ mode: "open" });
      if ("adoptedStyleSheets" in shadow && "replaceSync" in CSSStyleSheet.prototype) {
        let sheet = sheets.get(css);
        if (!sheet) {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(css + frame);
          sheets.set(css, sheet);
        }
        shadow.adoptedStyleSheets = [sheet];
      } else if (!shadow.querySelector("style")) {
        const style = document.createElement("style");
        style.textContent = css + frame;
        shadow.append(style);
      }
      setRoot(shadow);
    },
    [css],
  );
  return (
    <div ref={attach} className="moku-rich-output">
      {root && createPortal(children, root)}
    </div>
  );
}
