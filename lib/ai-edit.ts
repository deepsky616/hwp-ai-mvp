import { getOpenAiAuthorizationAsync, migrateCodexAuthIfNeeded } from "./codex-auth";
import type { DocumentBlock, DocumentPatch } from "./document";
import * as childProcess from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type AiProvider = "openai" | "codex-cli" | "gemini" | "gemini-cli" | "openai-oauth" | "ollama" | "mlx" | "custom";
type CliName = "codex" | "gemini";

export type AiSettings = {
  provider?: AiProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  codexCliPath?: string;
  geminiCliPath?: string;
};

export type AiEditRequest = {
  instruction: string;
  blocks: DocumentBlock[];
  model?: string;
  aiSettings?: AiSettings;
};

type ExecFileImpl = typeof childProcess.execFile;
let execFileImpl: ExecFileImpl = childProcess.execFile;

export function setExecFileForTest(next: ExecFileImpl) {
  execFileImpl = next;
}

export function resetExecFileForTest() {
  execFileImpl = childProcess.execFile;
}

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

function buildPlainPrompt(request: AiEditRequest): string {
  return buildChatMessages(request)
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");
}

function extractGeminiResponseText(data: unknown): string {
  const d = data as Record<string, unknown>;
  const candidates = d.candidates as unknown[] | undefined;
  const parts = (((candidates?.[0] as Record<string, unknown>)?.content as Record<string, unknown>)?.parts ?? []) as unknown[];
  return parts
    .map((part) => (part as Record<string, unknown>)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

const CLI_TIMEOUT_MS = 180_000;

function describeAuthFailure(text: string): string | null {
  const lower = text.toLowerCase();
  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("token_invalidated") ||
    lower.includes("refresh_token") ||
    lower.includes("sign in again") ||
    lower.includes("could not be refreshed")
  ) {
    return "로그인 인증이 만료되었거나 무효화되었습니다. 터미널에서 'codex login'(또는 'gemini')으로 다시 로그인한 뒤 시도해 주세요.";
  }
  return null;
}

function execFileAsync(command: string, args: string[], cwd = process.cwd(), envPath?: string, stdinInput?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFileImpl(
      command,
      args,
      {
        cwd,
        env: envPath ? { ...process.env, PATH: envPath } : process.env,
        maxBuffer: 1024 * 1024 * 20,
        timeout: CLI_TIMEOUT_MS,
        killSignal: "SIGTERM",
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean };
          const stderrText = String(stderr ?? "");
          if (err.killed) {
            reject(new Error(`${command} 응답 시간이 초과되었습니다 (${CLI_TIMEOUT_MS / 1000}초). 모델 응답이 너무 오래 걸리거나 로그인 인증에 문제가 있을 수 있습니다.`));
            return;
          }
          const authHint = describeAuthFailure(stderrText);
          if (authHint) {
            reject(new Error(authHint));
            return;
          }
          reject(new Error(`${command} 실행에 실패했습니다: ${stderrText || error.message}`));
          return;
        }
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
    if (stdinInput !== undefined && child?.stdin) {
      child.stdin.end(stdinInput);
    }
  });
}

async function execCliAsync(name: CliName, args: string[], cwd = process.cwd(), customPath?: string, stdinInput?: string): Promise<{ stdout: string; stderr: string }> {
  const { resolveCli } = await import("./cli-resolver");
  const resolved = resolveCli(name, customPath);
  return execFileAsync(resolved.command, [...resolved.argsPrefix, ...args], cwd, resolved.envPath, stdinInput);
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
  const d = data as Record<string, unknown>;
  if (typeof d?.output_text === "string") return d.output_text as string;
  if (Array.isArray(d?.output)) {
    return (d.output as unknown[])
      .flatMap((item) => ((item as Record<string, unknown>)?.content ?? []) as unknown[])
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
  const msgContent = ((d?.message as Record<string, unknown>)?.content);
  if (typeof msgContent === "string") return msgContent;
  const choiceContent = (((d?.choices as unknown[])?.[0] as Record<string, unknown>)?.message as Record<string, unknown>)?.content;
  if (typeof choiceContent === "string") return choiceContent;
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

async function requestPatchesWithGeminiApi(request: AiEditRequest): Promise<DocumentPatch[]> {
  const apiKey = request.aiSettings?.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini API 키를 입력하거나 GEMINI_API_KEY 환경 변수를 설정해 주세요.");

  const model = resolveRequestModel(request);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPlainPrompt(request) }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API 호출에 실패했습니다: ${detail}`);
  }

  const data = await response.json();
  return parseJsonFromText(extractGeminiResponseText(data)).patches ?? [];
}

async function requestPatchesWithCodexCli(request: AiEditRequest): Promise<DocumentPatch[]> {
  migrateCodexAuthIfNeeded();
  const dir = await mkdtemp(join(tmpdir(), "hwp-ai-codex-"));
  const outputPath = join(dir, "last-message.txt");
  const customPath = request.aiSettings?.codexCliPath;
  try {
    const { stderr } = await execCliAsync("codex", [
      "exec",
      "--color",
      "never",
      "--output-last-message",
      outputPath,
      "--skip-git-repo-check",
      "--cd",
      process.cwd(),
      "--model",
      resolveRequestModel(request),
      "-",
    ], undefined, customPath, buildPlainPrompt(request));
    const text = await readFile(outputPath, "utf8").catch(() => "");
    if (!text.trim()) {
      const authHint = describeAuthFailure(stderr);
      throw new Error(authHint ?? "Codex CLI가 응답을 반환하지 않았습니다. 터미널에서 'codex login' 상태를 확인해 주세요.");
    }
    return parseJsonFromText(text).patches ?? [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function requestPatchesWithGeminiCli(request: AiEditRequest): Promise<DocumentPatch[]> {
  const customPath = request.aiSettings?.geminiCliPath;
  const { stdout } = await execCliAsync("gemini", [
    "--model",
    resolveRequestModel(request),
    "--prompt",
    buildPlainPrompt(request),
    "--output-format",
    "text",
    "--raw-output",
    "--accept-raw-output-risk",
  ], undefined, customPath);
  return parseJsonFromText(stdout).patches ?? [];
}

export async function testAiConnection(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
  const provider = settings.provider || "openai";

  if (provider === "codex-cli") {
    migrateCodexAuthIfNeeded();
    const { stdout, stderr } = await execCliAsync("codex", ["login", "status"], undefined, settings.codexCliPath);
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    if (combined.includes("logged in")) {
      return { ok: true, message: "Codex 계정 로그인이 확인되었습니다." };
    }
    return { ok: false, message: "Codex 로그인이 필요합니다. 'OpenAI 계정으로 로그인'을 눌러 주세요." };
  }

  if (provider === "openai-oauth") {
    const authorization = await getOpenAiAuthorizationAsync();
    if (!authorization) throw new Error("OpenAI 계정 로그인이 필요합니다.");
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: authorization.header },
    });
    if (!response.ok) throw new Error(`OpenAI 계정 연결 테스트에 실패했습니다: ${await response.text()}`);
    return { ok: true, message: "OpenAI 계정 로그인 연결에 성공했습니다." };
  }

  if (provider === "gemini-cli") {
    await execCliAsync("gemini", ["--version"], undefined, settings.geminiCliPath);
    return { ok: true, message: "Gemini CLI를 사용할 수 있습니다. 터미널에서 Gemini CLI 로그인이 완료되어 있어야 합니다." };
  }

  if (provider === "ollama") {
    const baseUrl = sanitizeBaseUrl(settings.baseUrl, "http://localhost:11434");
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`연결 테스트에 실패했습니다: ${await response.text()}`);
    return { ok: true, message: "올라마 서버 연결에 성공했습니다." };
  }

  if (provider === "gemini") {
    const apiKey = settings.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("Gemini API 키를 입력해 주세요.");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) throw new Error(`Gemini API 연결 테스트에 실패했습니다: ${await response.text()}`);
    return { ok: true, message: "Gemini API 연결에 성공했습니다." };
  }

  const baseUrl =
    provider === "openai"
      ? "https://api.openai.com"
      : sanitizeBaseUrl(
          settings.baseUrl,
          "http://localhost:8080",
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

  if (provider === "codex-cli") return requestPatchesWithCodexCli(request);
  if (provider === "openai-oauth") {
    const authorization = await getOpenAiAuthorizationAsync();
    if (!authorization) throw new Error("OpenAI 계정 로그인이 필요합니다.");
    return requestPatchesWithOpenAiCompatible(request, "https://api.openai.com", authorization.header);
  }
  if (provider === "gemini") return requestPatchesWithGeminiApi(request);
  if (provider === "gemini-cli") return requestPatchesWithGeminiCli(request);

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

  const authorization = getClientOpenAiAuthorization(request.aiSettings) || (await getOpenAiAuthorizationAsync());
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
