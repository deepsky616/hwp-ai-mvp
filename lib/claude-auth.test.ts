// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getClaudeAuthStatusAsync } from "./claude-auth";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempClaudeCli() {
  const dir = join(tmpdir(), `hwp-claude-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claude"), "");
  tempDirs.push(dir);
  process.env.PATH = [dir, originalEnv.PATH ?? ""].join(delimiter);
}

describe("Claude 인증 상태", () => {
  it("auth status JSON에서 로그인·구독 정보를 해석합니다", async () => {
    tempClaudeCli();
    const status = await getClaudeAuthStatusAsync(undefined, async () =>
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "user@example.com", subscriptionType: "pro" }),
    );
    expect(status.authenticated).toBe(true);
    expect(status.message).toContain("user@example.com");
    expect(status.message).toContain("pro");
  });

  it("미로그인 JSON이면 미인증으로 판정합니다", async () => {
    tempClaudeCli();
    const status = await getClaudeAuthStatusAsync(undefined, async () => JSON.stringify({ loggedIn: false }));
    expect(status.authenticated).toBe(false);
  });

  it("JSON이 아닌 출력(구버전 CLI)이면 터미널 로그인 안내를 반환합니다", async () => {
    tempClaudeCli();
    const status = await getClaudeAuthStatusAsync(undefined, async () => "unknown command: auth");
    expect(status.authenticated).toBe(false);
    expect(status.message).toContain("claude");
  });
});
