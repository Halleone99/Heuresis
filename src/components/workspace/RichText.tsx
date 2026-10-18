import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { CALLOUTS, parseBlocks, parseInline, pinyinSegments, type Block, type ListItem } from "../../lib/noteFormat";

export type LinkResolver = (target: string) => { exists: boolean; open: () => void };

/** Render romanized Mandarin with a known Unicode-complete typeface, while
 * keeping the notebook's serif typography for Hanzi and English prose. */
/** Preserve the source text while giving Hanzi a legible reading size. */
function HanziAware({ text }: { text: string }) {
  return <>{text.split(/(\p{Script=Han}+)/gu).map((part, index) =>
    /\p{Script=Han}/u.test(part) ? <span key={index} className="nb-hanzi" lang="zh">{part}</span>
      : <span key={index}>{part}</span>)}</>;
}
function PinyinAware({ text }: { text: string }) {
  return <>{pinyinSegments(text).map(({ text: segment, pinyin }, index) =>
    pinyin ? <span key={index} className="nb-pinyin" lang="zh-Latn">{segment}</span>
      : <HanziAware key={index} text={segment}/>
  )}</>;
}

function InlineText({ text, resolve }: { text: string; resolve?: LinkResolver }) {
  return <>{parseInline(text).map((part, index) => {
    if (part.type === "strong") return <strong key={index}><InlineText text={part.text} resolve={resolve} /></strong>;
    if (part.type === "em") return <em key={index}><InlineText text={part.text} resolve={resolve} /></em>;
    if (part.type === "mark") return <mark key={index}><InlineText text={part.text} resolve={resolve} /></mark>;
    if (part.type === "strike") return <s key={index}><InlineText text={part.text} resolve={resolve} /></s>;
    if (part.type === "colour") return <span key={index} data-ink={part.colour}><InlineText text={part.text} resolve={resolve}/></span>;
    if (part.type === "tint") return <mark key={index} data-tone={part.colour}><InlineText text={part.text} resolve={resolve}/></mark>;
    if (part.type === "link") {
      const link = resolve?.(part.target);
      return <button type="button" key={index} className={`nb-wikilink ${link?.exists ? "" : "is-missing"}`}
        title={link?.exists ? `Open “${part.target}”` : `Create a note called “${part.target}”`}
        onClick={(event) => { event.stopPropagation(); link?.open(); }}>{part.label}</button>;
    }
    return <span key={index}><PinyinAware text={part.text} /></span>;
  })}</>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="nb-copy" aria-label="Copy example" title="Copy"
    onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }).catch(() => undefined);
    }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>;
}

function renderList(items: ListItem[], resolve?: LinkResolver) {
  type Node = { item: ListItem; children: Node[] };
  const root: Node[] = [];
  const stack: Array<{ depth: number; children: Node[] }> = [{ depth: -1, children: root }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) stack.pop();
    const node: Node = { item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ depth: item.depth, children: node.children });
  }
  const render = (nodes: Node[], key: string): ReactNode => {
    const ordered = nodes[0]?.item.ordered;
    const Tag = ordered ? "ol" : "ul";
    return <Tag key={key}>{nodes.map((node, index) => <li key={index}>
      <InlineText text={node.item.text} resolve={resolve} />
      {node.children.length ? render(node.children, `${key}-${index}`) : null}
    </li>)}</Tag>;
  };
  return render(root, "list");
}

/** Examples are written as groups of lines: sentence, then reading, then meaning. */
function exampleGroups(lines: string[]) {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line.trim()) { if (current.length) groups.push(current); current = []; continue; }
    current.push(line);
  }
  if (current.length) groups.push(current);
  return groups;
}

function rubyEligible(lines: string[]) {
  // An explicit three-line Chinese example: original, pinyin, translation.
  return lines.length >= 3 && /\p{Script=Han}/u.test(lines[0])
    && !/\p{Script=Han}/u.test(lines[1]) && /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/iu.test(lines[1]);
}
function BlockView({ block, resolve, rubyPinyin = false }: {
  block: Block; resolve?: LinkResolver; rubyPinyin?: boolean;
}) {
  switch (block.type) {
    case "h2": return <h2><InlineText text={block.text} resolve={resolve} /></h2>;
    case "h3": return <h3><InlineText text={block.text} resolve={resolve} /></h3>;
    case "hr": return <hr />;
    case "ul": case "ol": return <>{renderList(block.items, resolve)}</>;
    case "quote": return <blockquote>{parseBlocks(block.lines.join("\n")).map((inner, index) => <BlockView key={index} block={inner} resolve={resolve} rubyPinyin={rubyPinyin} />)}</blockquote>;
    case "callout": {
      if (block.variant === "example") {
        return <aside className="nb-callout" data-callout="example">
          <span className="nb-callout-label">{CALLOUTS.example}</span>
          {exampleGroups(block.lines).map((group, index) => {
            const showRuby = rubyPinyin && rubyEligible(group);
            return <div className="nb-example" key={index}>
              <p className="nb-example-main">{showRuby
                ? <ruby className="nb-ruby-phrase"><span lang="zh"><InlineText text={group[0]} resolve={resolve}/></span><rt lang="zh-Latn">{group[1]}</rt></ruby>
                : <InlineText text={group[0]} resolve={resolve} />}</p>
              {group.slice(showRuby ? 2 : 1).map((line, lineIndex) =>
                <p key={lineIndex} className={!showRuby && lineIndex === 0 && group.length > 2 ? "nb-example-reading" : "nb-example-meaning"}>
                  <InlineText text={line} resolve={resolve} /></p>)}
              <CopyButton text={group.join("\n")}/>
            </div>;
          })}
        </aside>;
      }
      return <aside className="nb-callout" data-callout={block.variant}>
        <span className="nb-callout-label">{CALLOUTS[block.variant]}</span>
        {parseBlocks(block.lines.join("\n")).map((inner, index) => <BlockView key={index} block={inner} resolve={resolve} />)}
      </aside>;
    }
    default: return block.text.trim() ? <p><InlineText text={block.text} resolve={resolve} /></p> : <div className="nb-gap" aria-hidden="true" />;
  }
}

type FoldNode = { kind: "item"; block: Block } | {
  kind: "section"; heading: Extract<Block, { type: "h2" | "h3" }>; children: FoldNode[];
};

/** Section headings fold their following text, with subheadings nested naturally. */
function groupHeadings(blocks: Block[]): FoldNode[] {
  const root: FoldNode[] = [];
  let firstLevel: FoldNode[] = root;
  let secondLevel: FoldNode[] | null = null;
  for (const block of blocks) {
    if (block.type === "h2") {
      const section: FoldNode = { kind: "section", heading: block, children: [] };
      root.push(section); firstLevel = section.children; secondLevel = null;
    } else if (block.type === "h3") {
      const section: FoldNode = { kind: "section", heading: block, children: [] };
      firstLevel.push(section); secondLevel = section.children;
    } else {
      (secondLevel ?? firstLevel).push({ kind: "item", block });
    }
  }
  return root;
}

function FoldView({ node, resolve, rubyPinyin }: { node: FoldNode; resolve?: LinkResolver; rubyPinyin: boolean }) {
  const [open, setOpen] = useState(true);
  if (node.kind === "item") return <BlockView block={node.block} resolve={resolve} rubyPinyin={rubyPinyin}/>;
  const Heading = node.heading.type === "h2" ? "h2" : "h3";
  return <section className={`nb-fold ${open ? "is-open" : "is-closed"}`}>
    <Heading className="nb-fold-heading">
      <span className="nb-fold-title">
        <button type="button" className="nb-fold-toggle" aria-expanded={open}
          aria-label={open ? "Collapse section" : "Expand section"}
          title={open ? "Collapse section" : "Expand section"} onClick={() => setOpen((value) => !value)}>
          <ChevronRight size={15} aria-hidden="true"/>
        </button>
        <span><InlineText text={node.heading.text} resolve={resolve}/></span>
      </span>
    </Heading>
    {open ? <div className="nb-fold-content">{node.children.map((child, index) =>
      <FoldView key={index} node={child} resolve={resolve} rubyPinyin={rubyPinyin}/>)}</div> : null}
  </section>;
}

export function RichText({ text, resolve, className = "", rubyPinyin = false, collapsible = false }: { text: string; resolve?: LinkResolver; className?: string; rubyPinyin?: boolean; collapsible?: boolean }) {
  const blocks = parseBlocks(text);
  return <div className={`nb-prose ${className}`}>
    {collapsible ? groupHeadings(blocks).map((node, index) =>
      <FoldView key={index} node={node} resolve={resolve} rubyPinyin={rubyPinyin}/>) :
      blocks.map((block, index) => <BlockView key={index} block={block} resolve={resolve} rubyPinyin={rubyPinyin}/>)}
  </div>;
}

