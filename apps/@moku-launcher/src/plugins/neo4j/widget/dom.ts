/** Small DOM builders for the widget, which renders without a framework. @module */

type Child = Node | string | null | undefined | false;

/** Attributes set with `setAttribute`, skipping `undefined` and `false`. */
type Attributes = Readonly<Record<string, string | number | boolean | undefined>>;

function build<E extends Element>(
  element: E,
  attributes: Attributes,
  children: readonly Child[],
): E {
  for (const [name, value] of Object.entries(attributes))
    if (value !== undefined && value !== false)
      element.setAttribute(name, value === true ? "" : String(value));
  for (const child of children)
    if (child !== null && child !== undefined && child !== false) element.append(child);
  return element;
}

/** Creates an HTML element with attributes and children. */
export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: readonly Child[]
): HTMLElementTagNameMap[K] {
  return build(document.createElement(tag), attributes, children);
}

/** Creates an SVG element with attributes and children. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: readonly Child[]
): SVGElementTagNameMap[K] {
  return build(
    document.createElementNS("http://www.w3.org/2000/svg", tag),
    attributes,
    children,
  );
}
