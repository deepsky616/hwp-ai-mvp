import { NextRequest, NextResponse } from "next/server";
import { requestDocumentPatches, type AiSettings } from "../../../../lib/ai-edit";
import type { DocumentBlock } from "../../../../lib/document";

type RequestBody = {
  instruction?: string;
  blocks?: DocumentBlock[];
  model?: string;
  aiSettings?: AiSettings;
};

export async function POST(request: NextRequest) {
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
