// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startDeviceAuth, pollDeviceAuth, exchangeCodeForTokens } from "./openai-device-auth";

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

describe("startDeviceAuth", () => {
  it("device_auth_id와 user_code를 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ device_auth_id: "dev-123", user_code: "ABCD-12345", interval: "5" }),
    });
    const result = await startDeviceAuth();
    expect(result).toEqual({ device_auth_id: "dev-123", user_code: "ABCD-12345", interval: 5 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }),
    );
  });

  it("API 오류 시 한국어 메시지로 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "Unauthorized" });
    await expect(startDeviceAuth()).rejects.toThrow("인증 코드 발급에 실패했습니다");
  });
});

describe("pollDeviceAuth", () => {
  it("403 응답 시 pending을 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({ status: 403, ok: false });
    expect(await pollDeviceAuth("dev-123", "ABCD-12345")).toEqual({ status: "pending" });
  });

  it("404 응답 시 pending을 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false });
    expect(await pollDeviceAuth("dev-123", "ABCD-12345")).toEqual({ status: "pending" });
  });

  it("200 응답 시 authorization_code와 code_verifier를 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ authorization_code: "auth-xyz", code_verifier: "verifier-abc" }),
    });
    expect(await pollDeviceAuth("dev-123", "ABCD-12345")).toEqual({
      status: "complete",
      authorization_code: "auth-xyz",
      code_verifier: "verifier-abc",
    });
  });

  it("기타 오류 상태 시 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({ status: 500, ok: false, text: async () => "Server Error" });
    await expect(pollDeviceAuth("dev-123", "ABCD-12345")).rejects.toThrow("인증 확인에 실패했습니다");
  });
});

describe("exchangeCodeForTokens", () => {
  it("authorization_code를 access_token으로 교환한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at-1", refresh_token: "rt-1", id_token: "it-1" }),
    });
    const result = await exchangeCodeForTokens("auth-xyz", "verifier-abc");
    expect(result).toEqual({ access_token: "at-1", refresh_token: "rt-1", id_token: "it-1" });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.openai.com/oauth/token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=auth-xyz");
    expect(String(init.body)).toContain("code_verifier=verifier-abc");
  });

  it("교환 실패 시 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "Bad request" });
    await expect(exchangeCodeForTokens("bad-code", "bad-verifier")).rejects.toThrow("토큰 교환에 실패했습니다");
  });
});
