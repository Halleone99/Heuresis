/**
 * Alternate note layouts are projections of one Markdown body.
 * This splitter never writes or transforms the saved note.
 * Level-one/two headings begin a panel; two or more empty lines also begin
 * a new panel for notes made of loose blocks (as in OneNote).
 */
export type NoteSection = { id: number; title: string; body: string; named: boolean };

export function splitNoteSections(markdown: string): NoteSection[] {
  const chunks: string[] = [];
  let lines: string[] = [];
  let blanks: string[] = [];
  const finish = () => {
    const text = lines.join("\n").trim();
    if (text) chunks.push(text);
    lines = [];
    blanks = [];
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      if (lines.length) blanks.push(line);
      continue;
    }
    // A heading or a deliberately large gap begins another visual panel.
    if (lines.length && (/^#{1,2}\s+\S/.test(line) || blanks.length >= 2)) finish();
    else if (blanks.length) lines.push(...blanks);
    blanks = [];
    lines.push(line);
  }
  finish();
  return chunks.map((chunk, id) => {
    const [first, ...rest] = chunk.split("\n");
    const heading = first.match(/^#{1,2}\s+(.+)$/);
    return {
      id,
      title: heading ? heading[1] : "Panel " + (id + 1),
      body: heading ? rest.join("\n").trim() : chunk,
      named: Boolean(heading),
    };
  });
}
