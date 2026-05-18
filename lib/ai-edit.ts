import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOpenAiAuthorization } from "./codex-auth";
import type { DocumentBlock, DocumentPatch } from "./document";

export type AiProvider = "openai" | "ollama" | "mlx" | "custom";

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

export function extractResponseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  if (Array.isArray(data?.output)) {
    return data.output
      .flatMap((item: any) => item?.content ?? [])
      .map((item: any) => item?.text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function runCodexCli(args: string[], input: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_CLI_PATH || "codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("코덱스 실행 시간이 초과되었습니다."));
    }, 180000);

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`코덱스 실행에 실패했습니다: ${stderr || stdout}`));
    });
    child.stdin.end(input);
  });
}

async function requestPatchesWithCodexCli(request: AiEditRequest): Promise<DocumentPatch[]> {
  const workdir = await mkdtemp(join(tmpdir(), "hwp-ai-codex-"));
  const schemaPath = join(workdir, "patch-schema.json");
  const outputPath = join(workdir, "codex-output.json");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      patches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["paragraph", "tableCell"] },
            sectionIndex: { type: "number" },
            paragraphIndex: { type: "number" },
            parentParagraphIndex: { type: "number" },
            controlIndex: { type: "number" },
            cellIndex: { type: "number" },
            cellParagraphIndex: { type: "number" },
            text: { type: "string" },
          },
          required: ["type", "sectionIndex", "paragraphIndex", "parentParagraphIndex", "controlIndex", "cellIndex", "cellParagraphIndex", "text"],
        },
      },
    },
    required: ["patches"],
  };

  const prompt = [
    "한국어 HWP 문서 블록을 사용자의 지시에 맞게 편집하세요.",
    "좌표와 타입은 절대 바꾸지 말고, 수정이 필요한 블록만 patches에 넣으세요.",
    "아무 설명 없이 지정된 JSON 형식으로만 답하세요.",
    JSON.stringify({ instruction: request.instruction, blocks: request.blocks }),
  ].join("\n\n");

  try {
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");
    await runCodexCli(
      [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--model",
        sanitizeModel(request.model),
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      prompt,
      workdir,
    );
    const output = await readFile(outputPath, "utf8");
    return parseJsonFromText(output).patches ?? [];
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function buildChatMessages(request: AiEditRequest) {
  const payload = buildAiEditPayload({ ...request, model: resolveRequestModel(request) });
  return payload.input.map((item) => ({ role: item.role, content: item.content }));
}

function extractChatResponseText(data: any): string {
  if (typeof data?.message?.content === "string") return data.message.content;
  if (typeof data?.choices?.[0]?.message?.content === "string") return data.choices[0].message.content;
  return extractResponseText(data);
}

async function requestPatchesWithOpenAiCompatible(request: AiEditRequest, baseUrl: string, authorizationHeader?: string): Promise<DocumentPatch[]> {
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
  if (provider === "ollama") {
    const baseUrl = sanitizeBaseUrl(settings.baseUrl, "http://localhost:11434");
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`연결 테스트에 실패했습니다: ${await response.text()}`);
    return { ok: true, message: "올라마 서버 연결에 성공했습니다." };
  }

  const baseUrl = provider === "openai"
    ? "https://api.openai.com"
    : sanitizeBaseUrl(settings.baseUrl, provider === "mlx" ? "http://localhost:8080" : "http://localhost:8080");
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
  if (provider === "ollama") return requestPatchesWithOllama(request);
  if (provider === "mlx" || provider === "custom") {
    const baseUrl = sanitizeBaseUrl(request.aiSettings?.baseUrl, "http://localhost:8080");
    const key = request.aiSettings?.apiKey?.trim();
    return requestPatchesWithOpenAiCompatible(request, baseUrl, key ? `Bearer ${key}` : undefined);
  }

  const authorization = getClientOpenAiAuthorization(request.aiSettings) || getOpenAiAuthorization();
  if (!authorization) {
    throw new Error("인공지능 설정에서 API 키를 입력하거나 서버 환경 변수를 설정해 주세요.");
  }

  if (authorization.source === "codex-oauth") {
    return requestPatchesWithCodexCli({ ...request, model: resolveRequestModel(request) });
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
  const parsed = parseJsonFromText(extractResponseText(data));
  return parsed.patches ?? [];
}
