// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandHome, findCliPath, resolveCli } from "./cli-resolver";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempExecutable(name: string) {
  const dir = join(tmpdir(), `hwp-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, "");
  tempDirs.push(dir);
  return { dir, file };
}

describe("CLI resolver", () => {
  it("~ 경로를 홈 디렉터리로 확장합니다", () => {
    expect(expandHome("~/bin/codex")).toContain("bin");
    expect(expandHome("/tmp/codex")).toBe("/tmp/codex");
  });

  it("사용자가 지정한 경로를 가장 먼저 사용합니다", () => {
    const { file } = tempExecutable("codex");
    expect(findCliPath("codex", file, "")).toBe(file);
  });

  it("PATH에서 CLI 실행 파일을 찾습니다", () => {
    const { dir, file } = tempExecutable("codex");
    expect(findCliPath("codex", undefined, dir)).toBe(file);
  });

  it("해결된 CLI 디렉터리를 PATH 앞쪽에 병합합니다", () => {
    const { dir, file } = tempExecutable("gemini");
    const resolved = resolveCli("gemini", undefined, [`/usr/bin`, dir].join(delimiter));
    expect(resolved.command).toBe(file);
    expect(resolved.envPath.split(delimiter)[0]).toBe(dir);
  });
});
