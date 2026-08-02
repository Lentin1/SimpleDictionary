export type PdfWordSense = {
  part: string;
  meaning: string;
};

export type PdfImportedWord = {
  id: number;
  chapter: string;
  word: string;
  phonetic: string;
  part: string;
  meaning: string;
  senses?: PdfWordSense[];
  definition: string;
  example: string;
  translation: string;
  tag: string;
};

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
};

function normalizePart(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[.。]/g, "");
  const aliases: Record<string, string> = {
    noun: "n.",
    n: "n.",
    名词: "n.",
    adjective: "adj.",
    adj: "adj.",
    形容词: "adj.",
    verb: "v.",
    v: "v.",
    vt: "vt.",
    vi: "vi.",
    "vt/vi": "vt./vi.",
    动词: "v.",
  };
  return aliases[normalized] ?? (value.trim().endsWith(".") ? value.trim() : `${value.trim()}.`);
}

function joinPdfFragments(items: PdfTextItem[]) {
  return items
    .sort((left, right) => right.y - left.y || left.x - right.x)
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join("")
    .trim();
}

function groupPdfItemsByBaseline(items: PdfTextItem[]) {
  const groups: Array<{ y: number; items: PdfTextItem[] }> = [];
  items.slice().sort((left, right) => right.y - left.y || left.x - right.x).forEach((item) => {
    const group = groups.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ y: item.y, items: [item] });
    }
  });
  return groups;
}

function extractPdfSenses(partItems: PdfTextItem[], meaningItems: PdfTextItem[]) {
  const partRows = groupPdfItemsByBaseline(partItems);
  const meaningRows = groupPdfItemsByBaseline(meaningItems);
  if (partRows.length < 2 || partRows.length !== meaningRows.length) return [];

  const usedMeaningRows = new Set<number>();
  const senses = partRows.map((partRow) => {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    meaningRows.forEach((meaningRow, index) => {
      if (usedMeaningRows.has(index)) return;
      const distance = Math.abs(partRow.y - meaningRow.y);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    if (nearestIndex < 0 || nearestDistance > 18) return null;
    usedMeaningRows.add(nearestIndex);
    const part = joinPdfFragments(partRow.items);
    const meaning = joinPdfFragments(meaningRows[nearestIndex].items).replace(/[;；]+$/g, "").trim();
    return part && meaning ? { part: normalizePart(part), meaning } : null;
  });
  return senses.every((sense): sense is PdfWordSense => Boolean(sense)) ? senses : [];
}

function pdfRowBounds(rowY: number, previousY: number | undefined, nextY: number | undefined) {
  const upper = previousY === undefined ? rowY + 20 : (previousY + rowY) / 2;
  const lower = nextY === undefined ? rowY - 24 : (nextY + rowY) / 2;
  return { upper, lower };
}

export async function parsePdfImport(file: Blob, startId: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  const imported: PdfImportedWord[] = [];
  let currentChapter = "未分组";

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => {
      if (!("str" in item) || typeof item.str !== "string" || !Array.isArray(item.transform)) return [];
      return [{ str: item.str, x: item.transform[4], y: item.transform[5] } satisfies PdfTextItem];
    });
    const rowMarkers = items
      .filter((item) => item.x >= 35 && item.x < 65 && /^\d{1,2}$/.test(item.str.trim()))
      .map((item) => ({ number: Number(item.str.trim()), y: item.y }))
      .filter((row) => row.number >= 1 && row.number <= 99)
      .sort((left, right) => right.y - left.y);
    const phoneticColumnX = items
      .filter((item) => item.x >= 110 && item.x < 220 && /[\[\/]/.test(item.str))
      .map((item) => item.x)
      .sort((left, right) => left - right)[0];
    const wordColumnEnd = phoneticColumnX === undefined ? 140 : phoneticColumnX - 4;
    const partColumnX = items
      .filter((item) => item.x >= 200 && item.x < 330 && /^(?:n|v|adj|adv|vt|vi|prep|pron|conj|num|det|aux|art|modal)/i.test(item.str.trim()))
      .map((item) => item.x)
      .sort((left, right) => left - right)[0];
    const phoneticMinX = phoneticColumnX === undefined ? 110 : phoneticColumnX - 2;
    const phoneticMaxX = partColumnX === undefined ? phoneticMinX + 100 : partColumnX - 10;
    const wordRows = rowMarkers.filter((row) => {
      const hasWord = items.some((item) => item.x >= 60 && item.x < wordColumnEnd && Math.abs(item.y - row.y) <= 10);
      const hasPhonetic = items.some((item) => item.x >= phoneticMinX && item.x < phoneticMaxX && Math.abs(item.y - row.y) <= 10 && /[\[\/]/.test(item.str));
      return hasWord && hasPhonetic;
    });
    const meaningColumnX = partColumnX === undefined ? 253 : partColumnX + 8;
    const chapterHeading = items
      .map((item) => item.str.trim().match(/^List\s+0*(\d{1,2})$/i))
      .find((match): match is RegExpMatchArray => Boolean(match));
    if (chapterHeading && wordRows.length) currentChapter = `List ${chapterHeading[1].padStart(2, "0")}`;

    wordRows.forEach((row) => {
      const rowIndex = rowMarkers.indexOf(row);
      const { upper, lower } = pdfRowBounds(row.y, rowMarkers[rowIndex - 1]?.y, rowMarkers[rowIndex + 1]?.y);
      const inRow = items.filter((item) => item.y < upper && item.y > lower);
      const word = joinPdfFragments(inRow.filter((item) => item.x >= 60 && item.x < wordColumnEnd));
      const phonetic = joinPdfFragments(inRow.filter((item) => item.x >= phoneticMinX && item.x < phoneticMaxX && /[\[\/]/.test(item.str)));
      const partItems = inRow.filter((item) => partColumnX !== undefined && Math.abs(item.x - partColumnX) <= 3 && /^(?:n|v|adj|adv|vt|vi|prep|pron|conj|num|det|aux|art|modal)/i.test(item.str.trim()));
      const meaningItems = inRow.filter((item) => item.x >= meaningColumnX && item.x < meaningColumnX + 112);
      const part = joinPdfFragments(partItems);
      const meaning = joinPdfFragments(meaningItems);
      const senses = extractPdfSenses(partItems, meaningItems);
      if (!word || !phonetic) return;
      imported.push({
        id: startId + imported.length,
        chapter: currentChapter,
        word,
        phonetic,
        part: senses.length ? senses.map((sense) => sense.part).join(" ") : part ? normalizePart(part) : "n.",
        meaning: senses.length ? senses.map((sense) => sense.meaning).join("；") : meaning || "（PDF 未识别释义）",
        senses: senses.length ? senses : undefined,
        definition: "",
        example: "",
        translation: "",
        tag: currentChapter.toLowerCase().startsWith("list") ? "TOEFL" : "自定义",
      });
    });
  }

  return { imported, errors: imported.length ? [] : ["没有在 PDF 中识别到词条，请确认 PDF 是可复制文本而不是扫描图片"] };
}
