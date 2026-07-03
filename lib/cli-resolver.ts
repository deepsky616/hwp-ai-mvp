import { basename, delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

function fsModule(): typeof import("node:fs") {
  return nodeRequire("node:fs") as typeof import("node:fs");
}

function osModule(): typeof import("node:os") {
  return nodeRequire("node:os") as typeof import("node:os");
}

export type CliName = "codex" | "gemini" | "antigravity" | "claude";

export type ResolvedCli = {
  command: string;
  argsPrefix: string[];
  envPath: string;
};

function isFile(filePath: string): boolean {
  try {
    const fs = fsModule();
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function listDirs(parent: string): string[] {
  try {
    const fs = fsModule();
    return fs.readdirSync(parent)
      .map((entry) => join(parent, entry))
      .filter((entry) => fs.statSync(entry).isDirectory());
  } catch {
    return [];
  }
}

let cachedLoginShellPath: string | null | undefined;

// Finder/Dock/탐색기에서 실행된 GUI 앱(Electron)은 로그인 셸 PATH를 물려받지
// 못해 npm과 CLI 탐색이 실패한다. 사용자 로그인 셸에서 실제 PATH를 한 번만
// 읽어 이후 모든 탐색에 병합한다. (macOS/Linux 전용, 5초 제한, 실패 시 무시)
function loginShellPath(): string | null {
  if (cachedLoginShellPath !== undefined) return cachedLoginShellPath;
  cachedLoginShellPath = null;
  if (process.platform === "win32") return cachedLoginShellPath;

  const { spawnSync } = nodeRequire("node:child_process") as typeof import("node:child_process");
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const marker = "__HWP_AI_PATH__";
  // PATH를 .zshrc(대화형)에만 설정하는 사용자도 있어 -l -i 를 먼저 시도한다.
  for (const flags of [["-l", "-i", "-c"], ["-l", "-c"]]) {
    try {
      const result = spawnSync(shell, [...flags, `printf '%s' "${marker}$PATH${marker}"`], {
        timeout: 5_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parts = String(result.stdout ?? "").split(marker);
      const captured = parts.length >= 3 ? parts[1].trim() : "";
      if (captured) {
        cachedLoginShellPath = captured;
        break;
      }
    } catch {
      // 다음 방식으로 폴백
    }
  }
  return cachedLoginShellPath;
}

function defaultPathValue(): string {
  const envPath = process.env.PATH || process.env.Path || "";
  const shellPath = loginShellPath();
  if (!shellPath) return envPath;
  // 프로세스 PATH를 우선하고, 로그인 셸 PATH는 뒤에 덧붙인다.
  return mergePath(shellPath, pathEntries(envPath));
}

function pathEntries(pathValue = defaultPathValue()): string[] {
  return pathValue.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

export function expandHome(input: string): string {
  const home = osModule().homedir();
  if (input === "~") return home;
  if (input.startsWith(`~${sep}`)) return join(home, input.slice(2));
  return input;
}

function commandName(name: CliName): string {
  return name === "antigravity" ? "agy" : name;
}

function executableFileNames(command: string, platform = process.platform): string[] {
  return platform === "win32" ? [`${command}.cmd`, `${command}.exe`, `${command}.ps1`, command] : [command];
}

function cliFileNames(name: CliName, platform = process.platform): string[] {
  const command = commandName(name);
  return executableFileNames(command, platform);
}

function candidatePaths(name: CliName, platform = process.platform): string[] {
  const home = osModule().homedir();
  const command = commandName(name);
  const nvmBins = listDirs(join(home, ".nvm", "versions", "node"))
    .map((dir) => join(dir, "bin", platform === "win32" ? `${command}.cmd` : command));

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "npm", `${command}.cmd`),
      join(appData, "npm", `${command}.exe`),
      join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.cmd"),
      join(localAppData, "pnpm", `${command}.cmd`),
      join(localAppData, "agy", "bin", "agy.exe"),
      join(localAppData, "agy", "bin", "agy.cmd"),
      join(localAppData, "Programs", "agy", "bin", "agy.exe"),
      join(home, ".local", "bin", "agy.exe"),
      join(home, ".local", "bin", "agy.cmd"),
      join(home, ".bun", "bin", `${command}.exe`),
      join(home, ".volta", "bin", `${command}.exe`),
      join(home, "scoop", "shims", `${command}.cmd`),
      join(home, "scoop", "shims", `${command}.exe`),
      join(localAppData, "Microsoft", "WinGet", "Links", `${command}.exe`),
      ...(name === "claude" ? [join(home, ".claude", "local", "claude.exe")] : []),
      // nvm-windows는 각 버전 디렉터리 바로 아래에 전역 npm CLI를 둔다.
      ...listDirs(join(appData, "nvm")).flatMap((dir) => [join(dir, `${command}.cmd`), join(dir, `${command}.exe`)]),
      ...nvmBins,
    ];
  }

  return [
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`,
    join(home, ".npm-global", "bin", command),
    join(home, ".local", "bin", command),
    join(home, ".bun", "bin", command),
    join(home, ".volta", "bin", command),
    join(home, ".asdf", "shims", command),
    join(home, ".local", "share", "mise", "shims", command),
    join(home, ".nodenv", "shims", command),
    ...(name === "claude" ? [join(home, ".claude", "local", "claude")] : []),
    ...nvmBins,
  ];
}

// 클라이언트가 보낸 custom 경로로 임의 실행 파일이 구동되는 것을 막는다.
// 절대경로이면서 basename이 해당 CLI의 허용 실행 파일명일 때만 통과시킨다.
export function isAllowedCliCustomPath(name: CliName, customPath: string): boolean {
  const expanded = expandHome(customPath.trim());
  if (!isAbsolute(expanded)) return false;
  return cliFileNames(name).includes(basename(expanded));
}

export function findCliPath(name: CliName, customPath?: string, pathValue = defaultPathValue()): string | null {
  const custom = customPath?.trim();
  if (custom && isAllowedCliCustomPath(name, custom) && isFile(expandHome(custom))) return expandHome(custom);

  for (const entry of pathEntries(pathValue)) {
    for (const fileName of cliFileNames(name)) {
      const candidate = join(entry, fileName);
      if (isFile(candidate)) return candidate;
    }
  }

  return candidatePaths(name).find(isFile) || null;
}

function executableCandidatePaths(command: string, platform = process.platform): string[] {
  const home = osModule().homedir();

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const names = executableFileNames(command, platform);
    const dirs = [
      join(programFiles, "nodejs"),
      join(programFilesX86, "nodejs"),
      join(appData, "npm"),
      join(localAppData, "pnpm"),
      join(home, ".bun", "bin"),
      join(home, ".volta", "bin"),
      join(home, "scoop", "shims"),
      join(localAppData, "Microsoft", "WinGet", "Links"),
      // nvm-windows: 활성 심볼릭 링크(기본 C:\nvm4w\nodejs)와 각 버전 디렉터리
      "C:\\nvm4w\\nodejs",
      ...listDirs(join(appData, "nvm")),
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      join(systemRoot, "Sysnative", "WindowsPowerShell", "v1.0"),
      join(systemRoot, "System32"),
      ...listDirs(join(home, ".nvm", "versions", "node")).map((dir) => join(dir, "bin")),
    ];
    return dirs.flatMap((dir) => names.map((name) => join(dir, name)));
  }

  const dirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(home, ".npm-global", "bin"),
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".nodenv", "shims"),
    ...listDirs(join(home, ".nvm", "versions", "node")).map((dir) => join(dir, "bin")),
  ];
  return dirs.flatMap((dir) => executableFileNames(command, platform).map((name) => join(dir, name)));
}

export function findExecutablePath(command: string, pathValue = defaultPathValue()): string | null {
  for (const entry of pathEntries(pathValue)) {
    for (const fileName of executableFileNames(command)) {
      const candidate = join(entry, fileName);
      if (isFile(candidate)) return candidate;
    }
  }

  return executableCandidatePaths(command).find(isFile) || null;
}

export function buildToolPath(...toolPaths: Array<string | null | undefined>): string {
  const dirs = toolPaths.filter((toolPath): toolPath is string => !!toolPath).map(dirname);
  return mergePath(defaultPathValue(), dirs);
}

function mergePath(pathValue: string | undefined, entries: string[]): string {
  const existing = pathEntries(pathValue);
  const merged = [...entries, ...existing].filter((entry, index, all) => entry && all.indexOf(entry) === index);
  return merged.join(delimiter);
}

// npm 전역 설치는 Windows에서 .cmd 셔임(shim)을 만드는데, Node 18.20/20.12+는
// 보안 패치(CVE-2024-27980)로 shell 없는 execFile의 .cmd/.bat 실행을 거부한다.
// 알려진 npm CLI는 셔임 대신 패키지의 JS 엔트리를 node로 직접 실행한다.
const NPM_CLI_ENTRY_JS: Partial<Record<CliName, string[]>> = {
  codex: [join("node_modules", "@openai", "codex", "bin", "codex.js")],
  gemini: [join("node_modules", "@google", "gemini-cli", "dist", "index.js")],
  claude: [join("node_modules", "@anthropic-ai", "claude-code", "cli.js")],
};

export function resolveCli(name: CliName, customPath?: string, pathValue = defaultPathValue()): ResolvedCli {
  const cliPath = findCliPath(name, customPath, pathValue);
  if (!cliPath) {
    throw new Error(`${commandName(name)} CLI를 찾을 수 없습니다. CLI를 설치하거나 설정에서 실행 파일 경로를 직접 지정해 주세요.`);
  }

  if (process.platform === "win32" && /\.(cmd|bat|ps1)$/i.test(cliPath)) {
    for (const relative of NPM_CLI_ENTRY_JS[name] ?? []) {
      const entryJs = join(dirname(cliPath), relative);
      if (isFile(entryJs)) {
        return {
          command: "node",
          argsPrefix: [entryJs],
          envPath: mergePath(pathValue, [dirname(cliPath)]),
        };
      }
    }
  }

  return {
    command: cliPath,
    argsPrefix: [],
    envPath: mergePath(pathValue, [dirname(cliPath)]),
  };
}
