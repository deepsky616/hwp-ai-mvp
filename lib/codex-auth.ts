import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
    account_id?: string;
  };
};

const OPENAI_API_MODELS = ["gpt-4.1-mini", "gpt-4.1", "o4-mini", "o3-mini"];
const CODEX_CLI_MODELS = ["gpt-5.5"];

export type CodexDeviceLoginStart = {
  ok: true;
  loginUrl: string;
  code: string;
  expiresInMinutes: number;
  message: string;
};

export function getCodexAuthFilePath(): string {
  return process.env.CODEX_AUTH_FILE || join(homedir(), ".codex", "auth.json");
}

function readCodexAuthFile(): CodexAuthFile | null {
  const authFile = getCodexAuthFilePath();
  if (!existsSync(authFile)) return null;
  try {
    return JSON.parse(readFileSync(authFile, "utf8")) as CodexAuthFile;
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
      authenticated: false,
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
    .filter((id) => !id.includes("embedding") && !id.includes("audio") && !id.includes("whisper") && !id.includes("tts"));

  return Array.from(new Set(usable)).sort((a, b) => {
    const preferred = ["gpt-5.5", "gpt-4.1-mini", "gpt-4.1", "o4-mini", "o3-mini"];
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return a.localeCompare(b);
  });
}

function getConfiguredCodexModels(): string[] {
  try {
    const configPath = join(homedir(), ".codex", "config.toml");
    if (!existsSync(configPath)) return CODEX_CLI_MODELS;
    const config = readFileSync(configPath, "utf8");
    const models = Array.from(config.matchAll(/"(gpt-[^"]+)"\s*=/g)).map((match) => match[1]);
    return Array.from(new Set([...models, ...CODEX_CLI_MODELS]));
  } catch {
    return CODEX_CLI_MODELS;
  }
}

function parseCodexDeviceLoginOutput(output: string): Pick<CodexDeviceLoginStart, "loginUrl" | "code"> | null {
  const loginUrl = output.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0];
  const code = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/)?.[0];
  if (!loginUrl || !code) return null;
  return { loginUrl, code };
}

async function runCodexDeviceLoginCommand(codexPath: string): Promise<Pick<CodexDeviceLoginStart, "loginUrl" | "code">> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const child = spawn(codexPath, ["login", "--device-auth"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (result: Pick<CodexDeviceLoginStart, "loginUrl" | "code">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref?.();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const appendOutput = (chunk: Buffer | string) => {
      output += chunk.toString();
      const parsed = parseCodexDeviceLoginOutput(output);
      if (parsed) finish(parsed);
    };

    const timer = setTimeout(() => {
      fail(new Error("OpenAI 계정 로그인 코드를 시간 안에 받지 못했습니다. 서버에서 codex login --device-auth 명령을 직접 확인해 주세요."));
    }, 30000);

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.on("error", fail);
    child.on("close", (code) => {
      const parsed = parseCodexDeviceLoginOutput(output);
      if (parsed) {
        finish(parsed);
        return;
      }
      fail(new Error(`OpenAI 계정 로그인 주소나 인증 코드를 읽지 못했습니다. 종료 코드: ${code ?? "알 수 없음"}`));
    });
  });
}

export async function startCodexDeviceLogin(): Promise<CodexDeviceLoginStart> {
  if (process.env.VERCEL) {
    throw new Error("OpenAI 계정 로그인 시작은 로컬 실행 환경에서만 사용할 수 있습니다. 배포 환경에서는 API 키 방식을 사용해 주세요.");
  }

  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const { loginUrl, code } = await runCodexDeviceLoginCommand(codexPath);

  return {
    ok: true,
    loginUrl,
    code,
    expiresInMinutes: 15,
    message: "OpenAI 계정 로그인 창에서 코드를 입력한 뒤 상태 새로고침을 눌러 주세요.",
  };
}

export async function listUsableModels(): Promise<string[]> {
  const authorization = getOpenAiAuthorization();
  if (!authorization) return CODEX_CLI_MODELS;
  if (authorization.source === "codex-oauth") return getConfiguredCodexModels();

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: authorization.header },
  });

  if (!response.ok) return OPENAI_API_MODELS;
  const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const normalized = normalizeModelList(data.data ?? []);
  return normalized.length ? normalized : OPENAI_API_MODELS;
}
