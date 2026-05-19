import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiEditPayload, extractResponseText, requestDocumentPatches, testAiConnection } from "./ai-edit";
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

  it("웹앱 설정에서 입력한 오픈에이아이 키를 서버 환경 변수보다 우선 사용합니다", async () => {
    process.env.CODEX_AUTH_FILE = "/tmp/없는-파일.json";
    process.env.OPENAI_API_KEY = "sk-server";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ patches: [] }) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await requestDocumentPatches({
      instruction: "띄어쓰기 수정",
      blocks,
      model: "gpt-4.1-mini",
      aiSettings: { provider: "openai", apiKey: "sk-browser", model: "gpt-4.1-mini" },
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-browser" }),
    }));
  });

  it("올라마 호환 서버로 문서 패치를 요청합니다", async () => {
    process.env.CODEX_AUTH_FILE = "/tmp/없는-파일.json";
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ patches: [] }) } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await requestDocumentPatches({
      instruction: "띄어쓰기 수정",
      blocks,
      aiSettings: { provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3.3:70b" },
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("llama3.3:70b");
    expect(requestBody.stream).toBe(false);
  });

  it("웹앱 설정 연결 테스트는 키를 저장하지 않고 현재 입력값으로 호출합니다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(testAiConnection({ provider: "openai", apiKey: "sk-browser", model: "gpt-4.1-mini" })).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-browser" }),
    }));
  });

  it("오픈에이아이 오어스 연결 테스트는 코덱스 로그인 파일을 사용하고 네트워크에 키를 보내지 않습니다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwp-ai-auth-"));
    const authFile = join(dir, "auth.json");
    try {
      await writeFile(authFile, JSON.stringify({ tokens: { access_token: "oauth-token", account_id: "acct-test" } }), "utf8");
      process.env.CODEX_AUTH_FILE = authFile;
      delete process.env.OPENAI_API_KEY;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(testAiConnection({ provider: "openai-oauth", model: "gpt-5.5" })).resolves.toMatchObject({
        ok: true,
        message: "오픈에이아이 오어스 로그인이 연결되어 있습니다.",
      });

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("오픈에이아이 오어스 선택 시 로그인 파일이 없으면 안내 오류를 반환합니다", async () => {
    process.env.CODEX_AUTH_FILE = "/tmp/없는-오어스-파일.json";
    delete process.env.OPENAI_API_KEY;

    await expect(testAiConnection({ provider: "openai-oauth", model: "gpt-5.5" })).rejects.toThrow("오픈에이아이 오어스 로그인이 필요합니다");
    await expect(requestDocumentPatches({
      instruction: "띄어쓰기 수정",
      blocks,
      aiSettings: { provider: "openai-oauth", model: "gpt-5.5" },
    })).rejects.toThrow("오픈에이아이 오어스 로그인이 필요합니다");
  });
});
