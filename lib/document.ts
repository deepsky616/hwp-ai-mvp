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
