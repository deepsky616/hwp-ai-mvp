import { mkdtempSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCodexAuthStatus, getOpenAiAuthorization, listUsableModels, normalizeModelList, startCodexDeviceLogin } from "./codex-auth";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

function writeAuth(payload: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "codex-auth-"));
  const file = join(dir, "auth.json");
  writeFileSync(file, JSON.stringify(payload), "utf8");
  process.env.CODEX_AUTH_FILE = file;
  return file;
}

describe("코덱스 인증", () => {
  it("코덱스 인증 파일의 접근 토큰으로 인증 헤더를 만듭니다", () => {
    writeAuth({
      auth_mode: "chatgpt",
      tokens: { access_token: "codex-access-token", account_id: "acct_1" },
    });

    expect(getCodexAuthStatus()).toMatchObject({ authenticated: true, source: "codex-oauth" });
    expect(getOpenAiAuthorization()).toEqual({ header: "Bearer codex-access-token", source: "codex-oauth" });
  });

  it("코덱스 인증이 없으면 환경 변수 키를 대체 인증으로 사용합니다", () => {
    process.env.CODEX_AUTH_FILE = join(tmpdir(), "missing-codex-auth.json");
    process.env.OPENAI_API_KEY = "sk-test";

    expect(getCodexAuthStatus()).toMatchObject({ authenticated: false, source: "api-key" });
    expect(getOpenAiAuthorization()).toEqual({ header: "Bearer sk-test", source: "api-key" });
  });

  it("사용 가능한 모델 목록을 편집용 모델 위주로 정렬합니다", () => {
    const models = normalizeModelList([
      { id: "whisper-1" },
      { id: "gpt-4.1-mini" },
      { id: "o4-mini" },
      { id: "text-embedding-3-small" },
    ]);

    expect(models).toEqual(["gpt-4.1-mini", "o4-mini"]);
  });

  it("환경 변수 키로 원격 모델 목록을 조회합니다", async () => {
    process.env.CODEX_AUTH_FILE = join(tmpdir(), "missing-codex-auth.json");
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4.1-mini" }, { id: "text-embedding-3-small" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listUsableModels()).resolves.toEqual(["gpt-4.1-mini"]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
    }));
  });

  it("코덱스 기기 인증 로그인 주소와 코드를 파싱합니다", async () => {
    const output = [
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "https://auth.openai.com/codex/device",
      "2. Enter this one-time code (expires in 15 minutes)",
      "ABCD-EF123",
    ].join("\n");
    vi.mocked(execFile).mockImplementation((file, args, options, callback: any) => {
      callback(null, output, "");
      return {} as any;
    });

    await expect(startCodexDeviceLogin()).resolves.toMatchObject({
      ok: true,
      loginUrl: "https://auth.openai.com/codex/device",
      code: "ABCD-EF123",
      expiresInMinutes: 15,
    });
    expect(execFile).toHaveBeenCalledWith("codex", ["login", "--device-auth"], expect.objectContaining({ timeout: 30000 }), expect.any(Function));
  });

  it("배포 환경에서는 코덱스 기기 인증 시작을 막습니다", async () => {
    process.env.VERCEL = "1";

    await expect(startCodexDeviceLogin()).rejects.toThrow("로컬 실행 환경");
    expect(execFile).not.toHaveBeenCalled();
  });
});
