import { describe, expect, it, vi } from "vitest";
import { startBrowserOpenAiAccountLogin, type OpenAiLoginStartResult } from "./openai-login-popup";

function makePopup() {
  return {
    closed: false,
    location: { href: "about:blank" },
    close: vi.fn(),
  };
}

describe("OpenAI 계정 로그인 팝업", () => {
  it("브라우저 팝업 차단을 피하도록 서버 요청 전에 빈 로그인 창을 먼저 엽니다", async () => {
    const events: string[] = [];
    const popup = makePopup();
    const openWindow = vi.fn(() => {
      events.push("open");
      return popup;
    });
    const requestLoginStart = vi.fn(async (): Promise<OpenAiLoginStartResult> => {
      events.push("fetch");
      return {
        ok: true,
        loginUrl: "https://auth.openai.com/codex/device",
        code: "ABCD-EF123",
        device_auth_id: "test-device-auth-id",
        expiresInMinutes: 15,
        message: "OpenAI 계정 로그인 창에서 코드를 입력한 뒤 상태 새로고침을 눌러 주세요.",
      };
    });

    const result = await startBrowserOpenAiAccountLogin({ openWindow, requestLoginStart });

    expect(events).toEqual(["open", "fetch"]);
    expect(openWindow).toHaveBeenCalledWith("about:blank", "_blank", "noopener,noreferrer");
    expect(popup.location.href).toBe("https://auth.openai.com/codex/device");
    expect(result.popupBlocked).toBe(false);
    expect(result.data.code).toBe("ABCD-EF123");
  });

  it("빈 창이 차단되면 로그인 주소를 다시 여는 시도를 하고 차단 상태를 반환합니다", async () => {
    const openWindow = vi.fn(() => null);
    const requestLoginStart = vi.fn(async (): Promise<OpenAiLoginStartResult> => ({
      ok: true,
      loginUrl: "https://auth.openai.com/codex/device",
      code: "WXYZ-12345",
      device_auth_id: "test-device-auth-id-2",
      expiresInMinutes: 15,
      message: "OpenAI 계정 로그인 창에서 코드를 입력한 뒤 상태 새로고침을 눌러 주세요.",
    }));

    const result = await startBrowserOpenAiAccountLogin({ openWindow, requestLoginStart });

    expect(openWindow).toHaveBeenNthCalledWith(1, "about:blank", "_blank", "noopener,noreferrer");
    expect(openWindow).toHaveBeenNthCalledWith(2, "https://auth.openai.com/codex/device", "_blank", "noopener,noreferrer");
    expect(result.popupBlocked).toBe(true);
  });

  it("로그인 시작 요청이 실패하면 미리 연 빈 창을 닫습니다", async () => {
    const popup = makePopup();
    const openWindow = vi.fn(() => popup);
    const requestLoginStart = vi.fn(async () => {
      throw new Error("로그인 시작 실패");
    });

    await expect(startBrowserOpenAiAccountLogin({ openWindow, requestLoginStart })).rejects.toThrow("로그인 시작 실패");

    expect(popup.close).toHaveBeenCalled();
  });
});
