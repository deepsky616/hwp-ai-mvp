export type CliInstallName = "codex" | "gemini" | "antigravity";

export const CLI_INSTALL_PACKAGES: Record<CliInstallName, string> = {
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  antigravity: "antigravity",
};

const SCRIPT_INSTALL_URLS: Record<"codex" | "antigravity", { sh: string; ps1: string }> = {
  codex: {
    sh: "https://chatgpt.com/codex/install.sh",
    ps1: "https://chatgpt.com/codex/install.ps1",
  },
  antigravity: {
    sh: "https://antigravity.google/cli/install.sh",
    ps1: "https://antigravity.google/cli/install.ps1",
  },
};

// codex/antigravity는 원격 셸 스크립트로 설치된다. 서버가 이를 curl|sh 로 직접
// 실행하면 무결성 검증 없는 원격 코드 실행(RCE)이 되므로, 서버 자동 실행 대신
// 사용자가 터미널에서 직접 실행하도록 안내만 제공한다.
export function requiresManualInstall(cliName: CliInstallName): boolean {
  return cliName === "codex" || cliName === "antigravity";
}

export function manualInstallCommand(cliName: CliInstallName, isWindows: boolean): string {
  if (cliName === "codex" || cliName === "antigravity") {
    const urls = SCRIPT_INSTALL_URLS[cliName];
    return isWindows ? `irm ${urls.ps1} | iex` : `curl -fsSL ${urls.sh} | sh`;
  }
  return `npm install -g ${CLI_INSTALL_PACKAGES[cliName]}`;
}
