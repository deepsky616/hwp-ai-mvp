import { describe, expect, it } from "vitest";
import { blocksToHtml, blocksToMarkdown, buildTableMatrix, validatePatches, type DocumentBlock, type TableCellBlock } from "./document";

const blocks: DocumentBlock[] = [
  {
    type: "paragraph",
    id: "p-0-0",
    sectionIndex: 0,
    paragraphIndex: 0,
    length: 7,
    text: "안내문",
  },
  {
    type: "tableCell",
    id: "c-0-1-0-0-0",
    sectionIndex: 0,
    parentParagraphIndex: 1,
    controlIndex: 0,
    cellIndex: 0,
    cellParagraphIndex: 0,
    length: 2,
    text: "항목",
    rows: 2,
    cols: 2,
  },
  {
    type: "tableCell",
    id: "c-0-1-0-1-0",
    sectionIndex: 0,
    parentParagraphIndex: 1,
    controlIndex: 0,
    cellIndex: 1,
    cellParagraphIndex: 0,
    length: 2,
    text: "내용",
    rows: 2,
    cols: 2,
  },
  {
    type: "tableCell",
    id: "c-0-1-0-2-0",
    sectionIndex: 0,
    parentParagraphIndex: 1,
    controlIndex: 0,
    cellIndex: 2,
    cellParagraphIndex: 0,
    length: 2,
    text: "일시",
    rows: 2,
    cols: 2,
  },
  {
    type: "tableCell",
    id: "c-0-1-0-3-0",
    sectionIndex: 0,
    parentParagraphIndex: 1,
    controlIndex: 0,
    cellIndex: 3,
    cellParagraphIndex: 0,
    length: 11,
    text: "오늘 오후",
    rows: 2,
    cols: 2,
  },
];

describe("문서 변환기", () => {
  it("본문과 표를 마크다운으로 변환합니다", () => {
    const markdown = blocksToMarkdown(blocks);

    expect(markdown).toContain("# 변환된 HWP 문서");
    expect(markdown).toContain("안내문");
    expect(markdown).toContain("| 항목 | 내용 |");
    expect(markdown).toContain("| 일시 | 오늘 오후 |");
  });

  it("본문과 표를 HTML로 변환합니다", () => {
    const html = blocksToHtml(blocks);

    expect(html).toContain('<html lang="ko">');
    expect(html).toContain("<p>안내문</p>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>오늘 오후</td>");
  });
});

describe("validatePatches", () => {
  it("추출 블록과 좌표가 일치하는 유효한 패치만 통과시킨다", () => {
    const patches = [
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: "수정된 안내문" },
      {
        type: "tableCell",
        sectionIndex: 0,
        parentParagraphIndex: 1,
        controlIndex: 0,
        cellIndex: 1,
        cellParagraphIndex: 0,
        text: "수정된 내용",
      },
    ];
    const result = validatePatches(patches, blocks);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "paragraph", paragraphIndex: 0, text: "수정된 안내문" });
  });

  it("추출 블록에 없는 좌표의 패치는 제거한다(모델 환각 방지)", () => {
    const patches = [
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 99, text: "존재하지 않는 문단" },
    ];
    expect(validatePatches(patches, blocks)).toHaveLength(0);
  });

  it("음수 좌표나 비정수 좌표 패치를 제거한다", () => {
    const patches = [
      { type: "paragraph", sectionIndex: 0, paragraphIndex: -1, text: "x" },
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 1.5, text: "x" },
    ];
    expect(validatePatches(patches, blocks)).toHaveLength(0);
  });

  it("text가 문자열이 아니거나 과도하게 길면 제거한다", () => {
    const patches = [
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: 123 },
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: "a".repeat(100_001) },
    ];
    expect(validatePatches(patches, blocks)).toHaveLength(0);
  });

  it("배열이 아닌 입력은 빈 배열로 처리한다", () => {
    expect(validatePatches(null, blocks)).toEqual([]);
    expect(validatePatches({ patches: [] }, blocks)).toEqual([]);
  });

  it("같은 좌표의 중복 패치는 마지막 것만 남긴다(덮어쓰기 방지)", () => {
    const patches = [
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: "첫 번째" },
      { type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: "두 번째" },
    ];
    const result = validatePatches(patches, blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("두 번째");
  });
});

describe("buildTableMatrix", () => {
  it("셀 목록으로 2×2 행렬을 만든다", () => {
    const cells: TableCellBlock[] = [
      { type: "tableCell", id: "a", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 0, cellParagraphIndex: 0, length: 2, text: "A", rows: 2, cols: 2 },
      { type: "tableCell", id: "b", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 1, cellParagraphIndex: 0, length: 2, text: "B", rows: 2, cols: 2 },
      { type: "tableCell", id: "c", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 2, cellParagraphIndex: 0, length: 2, text: "C", rows: 2, cols: 2 },
      { type: "tableCell", id: "d", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 3, cellParagraphIndex: 0, length: 2, text: "D", rows: 2, cols: 2 },
    ];
    expect(buildTableMatrix(cells)).toEqual([["A", "B"], ["C", "D"]]);
  });
});
