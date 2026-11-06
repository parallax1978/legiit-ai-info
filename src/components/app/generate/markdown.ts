/*
  A small markdown parser for the install instructions: headings, paragraphs,
  bullet and numbered lists, fenced code, pipe tables, and inline code, bold,
  and links. Pure, no dependency; markdown-view.tsx renders the blocks.
  Anything it does not know is a paragraph.
*/

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Block =
  | { type: "heading"; level: HeadingLevel; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "code"; text: string; lang: string | null }
  | { type: "table"; header: InlineNode[]; rows: InlineNode[][][] };

const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/(?!\/))/i;

/** Only web links, mail links, and paths on this site render as links; anything else stays text. */
export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href.trim());
}

const INLINE = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += t;
    else out.push({ type: "text", text: t });
  };
  let last = 0;
  // matchAll runs on its own copy of the regex, so the recursion below cannot reset this loop.
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) pushText(text.slice(last, m.index));
    if (m[2] !== undefined) out.push({ type: "code", text: m[2] });
    else if (m[3] !== undefined) out.push({ type: "strong", children: parseInline(m[3]) });
    else if (m[4] !== undefined && m[5] !== undefined) {
      if (isSafeHref(m[5])) out.push({ type: "link", href: m[5].trim(), children: parseInline(m[4]) });
      else pushText(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}

const FENCE_OPEN = /^\s*```\s*([\w+-]*)\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^:?-+:?$/;

function tableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: code.join("\n"), lang: fence[1] || null });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length as HeadingLevel, children: parseInline(heading[2]) });
      continue;
    }

    if (RULE.test(line)) {
      flush();
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const items: string[] = [item[3]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextItem = ITEM.exec(next);
        if (nextItem && (nextItem[2] !== undefined) === ordered) {
          items.push(nextItem[3]);
          i++;
          continue;
        }
        // An indented line continues the item above it.
        if (!nextItem && next.trim() && /^\s{2,}/.test(next)) {
          items[items.length - 1] += ` ${next.trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items: items.map(parseInline) });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const cells = tableCells(lines[i]);
        if (!cells.every((c) => TABLE_SEPARATOR.test(c))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) {
        blocks.push({
          type: "table",
          header: rows[0].map((c) => ({ type: "text", text: c })),
          rows: rows.slice(1).map((r) => r.map(parseInline)),
        });
      }
      continue;
    }

    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
