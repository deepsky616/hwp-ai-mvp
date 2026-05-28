import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveCli } from "./cli-resolver";

// codex login이 실제 OpenAI 계정 OAuth와 토큰 저장 형식을 관리합니다.
// 직접 device auth 토큰 교환은 token_exchange_user_error가 발생할 수 있어 위임합니다.

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const URL_WAIT_MS = 15_000;
const AUTH_URL_REGEX = /(https:\/\/auth\.openai\.com\/oauth\/authorize\?\S+)/;

type SessionStatus = "pending" | "complete" | "error";

type LoginSession = {
  child: ChildProcess;
  authUrl: string;
  status: SessionStatus;
  error?: string;
  timer: NodeJS.Timeout;
};

const globalForLogin = globalThis as unknown as { __codexLoginSessions?: Map<string, LoginSession> };
const sessions = (globalForLogin.__codexLoginSessions ??= new Map<string, LoginSession>());

function cleanupPendingSessions(): void {
  for (const [id, session] of sessions) {
    if (session.status === "pending") {
      clearTimeout(session.timer);
      try { session.child.kill("SIGTERM"); } catch { /* ignore */ }
      sessions.delete(id);
    }
  }
}

export async function startCodexLogin(customPath?: string): Promise<{ authUrl: string; sessionId: string }> {
  cleanupPendingSessions();

  const resolved = resolveCli("codex", customPath);
  const sessionId = randomBytes(16).toString("hex");

  return new Promise<{ authUrl: string; sessionId: string }>((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.argsPrefix, "login"], {
      env: { ...process.env, PATH: resolved.envPath },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let captured = "";

    const handleOutput = (buf: Buffer) => {
      if (settled) return;
      captured += buf.toString();
      const match = captured.match(AUTH_URL_REGEX);
      if (!match) return;
      settled = true;
      clearTimeout(urlTimeout);
      const authUrl = match[1];
      const timer = setTimeout(() => {
        const session = sessions.get(sessionId);
        if (session && session.status === "pending") {
          session.status = "error";
          session.error = "로그인 시간이 초과되었습니다 (10분).";
          try { session.child.kill("SIGTERM"); } catch { /* ignore */ }
        }
      }, LOGIN_TIMEOUT_MS);
      sessions.set(sessionId, { child, authUrl, status: "pending", timer });
      resolve({ authUrl, sessionId });
    };

    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);

    child.on("exit", (code) => {
      const session = sessions.get(sessionId);
      if (!session) return;
      clearTimeout(session.timer);
      if (session.status === "pending") {
        if (code === 0) {
          session.status = "complete";
        } else {
          session.status = "error";
          session.error = `codex login이 비정상 종료되었습니다 (코드 ${code}).`;
        }
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(urlTimeout);
        reject(new Error(`codex login 실행에 실패했습니다: ${err.message}`));
        return;
      }
      const session = sessions.get(sessionId);
      if (session && session.status === "pending") {
        session.status = "error";
        session.error = err.message;
      }
    });

    const urlTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      reject(new Error("codex login URL을 가져오지 못했습니다. 'codex login status'로 CLI 상태를 확인해 주세요."));
    }, URL_WAIT_MS);
  });
}

export function pollCodexLogin(sessionId: string): { status: SessionStatus; error?: string } {
  const session = sessions.get(sessionId);
  if (!session) return { status: "error", error: "로그인 세션을 찾을 수 없습니다. 다시 시도해 주세요." };
  if (session.status === "complete") {
    sessions.delete(sessionId);
    return { status: "complete" };
  }
  if (session.status === "error") {
    sessions.delete(sessionId);
    return { status: "error", error: session.error };
  }
  return { status: "pending" };
}
