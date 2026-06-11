// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CliInstallBox } from "./SettingsPanel";

afterEach(cleanup);

describe("CliInstallBox 설치 UI", () => {
  it("수동 설치형(codex)은 원클릭 설치 버튼을 노출하지 않는다", () => {
    render(<CliInstallBox cliName="codex" />);
    expect(screen.queryByRole("button", { name: /원클릭 설치/ })).toBeNull();
    // 대신 터미널에서 직접 설치하라는 안내가 보인다
    expect(screen.getByText(/직접 실행/)).toBeTruthy();
  });

  it("수동 설치형(antigravity)도 원클릭 설치 버튼을 노출하지 않는다", () => {
    render(<CliInstallBox cliName="antigravity" />);
    expect(screen.queryByRole("button", { name: /원클릭 설치/ })).toBeNull();
  });

  it("npm 설치형(gemini)은 원클릭 설치 버튼을 노출한다", () => {
    render(<CliInstallBox cliName="gemini" />);
    expect(screen.queryByRole("button", { name: /원클릭 설치/ })).not.toBeNull();
  });

  it("모든 CLI에 대해 수동 설치 명령을 보여 준다", () => {
    render(<CliInstallBox cliName="codex" />);
    expect(screen.getByText(/install\.sh|install\.ps1/)).toBeTruthy();
  });
});
