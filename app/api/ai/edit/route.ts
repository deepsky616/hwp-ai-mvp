import { NextRequest, NextResponse } from "next/server";
import type { DocumentBlock, DocumentPatch } from "../../../../lib/document";

type RequestBody = {
  instruction?: string;
  blocks?: DocumentBlock[];
};

function parseJsonFromText(text: string): { patches?: DocumentPatch[] } {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("모델 응답을 JSON으로 해석하지 못했습니다");
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as RequestBody;
  const instruction = body.instruction?.trim() ?? "";
  const blocks = body.blocks ?? [];

  if (!instruction) {
    return NextResponse.json({ error: "수정 지시를 입력해 주세요" }, { status: 400 });
  }

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return NextResponse.json({ error: "추출된 문서 내용이 없습니다" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY 환경 변수가 없습니다. 키를 설정하면 AI 수정이 동작합니다.",
      },
      { status: 500 },
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
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
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json({ error: "모델 호출에 실패했습니다", detail }, { status: response.status });
  }

  const data = await response.json();
  const outputText = data.output_text ?? data.output?.flatMap((item: any) => item.content ?? []).map((item: any) => item.text ?? "").join("\n") ?? "";
  const parsed = parseJsonFromText(outputText);

  return NextResponse.json({ patches: parsed.patches ?? [] });
}
