import { NextRequest, NextResponse } from "next/server";
import { parse } from "kordoc";
import { markdownToImportHtml } from "../../../../lib/hwp-load";

export const runtime = "nodejs";

type ParseFailureLike = {
  success: false;
  error: string;
  code?: string;
};

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일을 찾지 못했습니다" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await parse(buffer, { filePath: file.name });

  if (!result.success) {
    const failure = result as ParseFailureLike;
    return NextResponse.json(
      {
        error: failure.error || "텍스트 복구 변환에 실패했습니다",
        code: failure.code,
      },
      { status: 422 },
    );
  }

  const markdown = result.markdown.trim();
  const html = markdownToImportHtml(markdown);

  return NextResponse.json({
    markdown,
    html,
    fileType: result.fileType,
    pageCount: result.pageCount,
    warnings: result.warnings ?? [],
  });
}
