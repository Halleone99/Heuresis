/**
 * WOFF 1.0 → SFNT (TrueType/OpenType) for embedding in PDFs.
 * Each table is zlib-compressed independently (https://www.w3.org/TR/WOFF/);
 * decompression uses the platform's DecompressionStream("deflate"), available in
 * Chromium, WebView2 and Android System WebView.
 */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This device cannot prepare fonts for PDF export.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function woffToSfnt(input: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  if (view.getUint32(0) !== 0x774f4646) {
    // Already an SFNT (TrueType 0x00010000, 'true' or 'OTTO').
    return bytes;
  }
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);
  const tables: Array<{ tag: number; checksum: number; data: Uint8Array }> = [];
  for (let index = 0; index < numTables; index += 1) {
    const at = 44 + index * 20;
    const tag = view.getUint32(at);
    const offset = view.getUint32(at + 4);
    const compLength = view.getUint32(at + 8);
    const origLength = view.getUint32(at + 12);
    const checksum = view.getUint32(at + 16);
    const raw = bytes.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await inflate(raw) : raw;
    if (data.length !== origLength) throw new Error("A font file is damaged.");
    tables.push({ tag, checksum, data });
  }
  let size = 12 + 16 * numTables;
  for (const table of tables) size += (table.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const outView = new DataView(out.buffer);
  let selector = 0;
  while ((1 << (selector + 1)) <= numTables) selector += 1;
  const searchRange = (1 << selector) * 16;
  outView.setUint32(0, flavor);
  outView.setUint16(4, numTables);
  outView.setUint16(6, searchRange);
  outView.setUint16(8, selector);
  outView.setUint16(10, numTables * 16 - searchRange);
  let offset = 12 + 16 * numTables;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    outView.setUint32(record, table.tag);
    outView.setUint32(record + 4, table.checksum);
    outView.setUint32(record + 8, offset);
    outView.setUint32(record + 12, table.data.length);
    out.set(table.data, offset);
    offset += (table.data.length + 3) & ~3;
  });
  return out;
}

/** "U+0000-00FF,U+0131" → [[0, 255], [305, 305]] */
export function parseUnicodeRanges(ranges: string): Array<[number, number]> {
  return ranges.split(",").map((part) => part.trim().replace(/^U\+/i, "")).filter(Boolean).map((part) => {
    if (part.includes("?")) return [parseInt(part.replace(/\?/g, "0"), 16), parseInt(part.replace(/\?/g, "F"), 16)] as [number, number];
    const [start, end] = part.split("-");
    const a = parseInt(start, 16);
    return [a, end ? parseInt(end, 16) : a] as [number, number];
  });
}
