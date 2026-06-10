import { describe, expect, it } from "vitest";
import {
  MAX_RECOVER_FILE_BYTES,
  exceedsRecoverContentLength,
  isRecoverFileSizeAllowed,
  markdownToImportHtml,
  shouldUseTextImportFallback,
} from "./hwp-load";

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

describe("복구 업로드 크기 제한", () => {
  it("정상 크기 파일은 허용한다", () => {
    expect(isRecoverFileSizeAllowed(1024)).toBe(true);
    expect(isRecoverFileSizeAllowed(MAX_RECOVER_FILE_BYTES)).toBe(true);
  });

  it("상한을 초과하는 파일은 거부한다(메모리 고갈 DoS 방지)", () => {
    expect(isRecoverFileSizeAllowed(MAX_RECOVER_FILE_BYTES + 1)).toBe(false);
  });

  it("빈 파일이나 비정상 크기는 거부한다", () => {
    expect(isRecoverFileSizeAllowed(0)).toBe(false);
    expect(isRecoverFileSizeAllowed(-1)).toBe(false);
    expect(isRecoverFileSizeAllowed(Number.NaN)).toBe(false);
  });

  it("Content-Length 헤더로 본문을 읽기 전에 과대 요청을 선거른다", () => {
    expect(exceedsRecoverContentLength(String(MAX_RECOVER_FILE_BYTES + 1))).toBe(true);
    expect(exceedsRecoverContentLength(String(MAX_RECOVER_FILE_BYTES))).toBe(false);
    expect(exceedsRecoverContentLength("1024")).toBe(false);
  });

  it("Content-Length가 없거나 파싱 불가하면 선거르지 않고 이후 단계에 맡긴다", () => {
    expect(exceedsRecoverContentLength(null)).toBe(false);
    expect(exceedsRecoverContentLength("garbage")).toBe(false);
  });
});
