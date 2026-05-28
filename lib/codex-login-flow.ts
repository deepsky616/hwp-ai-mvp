import { randomBytes } from "node:crypto";
import {
  exchangeCodeForTokens,
  pollDeviceAuth,
  saveAuthTokens,
  startDeviceAuth,
} from "./openai-device-auth";

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

type SessionStatus = "pending" | "complete" | "error";

type LoginSession = {
  deviceAuthId: string;
  userCode: string;
  authUrl: string;
  interval: number;
  status: SessionStatus;
  error?: string;
  expiresAt: number;
};

const globalForLogin = globalThis as unknown as { __codexLoginSessions?: Map<string, LoginSession> };
const sessions = (globalForLogin.__codexLoginSessions ??= new Map<string, LoginSession>());

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now || session.status !== "pending") sessions.delete(id);
  }
}

export async function startCodexLogin(): Promise<{
  authUrl: string;
  sessionId: string;
  userCode: string;
  interval: number;
}> {
  cleanupExpiredSessions();

  const start = await startDeviceAuth();
  const sessionId = randomBytes(16).toString("hex");
  const authUrl = start.verification_uri;

  sessions.set(sessionId, {
    deviceAuthId: start.device_auth_id,
    userCode: start.user_code,
    authUrl,
    interval: start.interval,
    status: "pending",
    expiresAt: Date.now() + LOGIN_TIMEOUT_MS,
  });

  return { authUrl, sessionId, userCode: start.user_code, interval: start.interval };
}

export async function pollCodexLogin(sessionId: string): Promise<{ status: SessionStatus; error?: string }> {
  cleanupExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) return { status: "error", error: "로그인 세션을 찾을 수 없습니다. 다시 시도해 주세요." };
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return { status: "error", error: "로그인 시간이 초과되었습니다. 다시 시도해 주세요." };
  }

  try {
    const result = await pollDeviceAuth(session.deviceAuthId, session.userCode);
    if (result.status === "pending") return { status: "pending" };

    const tokens = await exchangeCodeForTokens(result.authorization_code, result.code_verifier);
    saveAuthTokens(tokens);
    sessions.delete(sessionId);
    return { status: "complete" };
  } catch (error) {
    sessions.delete(sessionId);
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
