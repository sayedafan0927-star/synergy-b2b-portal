/**
 * Lightweight zero-dependency browser .xlsx reader using Web Compression Streams API.
 * Extracts text rows from xl/sharedStrings.xml and xl/worksheets/sheet1.xml.
 */

async function inflateRaw(data: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported in this browser');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  return await new Response(ds.readable).text();
}

function colRefToIndex(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) return -1;
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export async function parseXlsxFileToLines(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');

  // 1. Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minEocd = Math.max(0, buffer.byteLength - 65557);
  for (let i = buffer.byteLength - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid XLSX archive (EOCD not found)');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map<string, { method: number; compSize: number; dataStart: number }>();
  let pos = cdOffset;

  for (let i = 0; i < totalEntries && pos + 46 <= buffer.byteLength; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);

    const fileName = decoder.decode(new Uint8Array(buffer, pos + 46, nameLen));
    if (localOffset + 30 <= buffer.byteLength && view.getUint32(localOffset, true) === 0x04034b50) {
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      entries.set(fileName, { method, compSize, dataStart });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }

  const readEntryXml = async (name: string): Promise<string | null> => {
    const entry = entries.get(name);
    if (!entry || entry.dataStart + entry.compSize > buffer.byteLength) return null;
    const slice = new Uint8Array(buffer, entry.dataStart, entry.compSize);
    if (entry.method === 0) return decoder.decode(slice);
    if (entry.method === 8) return await inflateRaw(slice);
    return null;
  };

  // 2. Parse sharedStrings.xml if present
  const sharedStrings: string[] = [];
  const sharedXml = await readEntryXml('xl/sharedStrings.xml');
  const domParser = new DOMParser();

  if (sharedXml) {
    const doc = domParser.parseFromString(sharedXml, 'application/xml');
    const siNodes = Array.from(doc.getElementsByTagName('si'));
    for (const si of siNodes) {
      const tNodes = Array.from(si.getElementsByTagName('t'));
      sharedStrings.push(tNodes.map(t => t.textContent || '').join(''));
    }
  }

  // 3. Locate first worksheet XML
  const sheetKey =
    (entries.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : null) ||
    Array.from(entries.keys()).find(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k));

  if (!sheetKey) {
    throw new Error('Worksheet XML not found in XLSX');
  }

  const sheetXml = await readEntryXml(sheetKey);
  if (!sheetXml) {
    throw new Error('Unable to decompress worksheet XML');
  }

  const sheetDoc = domParser.parseFromString(sheetXml, 'application/xml');
  const rowNodes = Array.from(sheetDoc.getElementsByTagName('row'));
  const lines: string[] = [];

  for (const row of rowNodes) {
    const cellNodes = Array.from(row.getElementsByTagName('c'));
    if (cellNodes.length === 0) continue;
    const cols: string[] = [];

    cellNodes.forEach((cell, fallbackIdx) => {
      const ref = cell.getAttribute('r') || '';
      const colIdx = ref ? colRefToIndex(ref) : fallbackIdx;
      const cellType = cell.getAttribute('t') || '';
      let val = '';

      if (cellType === 'inlineStr') {
        const tNodes = Array.from(cell.getElementsByTagName('t'));
        val = tNodes.map(t => t.textContent || '').join('');
      } else {
        const vNode = cell.getElementsByTagName('v')[0];
        const rawVal = vNode?.textContent?.trim() || '';
        if (cellType === 's') {
          const sIdx = parseInt(rawVal, 10);
          val = !isNaN(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : rawVal;
        } else {
          val = rawVal;
        }
      }

      const targetCol = colIdx >= 0 && colIdx < 32 ? colIdx : cols.length;
      while (cols.length <= targetCol) cols.push('');
      cols[targetCol] = val.trim();
    });

    const nonEmpty = cols.filter(Boolean);
    if (nonEmpty.length > 0) {
      lines.push(cols.slice(0, 4).filter((_, idx) => idx < 3 || Boolean(cols[idx])).join(';'));
    }
  }

  return lines;
}
