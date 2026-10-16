/** Sections in a reference are ordinary Markdown headings. No second document store. */
export type ReferenceChapter = { title: string; content: string; position: number };

export function parseReferenceChapters(body: string): ReferenceChapter[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const chapters: ReferenceChapter[] = [];
  let title = "Introduction";
  let content: string[] = [];
  let hasHeading = false;
  function flush() {
    const text = content.join("\n").trim();
    if (text || hasHeading || chapters.length === 0) {
      chapters.push({ title, content: text, position: chapters.length });
    }
    content = [];
  }
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (hasHeading || content.some((part) => part.trim())) flush();
      title = match[1].replace(/[*_`]/g, "").trim() || "Untitled chapter";
      hasHeading = true;
    } else content.push(line);
  }
  flush();
  return chapters;
}

export function referenceSummary(body: string): string {
  return body.split("\n")
    .filter((line) => !/^\s*#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*>]\s*/, "").replace(/[*_`\[\]]/g, "").trim())
    .find((line) => Boolean(line))?.slice(0, 160) ?? "";
}
