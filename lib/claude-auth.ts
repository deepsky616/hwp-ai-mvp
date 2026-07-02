import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveCli } from "./cli-resolver";

// claude auth status / auth login 서브커맨드로 Anthropic 구독 로그인을 관리한다.
// 토큰은 Claude CLI가 OS 키체인에 보관하므로 앱은 CLI에 위임만 한다.

export type ClaudeAuthStatus = {
  authenticated: boolean;
  email?: string;
  subscriptionType?: string;
  message: string;
};

type StatusExec = (command: string, args: string[], envPath: string) => Promise<string>;

const defaultStatusExec: StatusExec = (command, args, envPath) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { env: { ...process.env, PATH: envPath }, timeout: 15_000 },
      (error, stdout, stderr) => {
        const text = `${stdout ?? ""}\n${stderr ?? ""}`;
        // 미로그인 시에도 상태가 출력에 담겨 있으면 그대로 해석한다.
        if (error && !text.trim()) { reject(error); return; }
        resolve(text);
      },
    );
  });

export async function getClaudeAuthStatusAsync(
  customPath?: string,
  execStatus: StatusExec = defaultStatusExec,
): Promise<ClaudeAuthStatus> {
  let resolved;
  try {
    resolved = resolveCli("claude", customPath);
  } catch {
    return { authenticated: false, message: "Claude CLI가 설치되어 있지 않습니다. 설치 후 경로 자동 감지를 눌러 주세요." };
  }

  try {
    const output = await execStatus(resolved.command, [...resolved.argsPrefix, "auth", "status"], resolved.envPath);
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const data = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
        authMethod?: string;
      };
      if (data.loggedIn) {
        const detail = [data.email, data.subscriptionType ? `${data.subscriptionType} 구독` : ""].filter(Boolean).join(" · ");
        return {
          authenticated: true,
          email: data.email,
          subscriptionType: data.subscriptionType,
          message: `Anthropic 계정 로그인이 연결되어 있습니다${detail ? ` (${detail})` : ""}.`,
        };
      }
      return { authenticated: false, message: "Anthropic 계정 로그인이 필요합니다." };
    }
    // 구버전 CLI가 auth 서브커맨드를 모르면 JSON이 아닌 도움말/오류가 나온다.
    return { authenticated: false, message: "Claude CLI 로그인 상태를 확인할 수 없습니다. 터미널에서 'claude'를 실행해 로그인해 주세요." };
  } catch {
    return { authenticated: false, message: "Claude CLI 실행에 실패했습니다. 경로를 확인해 주세요." };
  }
}

// ─── 로그인 흐름 (codex-login-flow와 동일한 세션 추적 패턴) ─────────────────

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const URL_WAIT_MS = 20_000;
// claude auth login은 claude.ai(구독) 인증 URL을 출력한다.
const AUTH_URL_REGEX = /(https:\/\/(?:claude\.ai|console\.anthropic\.com|auth\.anthropic\.com)\/[^\s"']*oauth[^\s"']*)/i;

type SessionStatus = "pending" | "complete" | "error";

type LoginSession = {
  child: ChildProcess;
  authUrl: string;
  status: SessionStatus;
  error?: string;
  timer: NodeJS.Timeout;
};

const globalForLogin = globalThis as unknown as { __claudeLoginSessions?: Map<string, LoginSession> };
const sessions = (globalForLogin.__claudeLoginSessions ??= new Map<string, LoginSession>());

function cleanupPendingSessions(): void {
  for (const [id, session] of sessions) {
    if (session.status === "pending") {
      clearTimeout(session.timer);
      try { session.child.kill("SIGTERM"); } catch { /* ignore */ }
      sessions.delete(id);
    }
  }
}

export async function startClaudeLogin(customPath?: string): Promise<{ authUrl: string; sessionId: string }> {
  cleanupPendingSessions();

  const resolved = resolveCli("claude", customPath);
  const sessionId = randomBytes(16).toString("hex");

  return new Promise<{ authUrl: string; sessionId: string }>((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.argsPrefix, "auth", "login", "--claudeai"], {
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
          session.error = `claude auth login이 비정상 종료되었습니다 (코드 ${code}).`;
        }
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(urlTimeout);
        reject(new Error(`claude auth login 실행에 실패했습니다: ${err.message}`));
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
      reject(new Error("로그인 URL을 가져오지 못했습니다. 터미널에서 'claude'를 실행해 /login 명령으로 로그인해 주세요."));
    }, URL_WAIT_MS);
  });
}

export function pollClaudeLogin(sessionId: string): { status: SessionStatus; error?: string } {
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
