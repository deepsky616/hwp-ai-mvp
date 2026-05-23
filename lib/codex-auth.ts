import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startDeviceAuth, pollDeviceAuth, exchangeCodeForTokens, saveAuthTokens } from "./openai-device-auth";

export type AuthSource = "codex-oauth" | "api-key" | "missing";

export type CodexAuthStatus = {
  authenticated: boolean;
  source: AuthSource;
  authFile: string;
  accountId?: string;
  lastRefresh?: string;
  message: string;
};

type CodexAuthFile = {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  last_refresh?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
};

export type CodexDeviceLoginStart = {
  ok: true;
  loginUrl: string;
  code: string;
  device_auth_id: string;
  expiresInMinutes: number;
  message: string;
};

export function getCodexAuthFilePath(): string {
  return process.env.CODEX_AUTH_FILE || join(homedir(), ".codex", "auth.json");
}

// Codex CLI Rust 바이너리는 auth_mode 값을 엄격히 소문자로 비교합니다.
// 이전 버전에서 "ChatGpt"(대문자 G)로 저장된 파일을 자동으로 수정합니다.
function migrateAuthModeIfNeeded(filePath: string, data: CodexAuthFile): void {
  if (typeof data.auth_mode !== "string") return;
  const VALID = new Set(["apikey", "chatgpt", "chatgptAuthTokens", "agentIdentity"]);
  if (VALID.has(data.auth_mode)) return;
  const lower = data.auth_mode.toLowerCase();
  if (lower === "chatgpt") {
    data.auth_mode = "chatgpt";
    try { writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch { /* ignore */ }
  }
}

// CLI 실행 직전에 외부에서 호출 가능하도록 export
export function migrateCodexAuthIfNeeded(): void {
  const filePath = getCodexAuthFilePath();
  if (!existsSync(filePath)) return;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as CodexAuthFile;
    migrateAuthModeIfNeeded(filePath, data);
  } catch { /* ignore */ }
}

function readCodexAuthFile(): CodexAuthFile | null {
  const authFile = getCodexAuthFilePath();
  if (!existsSync(authFile)) return null;
  try {
    const data = JSON.parse(readFileSync(authFile, "utf8")) as CodexAuthFile;
    migrateAuthModeIfNeeded(authFile, data);
    return data;
  } catch {
    return null;
  }
}

export function getCodexAuthStatus(): CodexAuthStatus {
  const authFile = getCodexAuthFilePath();
  const auth = readCodexAuthFile();
  const accessToken = auth?.tokens?.access_token?.trim();

  if (accessToken) {
    return {
      authenticated: true,
      source: "codex-oauth",
      authFile,
      accountId: auth?.tokens?.account_id,
      lastRefresh: auth?.last_refresh,
      message: "OpenAI 계정 로그인이 연결되어 있습니다.",
    };
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    return {
      authenticated: true,
      source: "api-key",
      authFile,
      message: "OpenAI 계정 로그인은 없지만 서버 환경 변수 키가 연결되어 있습니다.",
    };
  }

  return {
    authenticated: false,
    source: "missing",
    authFile,
    message: "OpenAI 계정 로그인이나 API 키 설정이 필요합니다.",
  };
}

export function getOpenAiAuthorization(): { header: string; source: Exclude<AuthSource, "missing"> } | null {
  const auth = readCodexAuthFile();
  const accessToken = auth?.tokens?.access_token?.trim();
  if (accessToken) return { header: `Bearer ${accessToken}`, source: "codex-oauth" };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) return { header: `Bearer ${apiKey}`, source: "api-key" };

  return null;
}

export function normalizeModelList(models: Array<{ id?: unknown }>): string[] {
  const usable = models
    .map((model) => (typeof model.id === "string" ? model.id : ""))
    .filter(Boolean)
    .filter((id) => /^(gpt|o)\d|^gpt-|^o\d/.test(id))
    .filter(
      (id) =>
        !id.includes("embedding") &&
        !id.includes("audio") &&
        !id.includes("whisper") &&
        !id.includes("tts"),
    );

  return Array.from(new Set(usable)).sort((a, b) => {
    const preferred = ["gpt-4.1-mini", "gpt-4.1", "o4-mini", "o3-mini"];
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return a.localeCompare(b);
  });
}

export async function startCodexDeviceLogin(): Promise<CodexDeviceLoginStart> {
  if (process.env.VERCEL) {
    throw new Error(
      "OpenAI 계정 로그인 시작은 로컬 실행 환경에서만 사용할 수 있습니다. 배포 환경에서는 API 키 방식을 사용해 주세요.",
    );
  }

  const { device_auth_id, user_code } = await startDeviceAuth();

  return {
    ok: true,
    loginUrl: "https://auth.openai.com/codex/device",
    code: user_code,
    device_auth_id,
    expiresInMinutes: 15,
    message: "OpenAI 계정 로그인 창에서 코드를 입력한 뒤 잠시 기다려 주세요.",
  };
}

export async function pollAndCompleteLogin(
  device_auth_id: string,
  user_code: string,
): Promise<{ status: "pending" | "complete" }> {
  const result = await pollDeviceAuth(device_auth_id, user_code);
  if (result.status === "pending") return { status: "pending" };
  const tokens = await exchangeCodeForTokens(result.authorization_code, result.code_verifier);
  saveAuthTokens(tokens);
  return { status: "complete" };
}

export async function completeLoginWithAuthorizationCode(
  authorization_code: string,
  code_verifier: string,
): Promise<{ ok: true }> {
  const tokens = await exchangeCodeForTokens(authorization_code, code_verifier);
  saveAuthTokens(tokens);
  return { ok: true };
}

export async function listUsableModels(): Promise<string[]> {
  const OPENAI_API_MODELS = ["gpt-4.1-mini", "gpt-4.1", "o4-mini", "o3-mini"];
  const authorization = getOpenAiAuthorization();
  if (!authorization) return OPENAI_API_MODELS;

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: authorization.header },
  });

  if (!response.ok) return OPENAI_API_MODELS;
  const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const normalized = normalizeModelList(data.data ?? []);
  return normalized.length ? normalized : OPENAI_API_MODELS;
}
