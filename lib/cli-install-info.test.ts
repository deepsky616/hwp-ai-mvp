// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CLI_INSTALL_PACKAGES,
  manualInstallCommand,
  requiresManualInstall,
} from "./cli-install-info";

describe("CLI 설치 정보", () => {
  it("스크립트 설치형 CLI는 서버 자동 실행 대신 수동 설치를 요구한다", () => {
    expect(requiresManualInstall("codex")).toBe(true);
    expect(requiresManualInstall("antigravity")).toBe(true);
  });

  it("npm 패키지형 CLI는 수동 설치를 요구하지 않는다", () => {
    expect(requiresManualInstall("gemini")).toBe(false);
  });

  it("플랫폼에 맞는 수동 설치 명령을 만든다", () => {
    expect(manualInstallCommand("codex", false)).toBe(
      "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    );
    expect(manualInstallCommand("codex", true)).toBe(
      "irm https://chatgpt.com/codex/install.ps1 | iex",
    );
    expect(manualInstallCommand("gemini", false)).toBe(
      `npm install -g ${CLI_INSTALL_PACKAGES.gemini}`,
    );
  });
});
