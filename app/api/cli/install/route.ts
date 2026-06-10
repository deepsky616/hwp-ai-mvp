import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildToolPath, findCliPath, findExecutablePath } from "../../../../lib/cli-resolver";
import {
  CLI_INSTALL_PACKAGES,
  manualInstallCommand,
  requiresManualInstall,
  type CliInstallName,
} from "../../../../lib/cli-install-info";
import { createRateLimiter } from "../../../../lib/rate-limit";

const execFileAsync = promisify(execFile);

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

type InstallCommand = {
  command: string;
  args: string[];
  toolPath: string;
};

// 서버가 자동 실행하는 설치는 npm 패키지 설치로 한정한다.
// 원격 셸 스크립트(curl|sh, irm|iex)는 서버에서 실행하지 않고 수동 안내로 대체한다.
function buildNpmInstallCommand(pkg: string): InstallCommand {
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
  const rl = limiter("local");
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: { cliName?: string };
  try {
    body = (await request.json()) as { cliName?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const { cliName } = body;
  if (!cliName || !Object.hasOwn(CLI_INSTALL_PACKAGES, cliName)) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 CLI입니다" }, { status: 400 });
  }

  const normalized = cliName as CliInstallName;

  // 원격 스크립트 설치형 CLI는 서버에서 실행하지 않는다(RCE 위험). 수동 안내만 제공한다.
  if (requiresManualInstall(normalized)) {
    const command = manualInstallCommand(normalized, process.platform === "win32");
    return NextResponse.json(
      {
        ok: false,
        manual: true,
        command,
        error: `보안상 서버 자동 설치를 비활성화했습니다. 터미널에서 직접 실행해 주세요:\n${command}\n설치 후 '경로 자동 감지'를 눌러 주세요.`,
      },
      { status: 200 },
    );
  }

  let install: InstallCommand;
  try {
    install = buildNpmInstallCommand(CLI_INSTALL_PACKAGES[normalized]);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync(install.command, install.args, {
      env: { ...process.env, PATH: install.toolPath, Path: install.toolPath },
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 5,
    });
    const detectedPath = findCliPath(normalized, undefined, install.toolPath);
    return NextResponse.json({ ok: true, output: stdout || stderr, detectedPath: detectedPath ?? null });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      return NextResponse.json(
        { ok: false, error: "설치 도구를 찾을 수 없습니다. 인터넷 연결과 npm 설치 상태를 확인하거나 실행 파일 경로를 직접 지정해 주세요." },
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
