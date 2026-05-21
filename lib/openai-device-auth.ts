import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

export type DeviceAuthStart = {
  device_auth_id: string;
  user_code: string;
  interval: number;
};

export type DeviceAuthPollResult =
  | { status: "pending" }
  | { status: "complete"; authorization_code: string; code_verifier: string };

export type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  id_token: string;
};

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export async function startDeviceAuth(): Promise<DeviceAuthStart> {
  const res = await fetch(
    "https://auth.openai.com/api/accounts/deviceauth/usercode",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`인증 코드 발급에 실패했습니다: ${text}`);
  }

  const data = await res.json();
  return {
    device_auth_id: data.device_auth_id,
    user_code: data.user_code,
    interval: parseInt(data.interval) || 5,
  };
}

export async function pollDeviceAuth(
  device_auth_id: string,
  user_code: string,
): Promise<DeviceAuthPollResult> {
  const res = await fetch(
    "https://auth.openai.com/api/accounts/deviceauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id, user_code }),
    },
  );

  if (res.status === 403 || res.status === 404) {
    return { status: "pending" };
  }

  if (res.ok) {
    const data = await res.json();
    return {
      status: "complete",
      authorization_code: data.authorization_code,
      code_verifier: data.code_verifier,
    };
  }

  const text = await res.text();
  throw new Error(`인증 확인에 실패했습니다: ${text}`);
}

export async function exchangeCodeForTokens(
  authorization_code: string,
  code_verifier: string,
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorization_code,
    code_verifier: code_verifier,
    client_id: CLIENT_ID,
    redirect_uri: "http://localhost:1455/auth/callback",
  });

  const res = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`토큰 교환에 실패했습니다: ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
  };
}

export function saveAuthTokens(tokens: OAuthTokens): void {
  const authFile =
    process.env.CODEX_AUTH_FILE ?? join(homedir(), ".codex", "auth.json");

  mkdirSync(dirname(authFile), { recursive: true });

  const payload = {
    auth_mode: "ChatGpt",
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
    },
  };

  writeFileSync(authFile, JSON.stringify(payload, null, 2), "utf-8");
}
