import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_OPENAI_MODELS } from "./model-defaults";

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

type LoginStatusExec = (command: string, args: string[], envPath: string) => Promise<string>;

const defaultLoginStatusExec: LoginStatusExec = (command, args, envPath) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { env: { ...process.env, PATH: envPath }, timeout: 10_000 },
      (error, stdout, stderr) => {
        const text = `${stdout ?? ""}\n${stderr ?? ""}`;
        // 미로그인 시 codex는 0이 아닌 코드로 끝나지만 출력에 상태가 담겨 있다.
        if (error && !text.trim()) { reject(error); return; }
        resolve(text);
      },
    );
  });

// 최신 codex CLI는 자격증명을 auth.json 파일이 아니라 OS 키링(keyring)에
// 저장하므로, 파일이 없으면 CLI에 직접 로그인 상태를 물어 판정한다.
export async function getCodexAuthStatusAsync(
  customPath?: string,
  execLoginStatus: LoginStatusExec = defaultLoginStatusExec,
): Promise<CodexAuthStatus> {
  const fileStatus = getCodexAuthStatus();
  if (fileStatus.authenticated) return fileStatus;

  try {
    const { resolveCli } = await import("./cli-resolver");
    const resolved = resolveCli("codex", customPath);
    const output = await execLoginStatus(resolved.command, [...resolved.argsPrefix, "login", "status"], resolved.envPath);
    const lower = output.toLowerCase();
    if (lower.includes("logged in") && !lower.includes("not logged in")) {
      const viaApiKey = lower.includes("api key");
      return {
        authenticated: true,
        source: viaApiKey ? "api-key" : "codex-oauth",
        authFile: fileStatus.authFile,
        message: viaApiKey
          ? "Codex CLI가 API 키로 로그인되어 있습니다."
          : "OpenAI 계정 로그인이 연결되어 있습니다.",
      };
    }
  } catch {
    // CLI 미설치·실행 실패 시에는 파일 기반 결과를 그대로 쓴다.
  }
  return fileStatus;
}

export function getOpenAiAuthorization(): { header: string; source: Exclude<AuthSource, "missing"> } | null {
  const auth = readCodexAuthFile();
  const accessToken = auth?.tokens?.access_token?.trim();
  if (accessToken) return { header: `Bearer ${accessToken}`, source: "codex-oauth" };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) return { header: `Bearer ${apiKey}`, source: "api-key" };

  return null;
}

export async function getOpenAiAuthorizationAsync(): Promise<{
  header: string;
  source: Exclude<AuthSource, "missing">;
} | null> {
  return getOpenAiAuthorization();
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

export async function listUsableModels(): Promise<string[]> {
  // ChatGPT 구독 OAuth 토큰은 플랫폼 API(api.openai.com)에서 거부되므로
  // API 키 인증일 때만 원격 모델 목록을 조회하고, 그 외에는 기본 목록을 쓴다.
  const authorization = await getOpenAiAuthorizationAsync();
  if (!authorization || authorization.source !== "api-key") return DEFAULT_OPENAI_MODELS;

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: authorization.header },
  });

  if (!response.ok) return DEFAULT_OPENAI_MODELS;
  const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const normalized = normalizeModelList(data.data ?? []);
  return normalized.length ? normalized : DEFAULT_OPENAI_MODELS;
}
