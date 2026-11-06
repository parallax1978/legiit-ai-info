import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { parseMarkdown, type Block, type InlineNode } from "./markdown";

/*
  Renders the instructions markdown with the product's type styles. No
  dependency: markdown.ts parses, this file maps blocks to elements. Links to
  other sites open in a new tab.
*/

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return <span key={i}>{node.text}</span>;
          case "code":
            return (
              <code key={i} className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em] text-ink">
                {node.text}
              </code>
            );
          case "strong":
            return (
              <strong key={i} className="font-semibold text-ink">
                <Inline nodes={node.children} />
              </strong>
            );
          case "link": {
            const external = /^https?:\/\//i.test(node.href);
            return (
              <a
                key={i}
                href={node.href}
                {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="font-medium text-brand underline-offset-2 hover:underline"
              >
                <Inline nodes={node.children} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

const HEADINGS: Record<number, { tag: "h2" | "h3" | "h4"; className: string }> = {
  1: { tag: "h2", className: "mt-8 text-xl first:mt-0" },
  2: { tag: "h3", className: "mt-6 text-lg first:mt-0" },
  3: { tag: "h4", className: "mt-5 text-base first:mt-0" },
};

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case "heading": {
      const { tag: Tag, className } = HEADINGS[Math.min(block.level, 3)];
      return (
        <Tag className={className}>
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="mt-3 leading-6 text-ink">
          <Inline nodes={block.children} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("mt-3 space-y-1.5 pl-5 leading-6 text-ink", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs leading-5 text-ink">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} scope="col" className="border-b border-line py-2 pr-4 font-semibold text-ink">
                    <Inline nodes={[cell]} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-line py-2 pr-4 align-top text-ink">
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <div className={cn("text-sm", className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
