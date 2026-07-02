import { NextRequest, NextResponse } from "next/server";
import { requestDocumentPatches, type AiSettings } from "../../../../lib/ai-edit";
import type { DocumentBlock } from "../../../../lib/document";
import { createRateLimiter } from "../../../../lib/rate-limit";
import { isTrustedLocalRequest, UNTRUSTED_REQUEST_MESSAGE } from "../../../../lib/request-guard";

type RequestBody = {
  instruction?: string;
  blocks?: DocumentBlock[];
  model?: string;
  aiSettings?: AiSettings;
};

const limiter = createRateLimiter({ windowMs: 60_000, max: 30 });

export async function POST(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: UNTRUSTED_REQUEST_MESSAGE }, { status: 403 });
  }

  // 로컬 단일 사용자 앱이므로 고정 키를 쓴다. 클라이언트가 보내는
  // x-forwarded-for를 키로 쓰면 헤더 위조로 제한을 우회하고 Map이 폭증한다.
  const rl = limiter("local");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as RequestBody;
    const instruction = body.instruction?.trim() ?? "";
    const blocks = body.blocks ?? [];

    if (!instruction) {
      return NextResponse.json({ error: "수정 지시를 입력해 주세요" }, { status: 400 });
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return NextResponse.json({ error: "추출된 문서 내용이 없습니다" }, { status: 400 });
    }

    const patches = await requestDocumentPatches({ instruction, blocks, model: body.model, aiSettings: body.aiSettings });
    return NextResponse.json({ patches });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
