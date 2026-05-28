// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollCodexLogin, startCodexLogin } from "./codex-login-flow";
import { resolveCli } from "./cli-resolver";
import { spawn } from "node:child_process";

vi.mock("./cli-resolver", () => ({
  resolveCli: vi.fn(() => ({ command: "codex", argsPrefix: [], envPath: "/mock/bin" })),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function mockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

describe("코덱스 로그인 흐름", () => {
  it("codex login이 출력한 OAuth URL을 세션으로 추적하고 종료 시 완료 처리합니다", async () => {
    const child = mockChildProcess();

    const started = startCodexLogin("/custom/codex");
    child.stderr.emit(
      "data",
      Buffer.from("Open https://auth.openai.com/oauth/authorize?client_id=test&state=abc to continue"),
    );

    const result = await started;

    expect(resolveCli).toHaveBeenCalledWith("codex", "/custom/codex");
    expect(spawn).toHaveBeenCalledWith("codex", ["login"], expect.objectContaining({
      env: expect.objectContaining({ PATH: "/mock/bin" }),
    }));
    expect(result.authUrl).toBe("https://auth.openai.com/oauth/authorize?client_id=test&state=abc");
    expect(pollCodexLogin(result.sessionId)).toEqual({ status: "pending" });

    child.emit("exit", 0);

    expect(pollCodexLogin(result.sessionId)).toEqual({ status: "complete" });
  });
});
