import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { createRequire } from "node:module";
import { CLI_INSTALL_PACKAGES, type CliInstallName } from "./cli-install-info";

// 시스템에 Node.js/npm이 없는 기기에서도 원클릭 설치가 동작하도록,
// 앱에 내장된 npm으로 CLI를 앱 전용 디렉터리에 설치하고(관리형 설치),
// JS 엔트리는 앱 자체 런타임(Electron의 Node 모드)으로 실행한다.

const nodeRequire = createRequire(import.meta.url);

export function managedCliRoot(): string {
  return process.env.HWP_AI_MANAGED_CLI_DIR || join(homedir(), ".hwp-ai", "managed-cli");
}

export type ManagedEntry = {
  command: string;
  argsPrefix: string[];
  extraEnv: Record<string, string>;
};

// Electron 안에서는 자체 바이너리를 Node 모드로 실행한다.
// 일반 Node 서버(next dev/start)라면 process.execPath가 곧 node다.
function nodeRuntime(): { command: string; extraEnv: Record<string, string> } {
  if (process.versions.electron) {
    return { command: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: process.execPath, extraEnv: {} };
}

function managedPackageDir(name: CliInstallName): string {
  const pkgName = CLI_INSTALL_PACKAGES[name];
  return join(managedCliRoot(), name, "node_modules", ...pkgName.split("/"));
}

function resolveBinRelative(pkgDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    if (typeof pkg.bin === "string") return pkg.bin;
    if (pkg.bin && typeof pkg.bin === "object") {
      const first = Object.values(pkg.bin)[0];
      return typeof first === "string" ? first : null;
    }
  } catch {
    // 설치 안 됨 또는 손상
  }
  return null;
}

export function findManagedCli(name: CliInstallName): ManagedEntry | null {
  const pkgDir = managedPackageDir(name);
  const rel = resolveBinRelative(pkgDir);
  if (!rel) return null;
  const entry = join(pkgDir, rel);
  if (!existsSync(entry)) return null;

  // JS 엔트리는 내장 런타임으로 실행하고, 네이티브 바이너리는 직접 실행한다.
  if (/\.(c|m)?js$/i.test(entry)) {
    const runtime = nodeRuntime();
    return { command: runtime.command, argsPrefix: [entry], extraEnv: runtime.extraEnv };
  }
  try {
    chmodSync(entry, 0o755);
  } catch {
    // 권한 변경 실패는 실행 시점에 드러난다
  }
  return { command: entry, argsPrefix: [], extraEnv: {} };
}

export function findBundledNpmCli(): string | null {
  // npm 패키지의 exports 필드가 bin 경로를 노출하지 않으므로 직접
  // require.resolve("npm/bin/npm-cli.js")는 실패한다. 메인 모듈을 해석한 뒤
  // node_modules/npm 루트를 잘라내 bin 경로를 조립한다.
  let mainPath: string | null = null;
  try {
    mainPath = nodeRequire.resolve("npm");
  } catch {
    mainPath = null;
  }
  if (!mainPath) return null;
  const marker = `${sep}node_modules${sep}npm${sep}`;
  const idx = mainPath.lastIndexOf(marker);
  if (idx < 0) return null;
  const resolved = join(mainPath.slice(0, idx + marker.length), "bin", "npm-cli.js");
  // Electron asar 내부 경로면 asarUnpack된 실제 파일 경로로 바꾼다.
  const unpacked = resolved.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
  if (unpacked !== resolved && existsSync(unpacked)) return unpacked;
  return existsSync(resolved) ? resolved : null;
}

export async function installManagedCli(name: CliInstallName): Promise<{ output: string; entry: ManagedEntry }> {
  const npmCli = findBundledNpmCli();
  if (!npmCli) {
    throw new Error("앱에 내장된 npm을 찾지 못했습니다. 앱을 다시 설치해 주세요.");
  }

  const prefix = join(managedCliRoot(), name);
  mkdirSync(prefix, { recursive: true });
  const runtime = nodeRuntime();
  const pkg = CLI_INSTALL_PACKAGES[name];

  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      runtime.command,
      [npmCli, "install", `${pkg}@latest`, "--prefix", prefix, "--no-audit", "--no-fund", "--loglevel", "error"],
      {
        env: { ...process.env, ...runtime.extraEnv },
        timeout: 300_000,
        maxBuffer: 1024 * 1024 * 20,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = `${stderr ?? ""}`.trim() || error.message;
          reject(new Error(`내장 npm 설치에 실패했습니다: ${detail.slice(-400)}`));
          return;
        }
        resolve(`${stdout ?? ""}\n${stderr ?? ""}`.trim());
      },
    );
  });

  const entry = findManagedCli(name);
  if (!entry) {
    throw new Error("설치는 끝났지만 실행 파일을 찾지 못했습니다. 다시 시도해 주세요.");
  }
  return { output, entry };
}
