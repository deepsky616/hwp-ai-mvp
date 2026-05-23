import { createServer } from "node:http";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

function fsModule(): typeof import("node:fs") {
  return nodeRequire("node:fs") as typeof import("node:fs");
}

function osModule(): typeof import("node:os") {
  return nodeRequire("node:os") as typeof import("node:os");
}

const GEMINI_DIR = ".gemini";
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// ─── 자격증명 동적 취득 ────────────────────────────────────────────────────
// 하드코딩을 피하기 위해 설치된 Gemini CLI 번들에서 런타임에 읽습니다.
// 환경 변수 GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET 으로 재정의 가능합니다.

function findGeminiBundleDir(): string | null {
  const home = osModule().homedir();
  const candidates: string[] = [
    join(home, ".npm-global", "lib", "node_modules", "@google", "gemini-cli", "bundle"),
    join(home, ".local", "lib", "node_modules", "@google", "gemini-cli", "bundle"),
    join(home, ".bun", "install", "global", "node_modules", "@google", "gemini-cli", "bundle"),
    "/opt/homebrew/lib/node_modules/@google/gemini-cli/bundle",
    "/usr/local/lib/node_modules/@google/gemini-cli/bundle",
    "/usr/lib/node_modules/@google/gemini-cli/bundle",
  ];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    candidates.push(
      join(appData, "npm", "node_modules", "@google", "gemini-cli", "bundle"),
      join(localAppData, "pnpm", "node_modules", "@google", "gemini-cli", "bundle"),
    );
  }
  for (const dir of candidates) {
    try {
      if (fsModule().statSync(join(dir, "gemini.js")).isFile()) return dir;
    } catch {
      // not found
    }
  }
  return null;
}

function extractCredentialsFromBundle(bundleDir: string): { clientId: string; clientSecret: string } | null {
  try {
    const files = fsModule().readdirSync(bundleDir).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const content = fsModule().readFileSync(join(bundleDir, file), "utf-8");
      const idMatch = content.match(/OAUTH_CLIENT_ID\s*=\s*"([^"]+googleusercontent\.com[^"]*)"/);
      const secretMatch = content.match(/OAUTH_CLIENT_SECRET\s*=\s*"(GOCSPX-[^"]*)"/);
      if (idMatch?.[1] && secretMatch?.[1]) {
        return { clientId: idMatch[1], clientSecret: secretMatch[1] };
      }
    }
  } catch {
    // ignore read errors
  }
  return null;
}

function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  const envId = process.env.GEMINI_OAUTH_CLIENT_ID?.trim();
  const envSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET?.trim();
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };

  const bundleDir = findGeminiBundleDir();
  if (bundleDir) {
    const creds = extractCredentialsFromBundle(bundleDir);
    if (creds) return creds;
  }

  throw new Error(
    "Gemini OAuth 인증 정보를 찾을 수 없습니다. " +
    "Gemini CLI를 먼저 설치하거나 환경 변수 GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET을 설정해 주세요.",
  );
}

// ─── 인증 상태 ────────────────────────────────────────────────────────────

function getCredentialsPath(): string {
  return join(osModule().homedir(), GEMINI_DIR, "oauth_creds.json");
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export type GeminiAuthStatus = {
  authenticated: boolean;
  message: string;
};

export function getGeminiAuthStatus(): GeminiAuthStatus {
  try {
    const raw = fsModule().readFileSync(getCredentialsPath(), "utf-8");
    const creds = JSON.parse(raw) as Record<string, unknown>;
    if (creds.refresh_token || creds.access_token) {
      return { authenticated: true, message: "Gemini CLI 로그인이 완료된 상태입니다." };
    }
  } catch {
    // file not found or parse error
  }
  return { authenticated: false, message: "Gemini CLI 로그인이 필요합니다." };
}

// ─── 로그인 흐름 ──────────────────────────────────────────────────────────

type SessionResult = { status: "complete" } | { status: "error"; error: string };
// Next.js의 route별 모듈 격리에 대비해 globalThis로 세션 결과를 공유합니다.
const globalForGemini = globalThis as unknown as { __geminiLoginSessions?: Map<string, SessionResult> };
const completedSessions = (globalForGemini.__geminiLoginSessions ??= new Map<string, SessionResult>());

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  port: number,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `http://127.0.0.1:${port}/callback`,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`토큰 교환에 실패했습니다: ${text}`);
  }

  const tokens = (await res.json()) as Record<string, unknown>;
  const credDir = join(osModule().homedir(), GEMINI_DIR);
  fsModule().mkdirSync(credDir, { recursive: true });
  fsModule().writeFileSync(join(credDir, "oauth_creds.json"), JSON.stringify(tokens, null, 2), "utf-8");
}

export async function startGeminiLogin(): Promise<{ authUrl: string; sessionId: string }> {
  const { clientId, clientSecret } = getOAuthCredentials();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");
  const sessionId = randomBytes(16).toString("hex");

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer(async (req, res) => {
      const addr = server.address() as { port: number };
      const callbackPort = addr.port;

      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const receivedState = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const oauthError = url.searchParams.get("error") ?? "";

      if (oauthError || receivedState !== state || !code) {
        const msg = oauthError || "잘못된 응답";
        completedSessions.set(sessionId, { status: "error", error: msg });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body><p>로그인 실패: ${msg}</p></body></html>`);
        server.close();
        return;
      }

      try {
        await exchangeCodeForTokens(code, codeVerifier, callbackPort, clientId, clientSecret);
        completedSessions.set(sessionId, { status: "complete" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><script>window.close();</script><p>로그인이 완료되었습니다. 이 창을 닫아도 됩니다.</p></body></html>");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "알 수 없는 오류";
        completedSessions.set(sessionId, { status: "error", error: msg });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body><p>오류: ${msg}</p></body></html>`);
      }

      server.close();
    });

    const timeout = setTimeout(() => {
      if (!completedSessions.has(sessionId)) {
        completedSessions.set(sessionId, { status: "error", error: "로그인 시간이 초과되었습니다 (10분)." });
        server.close();
      }
    }, LOGIN_TIMEOUT_MS);

    server.on("close", () => clearTimeout(timeout));
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolvePort(addr.port);
    });
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", `http://127.0.0.1:${port}/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  return { authUrl: authUrl.toString(), sessionId };
}

export function pollGeminiLoginCompletion(sessionId: string): {
  status: "pending" | "complete" | "error";
  error?: string;
} {
  const result = completedSessions.get(sessionId);
  if (!result) return { status: "pending" };
  completedSessions.delete(sessionId);
  if (result.status === "complete") return { status: "complete" };
  return { status: "error", error: result.error };
}
