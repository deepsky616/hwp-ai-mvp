import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiEditPayload, extractResponseText, requestDocumentPatches } from "./ai-edit";
import type { DocumentBlock } from "./document";

const originalEnv = { ...process.env };

const blocks: DocumentBlock[] = [
  { type: "paragraph", id: "p-0-0", sectionIndex: 0, paragraphIndex: 0, length: 8, text: "안녕 하십니까" },
];

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("인공지능 문서 수정", () => {
  it("선택한 모델을 요청 본문에 반영합니다", () => {
    const payload = buildAiEditPayload({ instruction: "띄어쓰기 수정", blocks, model: "gpt-4.1-mini" });

    expect(payload.model).toBe("gpt-4.1-mini");
    expect(JSON.stringify(payload.input)).toContain("띄어쓰기 수정");
    expect(JSON.stringify(payload.input)).toContain("안녕 하십니까");
  });

  it("응답 본문에서 출력 텍스트를 추출합니다", () => {
    expect(extractResponseText({ output_text: "{\"patches\":[]}" })).toBe("{\"patches\":[]}");
    expect(extractResponseText({ output: [{ content: [{ text: "본문" }] }] })).toBe("본문");
  });

  it("코덱스 오어스 인증과 선택 모델로 문서 패치를 요청합니다", async () => {
    process.env.CODEX_AUTH_FILE = "/tmp/없는-파일.json";
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ patches: [{ type: "paragraph", sectionIndex: 0, paragraphIndex: 0, text: "안녕하십니까" }] }) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const patches = await requestDocumentPatches({ instruction: "띄어쓰기 수정", blocks, model: "gpt-4.1-mini" });

    expect(patches).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
    }));
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("gpt-4.1-mini");
  });
});
