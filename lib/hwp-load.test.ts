import { describe, expect, it } from "vitest";
import { markdownToImportHtml, shouldUseTextImportFallback } from "./hwp-load";

describe("HWP 열기 오류 처리", () => {
  it("DocInfo UTF-16 대리쌍 오류는 텍스트 복구 가져오기 대상으로 분류합니다", () => {
    const message = "파일 로드 실패: 유효하지 않은 파일: DocInfo IO 오류: UTF-16 디코딩 실패: invaild utf-16: lose surrogate found";

    expect(shouldUseTextImportFallback(message)).toBe(true);
  });

  it("마크다운을 HWP 편집기에 붙여넣을 기본 HTML로 변환합니다", () => {
    const html = markdownToImportHtml("# 안내문\n\n| 항목 | 내용 |\n| --- | --- |\n| 일시 | 오늘 |\n\n본문입니다.");

    expect(html).toContain("<h1>안내문</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>일시</td>");
    expect(html).toContain("<p>본문입니다.</p>");
  });
});
