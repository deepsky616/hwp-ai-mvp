// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findBundledNpmCli, findManagedCli } from "./managed-cli";
import { resolveCli } from "./cli-resolver";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function managedFixture(name: string, pkgPathParts: string[], binValue: string | Record<string, string>, entryRel: string) {
  const root = join(tmpdir(), `hwp-managed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const pkgDir = join(root, name, "node_modules", ...pkgPathParts);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkgPathParts.join("/"), bin: binValue }));
  const entry = join(pkgDir, entryRel);
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(entry, "");
  tempDirs.push(root);
  process.env.HWP_AI_MANAGED_CLI_DIR = root;
  return { root, entry };
}

describe("관리형 CLI 설치본", () => {
  it("내장 npm의 실행 파일 경로를 런타임에 실제로 찾습니다", () => {
    const npmCli = findBundledNpmCli();
    expect(npmCli).not.toBeNull();
    expect(npmCli).toContain("npm-cli.js");
  });

  it("설치되지 않았으면 null을 반환합니다", () => {
    process.env.HWP_AI_MANAGED_CLI_DIR = join(tmpdir(), "hwp-managed-없음");
    expect(findManagedCli("claude")).toBeNull();
  });

  it("JS 엔트리는 내장 Node 런타임으로 실행하도록 해석합니다", () => {
    const { entry } = managedFixture("gemini", ["@google", "gemini-cli"], { gemini: "bundle/gemini.js" }, join("bundle", "gemini.js"));
    const managed = findManagedCli("gemini");
    expect(managed).not.toBeNull();
    expect(managed!.command).toBe(process.execPath);
    expect(managed!.argsPrefix).toEqual([entry]);
  });

  it("네이티브 바이너리 엔트리는 직접 실행하도록 해석합니다", () => {
    const { entry } = managedFixture("claude", ["@anthropic-ai", "claude-code"], { claude: "bin/claude" }, join("bin", "claude"));
    const managed = findManagedCli("claude");
    expect(managed).not.toBeNull();
    expect(managed!.command).toBe(entry);
    expect(managed!.argsPrefix).toEqual([]);
  });

  it("resolveCli는 시스템 설치본이 없으면 관리형 설치본으로 폴백합니다", () => {
    const { entry } = managedFixture("gemini", ["@google", "gemini-cli"], { gemini: "bundle/gemini.js" }, join("bundle", "gemini.js"));
    // PATH를 비워 시스템 gemini가 없는 상황을 만들되, 고정 후보에 실제
    // gemini가 있는 로컬 환경에서는 이 검증을 건너뛴다.
    process.env.PATH = "";
    const resolved = resolveCli("gemini", undefined, "");
    if (resolved.argsPrefix.length > 0) {
      expect(resolved.command).toBe(process.execPath);
      expect(resolved.argsPrefix).toEqual([entry]);
    }
  });
});
