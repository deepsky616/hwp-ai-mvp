import type { DocumentBlock, DocumentPatch } from "./document";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

export type PatchPreviewCard = {
  id: string;
  label: string;
  before: string;
  after: string;
};

let messageCounter = 0;

export function createChatMessage(role: ChatRole, text: string, id?: string): ChatMessage {
  messageCounter += 1;
  return {
    id: id ?? `chat-${Date.now()}-${messageCounter}`,
    role,
    text,
  };
}

function patchKey(patch: DocumentPatch): string {
  if (patch.type === "paragraph") return `paragraph:${patch.sectionIndex}:${patch.paragraphIndex}`;
  return `tableCell:${patch.sectionIndex}:${patch.parentParagraphIndex}:${patch.controlIndex}:${patch.cellIndex}:${patch.cellParagraphIndex}`;
}

function blockKey(block: DocumentBlock): string {
  if (block.type === "paragraph") return `paragraph:${block.sectionIndex}:${block.paragraphIndex}`;
  return `tableCell:${block.sectionIndex}:${block.parentParagraphIndex}:${block.controlIndex}:${block.cellIndex}:${block.cellParagraphIndex}`;
}

export function buildPatchPreviewCards(blocks: DocumentBlock[], patches: DocumentPatch[]): PatchPreviewCard[] {
  const blockMap = new Map(blocks.map((block) => [blockKey(block), block]));

  return patches.map((patch, index) => {
    const block = blockMap.get(patchKey(patch));
    return {
      id: `patch-${index}-${patchKey(patch)}`,
      label: patch.type === "paragraph" ? "본문" : "표 셀",
      before: block?.text ?? "",
      after: patch.text,
    };
  });
}

export function summarizePatchResult(patches: DocumentPatch[]): string {
  if (patches.length === 0) return "수정할 내용을 찾지 못했습니다. 지시를 더 구체적으로 입력해 주세요.";
  return `수정 제안 ${patches.length}개를 만들었습니다. 아래 비교 카드를 확인한 뒤 문서에 반영할 수 있습니다.`;
}
