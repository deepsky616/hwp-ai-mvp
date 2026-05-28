import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEVICE_AUTH_BASE = "https://auth.openai.com/api/accounts/deviceauth";
const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CLIENT_ID = process.env.OPENAI_OAUTH_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = process.env.OPENAI_OAUTH_REDIRECT_URI || "http://localhost:1455/auth/callback";
const VERIFY_URL = "https://auth.openai.com/codex/device";

export type DeviceAuthStart = {
  device_auth_id: string;
  user_code: string;
  interval: number;
  verification_uri: string;
};

export type DeviceAuthPollResult =
  | { status: "pending" }
  | { status: "complete"; authorization_code: string; code_verifier: string };

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  account_id?: string;
  expires_in?: number;
};

export function getOpenAiAuthFilePath(): string {
  return process.env.CODEX_AUTH_FILE || join(homedir(), ".codex", "auth.json");
}

async function readError(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).trim();
}

export async function startDeviceAuth(): Promise<DeviceAuthStart> {
  const response = await fetch(`${DEVICE_AUTH_BASE}/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!response.ok) {
    throw new Error(`인증 코드 발급에 실패했습니다: ${await readError(response)}`);
  }

  const data = (await response.json()) as {
    device_auth_id?: unknown;
    user_code?: unknown;
    interval?: unknown;
    verification_uri?: unknown;
  };
  const deviceAuthId = typeof data.device_auth_id === "string" ? data.device_auth_id : "";
  const userCode = typeof data.user_code === "string" ? data.user_code : "";
  if (!deviceAuthId || !userCode) throw new Error("인증 서버 응답에 필요한 코드가 없습니다.");

  const parsedInterval =
    typeof data.interval === "number"
      ? data.interval
      : Number.parseInt(typeof data.interval === "string" ? data.interval : "", 10);

  return {
    device_auth_id: deviceAuthId,
    user_code: userCode,
    interval: Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 5,
    verification_uri: typeof data.verification_uri === "string" ? data.verification_uri : VERIFY_URL,
  };
}

export async function pollDeviceAuth(device_auth_id: string, user_code: string): Promise<DeviceAuthPollResult> {
  const response = await fetch(`${DEVICE_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id, user_code }),
  });

  if (response.status === 403 || response.status === 404) return { status: "pending" };
  if (!response.ok) {
    throw new Error(`인증 확인에 실패했습니다: ${await readError(response)}`);
  }

  const data = (await response.json()) as {
    authorization_code?: unknown;
    code_verifier?: unknown;
  };
  const authorizationCode = typeof data.authorization_code === "string" ? data.authorization_code : "";
  const codeVerifier = typeof data.code_verifier === "string" ? data.code_verifier : "";
  if (!authorizationCode || !codeVerifier) throw new Error("인증 완료 응답에 토큰 교환 정보가 없습니다.");

  return { status: "complete", authorization_code: authorizationCode, code_verifier: codeVerifier };
}

export async function exchangeCodeForTokens(
  authorization_code: string,
  code_verifier: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorization_code,
    code_verifier,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`토큰 교환에 실패했습니다: ${await readError(response)}`);
  }

  return (await response.json()) as OAuthTokens;
}

export async function refreshOpenAiTokens(refresh_token: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: CLIENT_ID,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`토큰 갱신에 실패했습니다: ${await readError(response)}`);
  }

  return (await response.json()) as OAuthTokens;
}

export function saveAuthTokens(tokens: OAuthTokens): void {
  const authFile = getOpenAiAuthFilePath();
  const expiresAt =
    typeof tokens.expires_in === "number" && tokens.expires_in > 0
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : undefined;

  mkdirSync(dirname(authFile), { recursive: true });
  writeFileSync(
    authFile,
    JSON.stringify(
      {
        auth_mode: "chatgpt",
        last_refresh: new Date().toISOString(),
        expires_at: expiresAt,
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          id_token: tokens.id_token,
          account_id: tokens.account_id,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}
