/*
  Node types and predicates for walking a cheerio document. cheerio's node
  types come from domhandler, which pnpm does not expose at the root, so they
  are derived from cheerio's own signatures here.
*/
import type { CheerioAPI } from "cheerio";

export type DomRoot = ReturnType<CheerioAPI["root"]>;
export type DomNode = ReturnType<DomRoot["contents"]>[number];
export type DomElement = ReturnType<DomRoot["find"]>[number];
export type DomText = Extract<DomNode, { nodeType: 3 }>;

export function isElement(node: DomNode | null | undefined): node is DomElement {
  if (!node) return false;
  const type: string = node.type;
  return type === "tag" || type === "script" || type === "style";
}

export function isText(node: DomNode | null | undefined): node is DomText {
  return !!node && node.nodeType === 3;
}

export function tagName(el: DomElement): string {
  return el.name.toLowerCase();
}

export function attr(el: DomElement, name: string): string | undefined {
  const value = el.attribs[name];
  return typeof value === "string" ? value : undefined;
}

/** Walks up the parent chain, nearest first, up to `max` elements. */
export function ancestors(el: DomElement, max = 20): DomElement[] {
  const out: DomElement[] = [];
  let node: DomNode | null = el.parent;
  while (node && out.length < max) {
    if (isElement(node)) out.push(node);
    node = node.parent;
  }
  return out;
}

/** The nearest ancestor (or the element itself) matching the predicate. */
export function closestElement(
  el: DomElement,
  match: (candidate: DomElement) => boolean,
  includeSelf = true,
): DomElement | null {
  if (includeSelf && match(el)) return el;
  for (const a of ancestors(el)) if (match(a)) return a;
  return null;
}

/** Class attribute split into tokens. */
export function classTokens(el: DomElement): string[] {
  return (attr(el, "class") ?? "").split(/\s+/).filter(Boolean);
}
