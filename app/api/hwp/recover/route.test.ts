import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("HWP 복구 라우트 배포 번들", () => {
  it("Vercel 함수에 무거운 문서 변환 의존성을 정적 포함하지 않습니다", () => {
    const source = readFileSync(join(process.cwd(), "app/api/hwp/recover/route.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["']kordoc["']/);
    expect(source).not.toContain('import("kordoc")');
    expect(source).not.toContain('"kordoc"');
    expect(source).not.toContain("'kordoc'");
    expect(source).toContain("RECOVER_DISABLED_ON_VERCEL");
  });
});
