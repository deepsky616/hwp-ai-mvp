import { delimiter, dirname, join, sep } from "node:path";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

function fsModule(): typeof import("node:fs") {
  return nodeRequire("node:fs") as typeof import("node:fs");
}

function osModule(): typeof import("node:os") {
  return nodeRequire("node:os") as typeof import("node:os");
}

export type CliName = "codex" | "gemini" | "antigravity";

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

function pathEntries(pathValue = process.env.PATH || ""): string[] {
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

function cliFileNames(name: CliName, platform = process.platform): string[] {
  const command = commandName(name);
  return platform === "win32" ? [`${command}.cmd`, `${command}.exe`, `${command}.ps1`, command] : [command];
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
      join(localAppData, "pnpm", `${command}.cmd`),
      join(localAppData, "agy", "bin", "agy.exe"),
      join(localAppData, "agy", "bin", "agy.cmd"),
      join(home, ".bun", "bin", `${command}.exe`),
      join(home, ".volta", "bin", `${command}.exe`),
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
    ...nvmBins,
  ];
}

export function findCliPath(name: CliName, customPath?: string, pathValue = process.env.PATH || ""): string | null {
  const custom = customPath?.trim();
  if (custom && isFile(expandHome(custom))) return expandHome(custom);

  for (const entry of pathEntries(pathValue)) {
    for (const fileName of cliFileNames(name)) {
      const candidate = join(entry, fileName);
      if (isFile(candidate)) return candidate;
    }
  }

  return candidatePaths(name).find(isFile) || null;
}

function mergePath(pathValue: string | undefined, entries: string[]): string {
  const existing = pathEntries(pathValue);
  const merged = [...entries, ...existing].filter((entry, index, all) => entry && all.indexOf(entry) === index);
  return merged.join(delimiter);
}

export function resolveCli(name: CliName, customPath?: string, pathValue = process.env.PATH || ""): ResolvedCli {
  const cliPath = findCliPath(name, customPath, pathValue);
  if (!cliPath) {
    throw new Error(`${commandName(name)} CLI를 찾을 수 없습니다. CLI를 설치하거나 설정에서 실행 파일 경로를 직접 지정해 주세요.`);
  }

  if (process.platform === "win32" && name === "codex" && /codex\.cmd$/i.test(cliPath)) {
    const codexJs = join(dirname(cliPath), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (isFile(codexJs)) {
      return {
        command: "node",
        argsPrefix: [codexJs],
        envPath: mergePath(pathValue, [dirname(cliPath)]),
      };
    }
  }

  return {
    command: cliPath,
    argsPrefix: [],
    envPath: mergePath(pathValue, [dirname(cliPath)]),
  };
}
