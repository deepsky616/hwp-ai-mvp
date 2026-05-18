import { describe, expect, it } from "vitest";
import { blocksToHtml, blocksToMarkdown, type DocumentBlock } from "./document";

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
