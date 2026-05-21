# OpenAI Device Auth + 순수 HTTP 편집 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** codex CLI 바이너리 의존성을 완전히 제거하고, 순수 HTTP로 OpenAI device auth 로그인과 문서 편집을 구현한다.

**Architecture:** `lib/openai-device-auth.ts`가 OpenAI device auth 3단계(코드발급→폴링→토큰교환)를 HTTP fetch로 구현한다. `lib/ai-edit.ts`에서 `spawn("codex")` 호출을 모두 제거하고 OpenAI Chat Completions API를 직접 호출한다. 프론트엔드는 5초마다 `/api/codex/login/poll`을 호출해 로그인 완료를 자동 감지한다.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, node:fs (auth.json 저장)

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `lib/openai-device-auth.ts` | **신규** — device auth HTTP 3단계 구현 |
| `lib/openai-device-auth.test.ts` | **신규** — 위 파일 단위 테스트 |
| `lib/openai-login-popup.ts` | **수정** — `OpenAiLoginStartResult`에 `device_auth_id` 필드 추가 |
| `lib/codex-auth.ts` | **수정** — `startCodexDeviceLogin` → openai-device-auth 사용, spawn 제거, `pollAndCompleteLogin` 추가 |
| `app/api/codex/login/poll/route.ts` | **신규** — 단일 폴링 호출 엔드포인트 |
| `lib/ai-edit.ts` | **수정** — spawn 제거, `openai-oauth` → Chat Completions 직접 호출 |
| `lib/useAiSettings.ts` | **수정** — 5초 자동 폴링 추가, device_auth_id 상태 관리 |
| `components/SettingsPanel.tsx` | **수정** — 로그인 완료 시 위저드 자동 전진 |

---

### Task 1: `lib/openai-device-auth.ts` 작성 및 테스트

**Files:**
- Create: `lib/openai-device-auth.ts`
- Create: `lib/openai-device-auth.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`lib/openai-device-auth.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startDeviceAuth, pollDeviceAuth, exchangeCodeForTokens } from "./openai-device-auth";

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

describe("startDeviceAuth", () => {
  it("device_auth_id와 user_code를 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ device_auth_id: "dev-123", user_code: "ABCD-12345", interval: "5" }),
    });
    const result = await startDeviceAuth();
    expect(result).toEqual({ device_auth_id: "dev-123", user_code: "ABCD-12345", interval: 5 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }),
    );
  });

  it("API 오류 시 한국어 메시지로 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "Unauthorized" });
    await expect(startDeviceAuth()).rejects.toThrow("인증 코드 발급에 실패했습니다");
  });
});

describe("pollDeviceAuth", () => {
  it("403 응답 시 pending을 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({ status: 403, ok: false });
    expect(await pollDeviceAuth("dev-123", "ABCD-12345")).toEqual({ status: "pending" });
  });

  it("404 응답 시 pending을 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false });
    expect(await pollDeviceAuth("dev-123", "ABCD-12345")).toEqual({ status: "pending" });
  });

  it("200 응답 시 authorization_code와 code_verifier를 반환한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ authorization_code: "auth-xyz", code_verifier: "verifier-abc" }),
    });
    expect(await pollDeviceAuth("dev-123", "ABCD-12345")).toEqual({
      status: "complete",
      authorization_code: "auth-xyz",
      code_verifier: "verifier-abc",
    });
  });

  it("기타 오류 상태 시 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({ status: 500, ok: false, text: async () => "Server Error" });
    await expect(pollDeviceAuth("dev-123", "ABCD-12345")).rejects.toThrow("인증 확인에 실패했습니다");
  });
});

describe("exchangeCodeForTokens", () => {
  it("authorization_code를 access_token으로 교환한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at-1", refresh_token: "rt-1", id_token: "it-1" }),
    });
    const result = await exchangeCodeForTokens("auth-xyz", "verifier-abc");
    expect(result).toEqual({ access_token: "at-1", refresh_token: "rt-1", id_token: "it-1" });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.openai.com/oauth/token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=auth-xyz");
    expect(String(init.body)).toContain("code_verifier=verifier-abc");
  });

  it("교환 실패 시 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "Bad request" });
    await expect(exchangeCodeForTokens("bad-code", "bad-verifier")).rejects.toThrow("토큰 교환에 실패했습니다");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npm test -- lib/openai-device-auth.test.ts
```

예상: `FAIL` — `openai-device-auth` 모듈이 없어서 import 실패

- [ ] **Step 3: `lib/openai-device-auth.ts` 구현**

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEVICE_AUTH_BASE = "https://auth.openai.com/api/accounts/deviceauth";
const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";

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

export async function startDeviceAuth(): Promise<DeviceAuthStart> {
  const res = await fetch(`${DEVICE_AUTH_BASE}/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`인증 코드 발급에 실패했습니다: ${await res.text()}`);
  const data = (await res.json()) as { device_auth_id: string; user_code: string; interval: string };
  return {
    device_auth_id: data.device_auth_id,
    user_code: data.user_code,
    interval: parseInt(data.interval, 10) || 5,
  };
}

export async function pollDeviceAuth(
  device_auth_id: string,
  user_code: string,
): Promise<DeviceAuthPollResult> {
  const res = await fetch(`${DEVICE_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id, user_code }),
  });
  if (res.status === 403 || res.status === 404) return { status: "pending" };
  if (!res.ok) throw new Error(`인증 확인에 실패했습니다: ${await res.text()}`);
  const data = (await res.json()) as { authorization_code: string; code_verifier: string };
  return { status: "complete", authorization_code: data.authorization_code, code_verifier: data.code_verifier };
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
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`토큰 교환에 실패했습니다: ${await res.text()}`);
  return (await res.json()) as OAuthTokens;
}

export function saveAuthTokens(tokens: OAuthTokens): void {
  const authFile = process.env.CODEX_AUTH_FILE || join(homedir(), ".codex", "auth.json");
  mkdirSync(dirname(authFile), { recursive: true });
  writeFileSync(
    authFile,
    JSON.stringify(
      {
        auth_mode: "ChatGpt",
        last_refresh: new Date().toISOString(),
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          id_token: tokens.id_token,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npm test -- lib/openai-device-auth.test.ts
```

예상: `PASS` — 6개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add lib/openai-device-auth.ts lib/openai-device-auth.test.ts
git commit -m "feat: OpenAI device auth 순수 HTTP 구현 (spawn codex 제거)"
```

---

### Task 2: `OpenAiLoginStartResult` 타입에 `device_auth_id` 추가

**Files:**
- Modify: `lib/openai-login-popup.ts:1-7`

- [ ] **Step 1: 타입 수정**

`lib/openai-login-popup.ts`의 `OpenAiLoginStartResult` 타입을:

```typescript
export type OpenAiLoginStartResult = {
  ok: true;
  loginUrl: string;
  code: string;
  expiresInMinutes: number;
  message: string;
};
```

다음으로 변경:

```typescript
export type OpenAiLoginStartResult = {
  ok: true;
  loginUrl: string;
  code: string;
  device_auth_id: string;
  expiresInMinutes: number;
  message: string;
};
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npx tsc --noEmit
```

예상: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add lib/openai-login-popup.ts
git commit -m "feat: OpenAiLoginStartResult에 device_auth_id 필드 추가"
```

---

### Task 3: `lib/codex-auth.ts` 수정 — spawn 제거, HTTP 구현 사용

**Files:**
- Modify: `lib/codex-auth.ts`

- [ ] **Step 1: 파일 전체를 다음 내용으로 교체**

```typescript
import { existsSync, readFileSync } from "node:fs";
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
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npx tsc --noEmit
```

예상: 오류 없음

- [ ] **Step 3: 전체 테스트**

```bash
npm test
```

예상: 기존 테스트 모두 통과

- [ ] **Step 4: 커밋**

```bash
git add lib/codex-auth.ts
git commit -m "refactor: codex-auth에서 spawn 제거, openai-device-auth HTTP 구현으로 교체"
```

---

### Task 4: `/api/codex/login/poll` 라우트 신규 생성

**Files:**
- Create: `app/api/codex/login/poll/route.ts`

- [ ] **Step 1: 파일 생성**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { pollAndCompleteLogin } from "../../../../../lib/codex-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const device_auth_id = searchParams.get("device_auth_id") ?? "";
  const user_code = searchParams.get("user_code") ?? "";

  if (!device_auth_id || !user_code) {
    return NextResponse.json(
      { status: "error", error: "device_auth_id와 user_code가 필요합니다" },
      { status: 400 },
    );
  }

  try {
    const result = await pollAndCompleteLogin(device_auth_id, user_code);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npx tsc --noEmit
```

예상: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add app/api/codex/login/poll/route.ts
git commit -m "feat: /api/codex/login/poll GET 라우트 추가 — device auth 폴링 엔드포인트"
```

---

### Task 5: `lib/ai-edit.ts` 수정 — spawn 완전 제거

**Files:**
- Modify: `lib/ai-edit.ts`

- [ ] **Step 1: 파일 전체를 다음 내용으로 교체**

```typescript
import { getOpenAiAuthorization } from "./codex-auth";
import type { DocumentBlock, DocumentPatch } from "./document";

export type AiProvider = "openai" | "openai-oauth" | "ollama" | "mlx" | "custom";

export type AiSettings = {
  provider?: AiProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type AiEditRequest = {
  instruction: string;
  blocks: DocumentBlock[];
  model?: string;
  aiSettings?: AiSettings;
};

function parseJsonFromText(text: string): { patches?: DocumentPatch[] } {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("모델 응답을 JSON으로 해석하지 못했습니다");
  }
}

function sanitizeModel(model?: string): string {
  const trimmed = model?.trim();
  if (!trimmed) return process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!/^[a-zA-Z0-9._:\/-]+$/.test(trimmed)) return "gpt-4.1-mini";
  return trimmed;
}

function sanitizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  const trimmed = baseUrl?.trim() || fallback;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return fallback;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function resolveRequestModel(request: AiEditRequest): string {
  return sanitizeModel(request.aiSettings?.model || request.model);
}

function getClientOpenAiAuthorization(settings?: AiSettings) {
  const key = settings?.apiKey?.trim();
  if (!key) return null;
  return { header: `Bearer ${key}`, source: "api-key" as const };
}

export function buildAiEditPayload({ instruction, blocks, model }: AiEditRequest) {
  return {
    model: sanitizeModel(model),
    input: [
      {
        role: "system",
        content: [
          "당신은 한국어 문서 편집 전문가입니다.",
          "입력된 블록 좌표는 절대 바꾸지 마세요.",
          "수정이 필요한 블록만 patches 배열로 반환하세요.",
          "표 셀은 tableCell 타입을 유지하고 본문은 paragraph 타입을 유지하세요.",
          "반드시 JSON만 반환하세요.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction,
          blocks,
          outputSchema: {
            patches: [
              {
                type: "paragraph",
                sectionIndex: 0,
                paragraphIndex: 0,
                text: "수정된 문장",
              },
              {
                type: "tableCell",
                sectionIndex: 0,
                parentParagraphIndex: 0,
                controlIndex: 0,
                cellIndex: 0,
                cellParagraphIndex: 0,
                text: "수정된 셀 문장",
              },
            ],
          },
        }),
      },
    ],
  };
}

export function extractResponseText(data: unknown): string {
  if (typeof (data as Record<string, unknown>)?.output_text === "string")
    return (data as Record<string, unknown>).output_text as string;
  if (Array.isArray((data as Record<string, unknown>)?.output)) {
    return ((data as Record<string, unknown>).output as unknown[])
      .flatMap((item) => (item as Record<string, unknown>)?.content ?? [])
      .map((item) => (item as Record<string, unknown>)?.text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function buildChatMessages(request: AiEditRequest) {
  const payload = buildAiEditPayload({ ...request, model: resolveRequestModel(request) });
  return payload.input.map((item) => ({ role: item.role, content: item.content }));
}

function extractChatResponseText(data: unknown): string {
  const d = data as Record<string, unknown>;
  if (typeof (d?.message as Record<string, unknown>)?.content === "string")
    return (d.message as Record<string, unknown>).content as string;
  if (
    typeof ((d?.choices as unknown[])?.[0] as Record<string, unknown>)?.message !== "undefined" &&
    typeof ((((d?.choices as unknown[])?.[0] as Record<string, unknown>)?.message) as Record<string, unknown>)?.content === "string"
  ) {
    return ((((d?.choices as unknown[])?.[0] as Record<string, unknown>)?.message) as Record<string, unknown>).content as string;
  }
  return extractResponseText(data);
}

async function requestPatchesWithOpenAiCompatible(
  request: AiEditRequest,
  baseUrl: string,
  authorizationHeader?: string,
): Promise<DocumentPatch[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorizationHeader) headers.Authorization = authorizationHeader;
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: resolveRequestModel(request),
      messages: buildChatMessages(request),
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`모델 호출에 실패했습니다: ${detail}`);
  }

  const data = await response.json();
  return parseJsonFromText(extractChatResponseText(data)).patches ?? [];
}

async function requestPatchesWithOllama(request: AiEditRequest): Promise<DocumentPatch[]> {
  const baseUrl = sanitizeBaseUrl(request.aiSettings?.baseUrl, "http://localhost:11434");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: resolveRequestModel(request),
      messages: buildChatMessages(request),
      stream: false,
      options: { temperature: 0 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`모델 호출에 실패했습니다: ${detail}`);
  }

  const data = await response.json();
  return parseJsonFromText(extractChatResponseText(data)).patches ?? [];
}

export async function testAiConnection(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
  const provider = settings.provider || "openai";

  if (provider === "openai-oauth") {
    const authorization = getOpenAiAuthorization();
    if (!authorization) {
      throw new Error(
        "OpenAI 계정 로그인이 필요합니다. 먼저 인공지능 설정에서 OpenAI 계정 로그인을 연결해 주세요.",
      );
    }
    return { ok: true, message: "OpenAI 계정 로그인이 연결되어 있습니다." };
  }

  if (provider === "ollama") {
    const baseUrl = sanitizeBaseUrl(settings.baseUrl, "http://localhost:11434");
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`연결 테스트에 실패했습니다: ${await response.text()}`);
    return { ok: true, message: "올라마 서버 연결에 성공했습니다." };
  }

  const baseUrl =
    provider === "openai"
      ? "https://api.openai.com"
      : sanitizeBaseUrl(
          settings.baseUrl,
          provider === "mlx" ? "http://localhost:8080" : "http://localhost:8080",
        );
  const headers: Record<string, string> = {};
  const key = settings.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  if (provider === "openai" && !key) throw new Error("API 키를 입력해 주세요.");

  const response = await fetch(`${baseUrl}/v1/models`, { headers });
  if (!response.ok) throw new Error(`연결 테스트에 실패했습니다: ${await response.text()}`);
  return { ok: true, message: "인공지능 서버 연결에 성공했습니다." };
}

export async function requestDocumentPatches(request: AiEditRequest): Promise<DocumentPatch[]> {
  const provider = request.aiSettings?.provider || "openai";

  if (provider === "openai-oauth") {
    const authorization = getOpenAiAuthorization();
    if (!authorization) {
      throw new Error(
        "OpenAI 계정 로그인이 필요합니다. 먼저 인공지능 설정에서 OpenAI 계정 로그인을 연결해 주세요.",
      );
    }
    return requestPatchesWithOpenAiCompatible(
      { ...request, model: resolveRequestModel(request) },
      "https://api.openai.com",
      authorization.header,
    );
  }

  if (provider === "ollama") return requestPatchesWithOllama(request);

  if (provider === "mlx" || provider === "custom") {
    const baseUrl = sanitizeBaseUrl(request.aiSettings?.baseUrl, "http://localhost:8080");
    const key = request.aiSettings?.apiKey?.trim();
    return requestPatchesWithOpenAiCompatible(
      request,
      baseUrl,
      key ? `Bearer ${key}` : undefined,
    );
  }

  const authorization = getClientOpenAiAuthorization(request.aiSettings) || getOpenAiAuthorization();
  if (!authorization) {
    throw new Error("인공지능 설정에서 API 키를 입력하거나 서버 환경 변수를 설정해 주세요.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: authorization.header,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildAiEditPayload({ ...request, model: resolveRequestModel(request) })),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`모델 호출에 실패했습니다: ${detail}`);
  }

  const data = await response.json();
  return parseJsonFromText(extractResponseText(data)).patches ?? [];
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npx tsc --noEmit
```

예상: 오류 없음

- [ ] **Step 3: 전체 테스트**

```bash
npm test
```

예상: 기존 테스트 모두 통과

- [ ] **Step 4: 커밋**

```bash
git add lib/ai-edit.ts
git commit -m "refactor: ai-edit에서 spawn(codex) 제거, openai-oauth → Chat Completions 직접 호출"
```

---

### Task 6: `lib/useAiSettings.ts` — 자동 폴링 추가

**Files:**
- Modify: `lib/useAiSettings.ts`

- [ ] **Step 1: 파일 전체를 다음 내용으로 교체**

```typescript
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startBrowserOpenAiAccountLogin, type OpenAiLoginStartResult } from "./openai-login-popup";

export type AiProvider = "openai" | "openai-oauth" | "ollama" | "mlx" | "custom";

export type AiSettings = {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
};

export type CodexStatus = {
  authenticated: boolean;
  source: "codex-oauth" | "api-key" | "missing";
  authFile: string;
  accountId?: string;
  message: string;
};

export function useAiSettings() {
  const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4.1-mini");
  const [models, setModels] = useState<string[]>(["gpt-4.1-mini"]);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [oauthLoginCode, setOauthLoginCode] = useState("");
  const [oauthLoginUrl, setOauthLoginUrl] = useState("");

  // device auth 폴링에 필요한 값 (ref로 관리해 effect 재시작 방지)
  const pollingRef = useRef<{ device_auth_id: string; user_code: string } | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const effectiveAiSettings = useMemo<AiSettings>(
    () => ({
      provider: aiProvider,
      apiKey: aiApiKey.trim() || undefined,
      baseUrl: aiBaseUrl.trim() || undefined,
      model: selectedModel,
    }),
    [aiProvider, aiApiKey, aiBaseUrl, selectedModel],
  );

  const refreshCodexSettings = useCallback(async () => {
    try {
      const statusRes = await fetch("/api/codex/status");
      const statusData = (await statusRes.json()) as CodexStatus;
      setCodexStatus(statusData);
      const modelsRes = await fetch("/api/codex/models");
      const modelsData = (await modelsRes.json()) as { models?: string[] };
      const next = modelsData.models?.length ? modelsData.models : ["gpt-4.1-mini"];
      setModels(next);
      const saved = window.localStorage.getItem("hwp-ai-model");
      setSelectedModel(saved && next.includes(saved) ? saved : next[0]);
    } catch (error) {
      setCodexStatus({
        authenticated: false,
        source: "missing",
        authFile: "~/.codex/auth.json",
        message: error instanceof Error ? error.message : "설정을 불러오지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    refreshCodexSettings();
    const savedProvider = window.localStorage.getItem("hwp-ai-provider") as AiProvider | null;
    const savedKey = window.localStorage.getItem("hwp-ai-api-key");
    const savedUrl = window.localStorage.getItem("hwp-ai-base-url");
    if (
      savedProvider &&
      ["openai", "openai-oauth", "ollama", "mlx", "custom"].includes(savedProvider)
    )
      setAiProvider(savedProvider);
    if (savedKey) setAiApiKey(savedKey);
    if (savedUrl) setAiBaseUrl(savedUrl);
  }, [refreshCodexSettings]);

  useEffect(() => {
    window.localStorage.setItem("hwp-ai-model", selectedModel);
    window.localStorage.setItem("hwp-ai-provider", aiProvider);
    if (aiApiKey.trim()) window.localStorage.setItem("hwp-ai-api-key", aiApiKey.trim());
    else window.localStorage.removeItem("hwp-ai-api-key");
    if (aiBaseUrl.trim()) window.localStorage.setItem("hwp-ai-base-url", aiBaseUrl.trim());
    else window.localStorage.removeItem("hwp-ai-base-url");
  }, [selectedModel, aiProvider, aiApiKey, aiBaseUrl]);

  // 5초마다 device auth 완료 여부 폴링
  useEffect(() => {
    if (!isPolling) return;
    const id = setInterval(async () => {
      const p = pollingRef.current;
      if (!p) return;
      try {
        const res = await fetch(
          `/api/codex/login/poll?device_auth_id=${encodeURIComponent(p.device_auth_id)}&user_code=${encodeURIComponent(p.user_code)}`,
        );
        const data = (await res.json()) as { status: string; error?: string };
        if (data.status === "complete") {
          pollingRef.current = null;
          setIsPolling(false);
          setAiTestMessage("로그인이 완료되었습니다. 설정을 불러오는 중...");
          await refreshCodexSettings();
          setAiTestMessage("로그인이 완료되었습니다.");
        }
      } catch {
        // 일시적 네트워크 오류는 무시하고 계속 폴링
      }
    }, 5000);
    return () => clearInterval(id);
  }, [isPolling, refreshCodexSettings]);

  const testAiSettings = useCallback(async () => {
    setAiTestMessage("연결을 확인하는 중입니다...");
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiSettings: effectiveAiSettings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "연결 테스트에 실패했습니다");
      setAiTestMessage(data.message || "연결에 성공했습니다.");
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, [effectiveAiSettings]);

  const startOpenAiOauthLogin = useCallback(async () => {
    setAiProvider("openai-oauth");
    setAiTestMessage("OpenAI 계정 로그인 코드를 만드는 중입니다...");
    setOauthLoginCode("");
    setOauthLoginUrl("");
    setIsPolling(false);
    pollingRef.current = null;

    const isElectron =
      typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

    try {
      const result = await startBrowserOpenAiAccountLogin({
        openWindow: (url, target, features) => {
          if (isElectron && (!url || url === "about:blank")) return null;
          return window.open(url, target, features);
        },
        requestLoginStart: async (): Promise<OpenAiLoginStartResult> => {
          const res = await fetch("/api/codex/login/start", { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "로그인을 시작하지 못했습니다");
          return data as OpenAiLoginStartResult;
        },
      });

      const loginData = result.data;
      setOauthLoginCode(loginData.code || "");
      setOauthLoginUrl(loginData.loginUrl || "");

      // device_auth_id가 있으면 자동 폴링 시작
      if (loginData.device_auth_id && loginData.code) {
        pollingRef.current = { device_auth_id: loginData.device_auth_id, user_code: loginData.code };
        setIsPolling(true);
        setAiTestMessage("로그인 창에서 코드를 입력해 주세요. 완료되면 자동으로 감지합니다.");
      } else {
        const notice = result.popupBlocked ? " 팝업이 차단되면 아래 링크를 눌러 주세요." : "";
        setAiTestMessage(
          (loginData.message || "로그인 창에서 코드를 입력해 주세요.") + notice,
        );
      }
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return {
    aiProvider,
    setAiProvider,
    aiApiKey,
    setAiApiKey,
    aiBaseUrl,
    setAiBaseUrl,
    selectedModel,
    setSelectedModel,
    models,
    codexStatus,
    effectiveAiSettings,
    aiTestMessage,
    oauthLoginCode,
    oauthLoginUrl,
    isPolling,
    refreshCodexSettings,
    testAiSettings,
    startOpenAiOauthLogin,
  };
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npx tsc --noEmit
```

예상: 오류 없음

- [ ] **Step 3: 전체 테스트**

```bash
npm test
```

예상: 통과

- [ ] **Step 4: 커밋**

```bash
git add lib/useAiSettings.ts
git commit -m "feat: useAiSettings에 device auth 자동 폴링 추가 (5초 간격)"
```

---

### Task 7: `components/SettingsPanel.tsx` — 폴링 중 UI + 자동 완료

**Files:**
- Modify: `components/SettingsPanel.tsx`

- [ ] **Step 1: `SettingsPanelProps`에 `isPolling` 추가 및 WizardModal 수정**

`SettingsPanelProps` 타입에 `isPolling: boolean` 추가:

```typescript
type SettingsPanelProps = {
  aiProvider: AiProvider;
  setAiProvider: (p: AiProvider) => void;
  aiApiKey: string;
  setAiApiKey: (k: string) => void;
  aiBaseUrl: string;
  setAiBaseUrl: (u: string) => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  models: string[];
  codexStatus: CodexStatus | null;
  aiTestMessage: string;
  oauthLoginCode: string;
  oauthLoginUrl: string;
  isPolling: boolean;
  onTest: () => void;
  onRefresh: () => void;
  onOauthLogin: () => void;
  onClose: () => void;
};
```

OAuth 위저드 단계를 다음으로 교체:

```tsx
{step === "oauth" && (
  <>
    <h2>OpenAI 계정 로그인</h2>
    <p className="settingsHint">아래 버튼을 누르면 로그인 창이 열립니다. 창에 표시된 코드를 입력해 주세요.</p>
    <button onClick={props.onOauthLogin} disabled={props.isPolling}>
      {props.isPolling ? "로그인 확인 중..." : "로그인 창 열기"}
    </button>
    {props.aiTestMessage && <p className="settingsHint">{props.aiTestMessage}</p>}
    {props.oauthLoginCode && (
      <p className="oauthCode">코드: <strong>{props.oauthLoginCode}</strong></p>
    )}
    {props.oauthLoginUrl && (
      <p className="settingsHint">
        팝업이 막혔다면 →{" "}
        <a href={props.oauthLoginUrl} target="_blank" rel="noreferrer">로그인 창 직접 열기</a>
      </p>
    )}
    <div className="wizardActions">
      <button className="secondaryButton" onClick={() => setStep("pick")}>뒤로</button>
      <button onClick={async () => {
        await props.onRefresh();
        if (props.codexStatus?.authenticated) {
          completeSetup();
        } else {
          alert("로그인이 확인되지 않았습니다. 로그인 창에서 코드를 입력한 뒤 다시 시도해 주세요.");
        }
      }}>로그인 완료 — 시작하기</button>
    </div>
  </>
)}
```

그리고 `WizardModal` 안에 `useEffect`로 자동 완료 감지 추가:

```tsx
// WizardModal 컴포넌트 상단에 추가
useEffect(() => {
  if (step === "oauth" && props.codexStatus?.authenticated) {
    completeSetup();
  }
}, [props.codexStatus?.authenticated, step]);
```

- [ ] **Step 2: `app/ui.tsx`에서 `isPolling` prop 전달**

`app/ui.tsx`의 `SettingsPanel` 렌더링에 `isPolling={isPolling}` 추가:

```tsx
// useAiSettings에서 isPolling 구조분해
const { ..., isPolling, ... } = useAiSettings();

// SettingsPanel에 전달
<SettingsPanel
  ...
  isPolling={isPolling}
  ...
/>
```

- [ ] **Step 3: 타입 체크**

```bash
cd /Users/youngmini/Projects/hwp-ai-mvp
npx tsc --noEmit
```

예상: 오류 없음

- [ ] **Step 4: 전체 테스트**

```bash
npm test
```

예상: 통과

- [ ] **Step 5: 커밋 및 푸시**

```bash
git add components/SettingsPanel.tsx app/ui.tsx
git commit -m "feat: OAuth 위저드에 폴링 중 UI 및 로그인 완료 자동 감지 추가"
git push origin main
```

---

### Task 8: 릴리즈 태그 생성

- [ ] **Step 1: v0.1.2 태그 생성 및 푸시**

```bash
git tag v0.1.2
git push origin v0.1.2
```

예상: GitHub Actions 빌드 트리거됨
