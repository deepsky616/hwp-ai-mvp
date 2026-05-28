// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForTokens,
  pollDeviceAuth,
  refreshOpenAiTokens,
  saveAuthTokens,
  startDeviceAuth,
} from "./openai-device-auth";

const originalEnv = { ...process.env };
const fetchMock = vi.fn();
let tempDir = "";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  tempDir = mkdtempSync(join(tmpdir(), "openai-device-auth-"));
  process.env.CODEX_AUTH_FILE = join(tempDir, "auth.json");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("OpenAI 기기 인증", () => {
  it("기기 인증 코드와 확인 주소를 반환합니다", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ device_auth_id: "dev-1", user_code: "ABCD-1234", interval: "5" }),
    });

    await expect(startDeviceAuth()).resolves.toEqual({
      device_auth_id: "dev-1",
      user_code: "ABCD-1234",
      interval: 5,
      verification_uri: "https://auth.openai.com/codex/device",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("아직 승인되지 않은 폴링 응답은 pending으로 처리합니다", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(pollDeviceAuth("dev-1", "ABCD-1234")).resolves.toEqual({ status: "pending" });
  });

  it("승인 완료 응답에서 토큰 교환 정보를 추출합니다", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ authorization_code: "auth-code", code_verifier: "verifier" }),
    });

    await expect(pollDeviceAuth("dev-1", "ABCD-1234")).resolves.toEqual({
      status: "complete",
      authorization_code: "auth-code",
      code_verifier: "verifier",
    });
  });

  it("승인 코드를 토큰으로 교환합니다", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-1", refresh_token: "refresh-1", id_token: "id-1" }),
    });

    await expect(exchangeCodeForTokens("auth-code", "verifier")).resolves.toMatchObject({
      access_token: "access-1",
      refresh_token: "refresh-1",
      id_token: "id-1",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=auth-code");
    expect(String(init.body)).toContain("code_verifier=verifier");
  });

  it("갱신 토큰으로 접근 토큰을 갱신합니다", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-2", expires_in: 3600 }),
    });

    await expect(refreshOpenAiTokens("refresh-1")).resolves.toMatchObject({ access_token: "access-2" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=refresh-1");
  });

  it("토큰을 코덱스 인증 파일 형식으로 저장합니다", () => {
    saveAuthTokens({ access_token: "access-1", refresh_token: "refresh-1", id_token: "id-1", expires_in: 3600 });

    const saved = JSON.parse(readFileSync(process.env.CODEX_AUTH_FILE!, "utf8"));
    expect(saved.auth_mode).toBe("chatgpt");
    expect(saved.tokens.access_token).toBe("access-1");
    expect(saved.tokens.refresh_token).toBe("refresh-1");
    expect(saved.expires_at).toEqual(expect.any(String));
  });
});
