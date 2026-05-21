import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAiEditPayload,
  extractResponseText,
  requestDocumentPatches,
  resetExecFileForTest,
  setExecFileForTest,
  testAiConnection,
} from "./ai-edit";
import type { DocumentBlock } from "./document";
import * as childProcess from "node:child_process";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

const blocks: DocumentBlock[] = [
  { type: "paragraph", id: "p-0-0", sectionIndex: 0, paragraphIndex: 0, length: 8, text: "안녕 하십니까" },
];

afterEach(() => {
  vi.restoreAllMocks();
  resetExecFileForTest();
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempCli(name: string) {
  const dir = join(tmpdir(), `hwp-ai-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, "");
  tempDirs.push(dir);
  process.env.PATH = [dir, originalEnv.PATH ?? ""].join(delimiter);
  return file;
}

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

  it("코덱스 계정 인증과 선택 모델로 문서 패치를 요청합니다", async () => {
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

  it("웹앱 설정에서 입력한 OpenAI 키를 서버 환경 변수보다 우선 사용합니다", async () => {
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

  it("Gemini API 키로 문서 패치를 요청합니다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ patches: [] }) }] } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await requestDocumentPatches({
      instruction: "띄어쓰기 수정",
      blocks,
      aiSettings: { provider: "gemini", apiKey: "gemini-key", model: "gemini-2.5-flash" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("Codex CLI로 문서 패치를 요청합니다", async () => {
    const codexPath = tempCli("codex");
    const execFileMock = vi.fn((command, args, options, callback) => {
      const realCallback = (typeof options === "function" ? options : callback) as Function;
      const outputPath = (args as string[])[(args as string[]).indexOf("--output-last-message") + 1];
      writeFile(outputPath, JSON.stringify({ patches: [] }), "utf8").then(() => realCallback(null, "", ""));
      return {} as childProcess.ChildProcess;
    }) as unknown as typeof childProcess.execFile;
    setExecFileForTest(execFileMock);

    await requestDocumentPatches({
      instruction: "띄어쓰기 수정",
      blocks,
      aiSettings: { provider: "codex-cli", model: "gpt-5.4-pro" },
    });

    expect(execFileMock).toHaveBeenCalledWith(
      codexPath,
      expect.arrayContaining(["exec", "--model", "gpt-5.4-pro"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("Gemini CLI로 문서 패치를 요청합니다", async () => {
    const geminiPath = tempCli("gemini");
    const execFileMock = vi.fn((command, args, options, callback) => {
      const realCallback = (typeof options === "function" ? options : callback) as Function;
      realCallback(null, JSON.stringify({ patches: [] }), "");
      return {} as childProcess.ChildProcess;
    }) as unknown as typeof childProcess.execFile;
    setExecFileForTest(execFileMock);

    await requestDocumentPatches({
      instruction: "띄어쓰기 수정",
      blocks,
      aiSettings: { provider: "gemini-cli", model: "gemini-3-pro" },
    });

    expect(execFileMock).toHaveBeenCalledWith(
      geminiPath,
      expect.arrayContaining(["--model", "gemini-3-pro", "--output-format", "text"]),
      expect.any(Object),
      expect.any(Function),
    );
  });
});
