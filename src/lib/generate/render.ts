/*
  The page HTML and the WordPress HTML from one draft. See docs/build-spec.md
  and examples/legiit-about-page.html; the schema+render builder replaces the stubs.
*/
import type { RenderInput } from "./types";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderPageHtml(input: RenderInput): string {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(input.draft.metaTitle)}</title></head><body><main><article><h1>${escapeHtml(input.draft.title)}</h1></article></main></body></html>\n`;
}

export function renderWordpressHtml(input: RenderInput): string {
  return `<h1>${escapeHtml(input.draft.title)}</h1>\n`;
}
