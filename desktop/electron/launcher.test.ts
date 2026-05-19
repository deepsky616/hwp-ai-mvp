import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const launcher = require("./launcher.cjs") as {
  buildNextServerOptions: (options?: { appRoot?: string; host?: string; port?: number; packaged?: boolean }) => {
    dev: boolean;
    dir?: string;
    hostname: string;
    port: number;
  };
  resolveDesktopUrl: (env?: Record<string, string | undefined>, port?: number) => string;
  shouldStartLocalNextServer: (env?: Record<string, string | undefined>) => boolean;
};

describe("윈도우 데스크톱 실행기", () => {
  it("외부 주소가 없으면 데스크톱 앱이 자체 로컬 주소를 사용합니다", () => {
    expect(launcher.resolveDesktopUrl({}, 3123)).toBe("http://127.0.0.1:3123");
    expect(launcher.resolveDesktopUrl({ HWP_AI_DESKTOP_URL: "http://localhost:4000" }, 3123)).toBe("http://localhost:4000");
  });

  it("외부 주소가 지정된 경우에는 자체 넥스트 서버를 시작하지 않습니다", () => {
    expect(launcher.shouldStartLocalNextServer({})).toBe(true);
    expect(launcher.shouldStartLocalNextServer({ HWP_AI_DESKTOP_URL: "http://localhost:4000" })).toBe(false);
  });

  it("개발 실행에서는 넥스트 서버를 개발 모드로 준비합니다", () => {
    expect(launcher.buildNextServerOptions({ appRoot: "C:/hwp-ai-mvp", port: 3123, packaged: false })).toEqual({
      dev: true,
      dir: "C:/hwp-ai-mvp",
      hostname: "127.0.0.1",
      port: 3123,
    });
  });

  it("설치 앱 실행에서는 넥스트 서버를 운영 모드로 준비합니다", () => {
    expect(launcher.buildNextServerOptions({ appRoot: "C:/hwp-ai-mvp", port: 3123, packaged: true })).toMatchObject({
      dev: false,
      dir: "C:/hwp-ai-mvp",
      hostname: "127.0.0.1",
      port: 3123,
    });
  });
});
