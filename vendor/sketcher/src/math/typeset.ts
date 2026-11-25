// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/math/typeset.ts. Edit it there and rerun scripts/sketcher.ts.
// LaTeX typesetting with MathJax (TeX in, self-contained SVG out). Synchronous once loaded.
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
// The TeX packages people use for handwritten math (AllPackages would triple the bundle).
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/braket/BraketConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/cases/CasesConfiguration.js";
import "mathjax-full/js/input/tex/centernot/CenternotConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/enclose/EncloseConfiguration.js";
import "mathjax-full/js/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "mathjax-full/js/input/tex/upgreek/UpgreekConfiguration.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

/** Typeset math: an SVG whose size is given in em (multiply by the font size for canvas units). */
export interface Typeset {
  svg: string;
  /** Width and height in em. */
  w: number;
  h: number;
}

type Doc = ReturnType<typeof mathjax.document>;
let doc: Doc | null = null;
let adaptor: ReturnType<typeof liteAdaptor> | null = null;

function document_(): Doc {
  if (!doc) {
    adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    // Without noerrors/noundefined, bad input throws instead of rendering a red box,
    // which is how invalid LaTeX is detected (and shown as source text instead).
    const packages = [
      "base", "ams", "boldsymbol", "braket", "cancel", "cases", "centernot", "color", "enclose", "extpfeil",
      "gensymb", "mathtools", "newcommand", "textmacros", "upgreek",
    ];
    const tex = new TeX({
      packages,
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    });
    const svg = new SVG({ fontCache: "local" });
    doc = mathjax.document("", { InputJax: tex, OutputJax: svg });
  }
  return doc;
}

const cache = new Map<string, Typeset | null>();

/** Typesets display-style LaTeX, or returns null if it doesn't parse. Cached. */
export function typeset(latex: string): Typeset | null {
  const key = latex.trim();
  if (cache.has(key)) return cache.get(key)!;
  let result: Typeset | null = null;
  if (key) {
    try {
      const d = document_();
      const node = d.convert(key, { display: true });
      const svgNode = adaptor!.firstChild(node) as never;
      const viewBox = String(adaptor!.getAttribute(svgNode, "viewBox") ?? "").split(/\s+/).map(Number);
      const html = adaptor!.outerHTML(svgNode);
      // MathJax's viewBox is in thousandths of an em.
      if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 && !html.includes("data-mjx-error")) {
        result = { svg: html, w: viewBox[2] / 1000, h: viewBox[3] / 1000 };
      }
    } catch {
      result = null;
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
}

/** Whether MathJax can typeset `latex`. Empty input is not valid. */
export const isValidLatex = (latex: string): boolean => typeset(latex) !== null;

/** The SVG at a given pixel size and color (the root tag's own size and style are replaced). */
export function sizedSVG(t: Typeset, width: number, height: number, color: string): string {
  const open = t.svg.slice(0, t.svg.indexOf(">"));
  const attrs = open.replace(/^<svg/, "").replace(/\s(width|height|style|color)="[^"]*"/g, "");
  return `<svg width="${width}" height="${height}" color="${color}" style="color:${color}"${attrs}${t.svg.slice(open.length)}`;
}
