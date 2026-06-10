// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildToolPath, expandHome, findCliPath, findExecutablePath, isAllowedCliCustomPath, resolveCli } from "./cli-resolver";

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

  it("Antigravity CLI는 agy 실행 파일을 찾습니다", () => {
    const { dir, file } = tempExecutable("agy");
    expect(findCliPath("antigravity", undefined, dir)).toBe(file);
  });

  it("npm 같은 설치 도구도 PATH에서 찾고 도구 PATH를 구성합니다", () => {
    const { dir, file } = tempExecutable("npm");
    expect(findExecutablePath("npm", dir)).toBe(file);
    expect(buildToolPath(file).split(delimiter)[0]).toBe(dir);
  });

  it("해결된 CLI 디렉터리를 PATH 앞쪽에 병합합니다", () => {
    const { dir, file } = tempExecutable("gemini");
    const resolved = resolveCli("gemini", undefined, [`/usr/bin`, dir].join(delimiter));
    expect(resolved.command).toBe(file);
    expect(resolved.envPath.split(delimiter)[0]).toBe(dir);
  });

  it("CLI 이름과 다른 실행 파일명의 custom 경로는 실행하지 않는다", () => {
    const { file } = tempExecutable("malware");
    // 클라이언트가 임의 실행 파일을 custom 경로로 주입해도 그 경로를 그대로 반환하지 않는다
    expect(findCliPath("codex", file, "")).not.toBe(file);
  });

  it("허용 목록 검증 함수는 올바른 basename의 절대경로만 통과시킨다", () => {
    expect(isAllowedCliCustomPath("codex", "/usr/local/bin/codex")).toBe(true);
    expect(isAllowedCliCustomPath("gemini", "/opt/bin/gemini")).toBe(true);
    expect(isAllowedCliCustomPath("antigravity", "/opt/bin/agy")).toBe(true);
    expect(isAllowedCliCustomPath("codex", "/tmp/evil/malware")).toBe(false);
    expect(isAllowedCliCustomPath("codex", "codex")).toBe(false); // 상대경로 거부
  });
});
