import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_PACKAGES = {
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
} as const;

type CliName = keyof typeof CLI_PACKAGES;

function buildInstallCommand(pkg: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/c", "npm", "install", "-g", pkg] };
  }
  return { command: "npm", args: ["install", "-g", pkg] };
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

  const pkg = CLI_PACKAGES[cliName as CliName];
  const { command, args } = buildInstallCommand(pkg);

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 5,
    });
    return NextResponse.json({ ok: true, output: stdout || stderr });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      return NextResponse.json(
        { ok: false, error: "npm을 찾을 수 없습니다. Node.js와 npm이 먼저 설치되어 있어야 합니다." },
        { status: 500 },
      );
    }
    const detail = err.stderr?.trim().slice(-400) || err.message || "알 수 없는 오류";
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
