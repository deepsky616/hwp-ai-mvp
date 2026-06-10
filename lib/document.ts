export type ParagraphBlock = {
  type: "paragraph";
  id: string;
  sectionIndex: number;
  paragraphIndex: number;
  length: number;
  text: string;
};

export type TableCellBlock = {
  type: "tableCell";
  id: string;
  sectionIndex: number;
  parentParagraphIndex: number;
  controlIndex: number;
  cellIndex: number;
  cellParagraphIndex: number;
  length: number;
  text: string;
  rows?: number;
  cols?: number;
};

export type DocumentBlock = ParagraphBlock | TableCellBlock;

export type ParagraphPatch = {
  type: "paragraph";
  sectionIndex: number;
  paragraphIndex: number;
  text: string;
};

export type TableCellPatch = {
  type: "tableCell";
  sectionIndex: number;
  parentParagraphIndex: number;
  controlIndex: number;
  cellIndex: number;
  cellParagraphIndex: number;
  text: string;
};

export type DocumentPatch = ParagraphPatch | TableCellPatch;

// AI가 생성한 패치는 신뢰할 수 없다. 좌표가 실제 추출 블록과 정확히 일치하고
// 타입·정수 좌표·text 길이가 유효한 패치만 통과시켜, 모델 환각으로 인한
// 엉뚱한 위치 오적용을 방지한다.
const MAX_PATCH_TEXT_LENGTH = 100_000;

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function matchesBlock(patch: DocumentPatch, block: DocumentBlock): boolean {
  if (patch.type !== block.type) return false;
  if (patch.type === "paragraph" && block.type === "paragraph") {
    return patch.sectionIndex === block.sectionIndex && patch.paragraphIndex === block.paragraphIndex;
  }
  if (patch.type === "tableCell" && block.type === "tableCell") {
    return (
      patch.sectionIndex === block.sectionIndex &&
      patch.parentParagraphIndex === block.parentParagraphIndex &&
      patch.controlIndex === block.controlIndex &&
      patch.cellIndex === block.cellIndex &&
      patch.cellParagraphIndex === block.cellParagraphIndex
    );
  }
  return false;
}

function isValidPatch(raw: unknown): raw is DocumentPatch {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;
  if (typeof p.text !== "string" || p.text.length > MAX_PATCH_TEXT_LENGTH) return false;
  if (p.type === "paragraph") {
    return isNonNegativeInt(p.sectionIndex) && isNonNegativeInt(p.paragraphIndex);
  }
  if (p.type === "tableCell") {
    return (
      isNonNegativeInt(p.sectionIndex) &&
      isNonNegativeInt(p.parentParagraphIndex) &&
      isNonNegativeInt(p.controlIndex) &&
      isNonNegativeInt(p.cellIndex) &&
      isNonNegativeInt(p.cellParagraphIndex)
    );
  }
  return false;
}

function patchKey(patch: DocumentPatch): string {
  if (patch.type === "paragraph") {
    return `p:${patch.sectionIndex}:${patch.paragraphIndex}`;
  }
  return `c:${patch.sectionIndex}:${patch.parentParagraphIndex}:${patch.controlIndex}:${patch.cellIndex}:${patch.cellParagraphIndex}`;
}

export function validatePatches(rawPatches: unknown, blocks: DocumentBlock[]): DocumentPatch[] {
  if (!Array.isArray(rawPatches)) return [];
  const valid = rawPatches.filter(
    (raw): raw is DocumentPatch => isValidPatch(raw) && blocks.some((block) => matchesBlock(raw, block)),
  );
  // 같은 좌표를 가리키는 중복 패치는 마지막 것만 남겨, 적용 시 앞 패치가
  // 덮여 사라지는 비결정적 동작을 막는다.
  const deduped = new Map<string, DocumentPatch>();
  for (const patch of valid) deduped.set(patchKey(patch), patch);
  return [...deduped.values()];
}

export function buildTableMatrix(cells: TableCellBlock[]): string[][] {
  const cols = Math.max(1, ...cells.map((c) => c.cols ?? 1));
  const rows = Math.max(1, ...cells.map((c) => c.rows ?? Math.ceil((c.cellIndex + 1) / cols)));
  const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
  for (const cell of cells) {
    const row = Math.floor(cell.cellIndex / cols);
    const col = cell.cellIndex % cols;
    if (row < rows && col < cols) {
      matrix[row][col] = [matrix[row][col], cell.text.trim()].filter(Boolean).join(" ");
    }
  }
  return matrix;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeCell(value: string): string {
  return value.replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("|", "\\|").trim();
}

export function blocksToMarkdown(blocks: DocumentBlock[]): string {
  const lines: string[] = ["# 변환된 HWP 문서", ""];
  const usedTableCells = new Set<string>();

  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = block.text.trim();
      if (text) {
        lines.push(text, "");
      }
      continue;
    }

    const tableKey = `${block.sectionIndex}:${block.parentParagraphIndex}:${block.controlIndex}`;
    if (usedTableCells.has(tableKey)) continue;
    usedTableCells.add(tableKey);

    const tableCells = blocks
      .filter((item): item is TableCellBlock => item.type === "tableCell")
      .filter(
        (item) =>
          item.sectionIndex === block.sectionIndex &&
          item.parentParagraphIndex === block.parentParagraphIndex &&
          item.controlIndex === block.controlIndex,
      );

    const matrix = buildTableMatrix(tableCells);

    lines.push(`## 표 ${usedTableCells.size}`, "");
    lines.push(`| ${matrix[0].map(normalizeCell).join(" | ")} |`);
    lines.push(`| ${matrix[0].map(() => "---").join(" | ")} |`);
    for (const row of matrix.slice(1)) {
      lines.push(`| ${row.map(normalizeCell).join(" | ")} |`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function blocksToHtml(blocks: DocumentBlock[]): string {
  const body: string[] = [];
  const usedTableCells = new Set<string>();

  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = block.text.trim();
      if (text) body.push(`<p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>`);
      continue;
    }

    const tableKey = `${block.sectionIndex}:${block.parentParagraphIndex}:${block.controlIndex}`;
    if (usedTableCells.has(tableKey)) continue;
    usedTableCells.add(tableKey);

    const tableCells = blocks
      .filter((item): item is TableCellBlock => item.type === "tableCell")
      .filter(
        (item) =>
          item.sectionIndex === block.sectionIndex &&
          item.parentParagraphIndex === block.parentParagraphIndex &&
          item.controlIndex === block.controlIndex,
      );

    const matrix = buildTableMatrix(tableCells);

    body.push(
      `<table>${matrix
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`)
        .join("")}</table>`,
    );
  }

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>변환된 HWP 문서</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.7; max-width: 920px; margin: 40px auto; padding: 0 20px; color: #172033; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    td, th { border: 1px solid #cbd5e1; padding: 8px 10px; vertical-align: top; }
    tr:first-child td { background: #f1f5f9; font-weight: 700; }
  </style>
</head>
<body>
${body.join("\n")}
</body>
</html>
`;
}
