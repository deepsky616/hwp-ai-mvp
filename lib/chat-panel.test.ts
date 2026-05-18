import { describe, expect, it } from "vitest";
import { buildPatchPreviewCards, createChatMessage, summarizePatchResult } from "./chat-panel";
import type { DocumentBlock, DocumentPatch } from "./document";

const blocks: DocumentBlock[] = [
  { type: "paragraph", id: "p-0-0", sectionIndex: 0, paragraphIndex: 0, length: 7, text: "안녕 하세요" },
  { type: "tableCell", id: "c-0-1-0-0-0", sectionIndex: 0, parentParagraphIndex: 1, controlIndex: 0, cellIndex: 0, cellParagraphIndex: 0, length: 4, text: "회의명" },
];

const patches: DocumentPatch[] = [
  { type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: "안녕하세요" },
  { type: "tableCell", sectionIndex: 0, parentParagraphIndex: 1, controlIndex: 0, cellIndex: 0, cellParagraphIndex: 0, text: "회의 제목" },
];

describe("대화형 문서 편집 패널", () => {
  it("사용자와 인공지능 메시지를 구분해 생성합니다", () => {
    const user = createChatMessage("user", "공문체로 다듬어줘");
    const assistant = createChatMessage("assistant", "수정 제안을 만들었습니다.");

    expect(user.role).toBe("user");
    expect(user.text).toBe("공문체로 다듬어줘");
    expect(assistant.role).toBe("assistant");
    expect(assistant.id).not.toBe(user.id);
  });

  it("문서 블록과 패치로 수정 전후 비교 카드를 만듭니다", () => {
    const cards = buildPatchPreviewCards(blocks, patches);

    expect(cards).toEqual([
      expect.objectContaining({ label: "본문", before: "안녕 하세요", after: "안녕하세요" }),
      expect.objectContaining({ label: "표 셀", before: "회의명", after: "회의 제목" }),
    ]);
  });

  it("패치 결과를 대화창용 한국어 요약으로 만듭니다", () => {
    expect(summarizePatchResult(patches)).toBe("수정 제안 2개를 만들었습니다. 아래 비교 카드를 확인한 뒤 문서에 반영할 수 있습니다.");
    expect(summarizePatchResult([])).toBe("수정할 내용을 찾지 못했습니다. 지시를 더 구체적으로 입력해 주세요.");
  });
});
