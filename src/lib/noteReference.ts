import { entryTitle, isDocument, normaliseSearch, type KnowledgeEntry, type KnowledgeTopic } from "./knowledgeWorkspace";
import { inlinePlain, parseBlocks, pinyinSegments, type Block } from "./noteFormat";
import { quickQueueKind } from "./quickQueue";

const HAN = /\p{Script=Han}/u;

export function referenceTerms(query: string) {
  return normaliseSearch(query).split(" ").filter(Boolean);
}

export function matchesReference(text: string, terms: string[]) {
  const normalised = normaliseSearch(text);
  return terms.every((term) => normalised.includes(term));
}

function blockText(block: Block): string {
  switch (block.type) {
    case "p": case "h2": case "h3": case "h4": return inlinePlain(block.text);
    case "ul": case "ol": return block.items.map((item) => inlinePlain(item.text)).join(" ");
    case "quote": case "callout": return parseBlocks(block.lines.join("\n")).map(blockText).join(" ");
    case "table": return [block.headers, ...block.rows].flat().map(inlinePlain).join(" ");
    default: return "";
  }
}

export function noteReferenceText(entry: KnowledgeEntry) {
  return [entryTitle(entry), quickQueueKind(entry) ? "" : entry.description, ...parseBlocks(entry.body).map(blockText)].join(" ");
}

export function findNotebookLink(target: string, topicId: string, entries: KnowledgeEntry[], topics: ReadonlyMap<string, KnowledgeTopic>) {
  const wanted = target.toLocaleLowerCase();
  const subjectId = topics.get(topicId)?.subject_id;
  const matches = entries.filter((row) => isDocument(row) && entryTitle(row).toLocaleLowerCase() === wanted);
  return matches.find((row) => topics.get(row.topic_id)?.subject_id === subjectId) ?? matches[0];
}

export type ReferenceGroup = {
  id: number;
  blocks: Block[];
  text: string;
  section: string;
  phrase: boolean;
};

export function referenceGroups(markdown: string): ReferenceGroup[] {
  const blocks = parseBlocks(markdown);
  const groups: ReferenceGroup[] = [];
  let section = "";
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const plain = blockText(block).trim();
    if (block.type === "p" && !plain) continue;
    if (block.type === "h2" || block.type === "h3" || block.type === "h4") {
      section = plain;
      groups.push({ id: i, blocks: [block], text: plain, section, phrase: false });
      continue;
    }
    const id = i;
    const phrase = block.type === "p" && HAN.test(plain) && /^\p{Script=Han}/u.test(plain);
    const content = [block];
    if (phrase) {
      // Existing lesson notes often have a blank line between Hanzi and Pinyin.
      const nextIndex = blocks[i + 1]?.type === "p" && !blockText(blocks[i + 1]).trim() ? i + 2 : i + 1;
      const next = blocks[nextIndex];
      if (next?.type === "p") {
        const reading = blockText(next);
        if (!HAN.test(reading) && pinyinSegments(reading).some((part) => part.pinyin)) {
          content.push(next);
          i = nextIndex;
        }
      }
    }
    groups.push({ id, blocks: content, text: content.map(blockText).join(" "), section, phrase });
  }
  return groups;
}

export function filterReferenceGroups(groups: ReferenceGroup[], terms: string[]): ReferenceGroup[] {
  if (!terms.length) return groups;
  return groups.flatMap((group) => {
    const [block] = group.blocks;
    if (block.type === "table") {
      const context = `${group.section} ${block.headers.map(inlinePlain).join(" ")}`;
      if (matchesReference(context, terms)) return [group];
      const rows = block.rows.filter((row) => matchesReference(`${context} ${row.map(inlinePlain).join(" ")}`, terms));
      return rows.length ? [{ ...group, blocks: [{ ...block, rows }] }] : [];
    }
    return matchesReference(`${group.section} ${group.text}`, terms) ? [group] : [];
  });
}
