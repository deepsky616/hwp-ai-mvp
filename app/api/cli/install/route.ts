import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildToolPath, findCliPath, findExecutablePath } from "../../../../lib/cli-resolver";

const execFileAsync = promisify(execFile);

const CLI_PACKAGES = {
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  antigravity: "antigravity",
} as const;

type CliName = keyof typeof CLI_PACKAGES;

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

type InstallCommand = {
  command: string;
  args: string[];
  toolPath: string;
  env?: Record<string, string>;
};

function buildScriptInstallCommand(
  cliName: "codex" | "antigravity",
  winUrl: string,
  unixUrl: string,
): InstallCommand {
  const env: Record<string, string> | undefined =
    cliName === "codex"
      ? { CODEX_NON_INTERACTIVE: "1" }
      : undefined;

  if (process.platform === "win32") {
    const powershellPath = findExecutablePath("powershell") || "powershell.exe";
    return {
      command: powershellPath,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${winUrl} | iex`],
      toolPath: buildToolPath(powershellPath),
      env,
    };
  }

  const bashPath = findExecutablePath("bash") || "bash";
  const curlPath = findExecutablePath("curl");
  return {
    command: bashPath,
    args: ["-lc", `curl -fsSL ${unixUrl} | sh`],
    toolPath: buildToolPath(bashPath, curlPath),
    env,
  };
}

function buildInstallCommand(cliName: CliName, pkg: string): InstallCommand {
  if (cliName === "codex") {
    return buildScriptInstallCommand(
      "codex",
      "https://chatgpt.com/codex/install.ps1",
      "https://chatgpt.com/codex/install.sh",
    );
  }

  if (cliName === "antigravity") {
    return buildScriptInstallCommand(
      "antigravity",
      "https://antigravity.google/cli/install.ps1",
      "https://antigravity.google/cli/install.sh",
    );
  }

  const npmPath = findExecutablePath("npm");
  if (!npmPath) {
    throw new Error("npm을 찾을 수 없습니다. Node.js와 npm이 먼저 설치되어 있어야 합니다.");
  }

  if (process.platform === "win32") {
    const cmdPath = findExecutablePath("cmd") || "cmd.exe";
    return {
      command: cmdPath,
      args: ["/d", "/s", "/c", `${quoteForCmd(npmPath)} install -g ${pkg}`],
      toolPath: buildToolPath(cmdPath, npmPath),
    };
  }
  return { command: npmPath, args: ["install", "-g", pkg], toolPath: buildToolPath(npmPath) };
}

export async function POST(request: NextRequest) {
  let body: { cliName?: string };
  try {
    body = (await request.json()) as { cliName?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const { cliName } = body;
  if (!cliName || !Object.hasOwn(CLI_PACKAGES, cliName)) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 CLI입니다" }, { status: 400 });
  }

  const normalized = cliName as CliName;
  const pkg = CLI_PACKAGES[normalized];
  let command: string;
  let args: string[];
  let toolPath: string;
  let extraEnv: Record<string, string> | undefined;
  try {
    const install = buildInstallCommand(normalized, pkg);
    command = install.command;
    args = install.args;
    toolPath = install.toolPath;
    extraEnv = install.env;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: { ...process.env, ...extraEnv, PATH: toolPath, Path: toolPath },
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 5,
    });
    const detectedPath = findCliPath(normalized, undefined, toolPath);
    return NextResponse.json({ ok: true, output: stdout || stderr, detectedPath: detectedPath ?? null });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      return NextResponse.json(
        { ok: false, error: "설치 도구를 찾을 수 없습니다. 인터넷 연결과 시스템 기본 도구를 확인하거나 실행 파일 경로를 직접 지정해 주세요." },
        { status: 500 },
      );
    }
    const rawDetail = err.stderr?.trim() || err.message || "알 수 없는 오류";
    const detail =
      rawDetail.toLowerCase().includes("not recognized") || rawDetail.includes("찾을 수 없습니다")
        ? "설치 도구를 실행하지 못했습니다. 앱을 다시 실행하거나 CLI 경로를 직접 지정해 주세요."
        : rawDetail.slice(-400);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
