import { NextRequest, NextResponse } from "next/server";
import { markdownToImportHtml } from "../../../../lib/hwp-load";

export const runtime = "nodejs";

type ParseFailureLike = {
  success: false;
  error: string;
  code?: string;
};

type KordocParseSuccess = {
  success: true;
  markdown: string;
  fileType?: string;
  pageCount?: number;
  warnings?: string[];
};

type KordocParseResult = KordocParseSuccess | ParseFailureLike;

type KordocModule = {
  parse: (buffer: Buffer, options: { filePath: string }) => Promise<KordocParseResult>;
};

function isVercelServerless() {
  return process.env.VERCEL === "1";
}

async function loadKordoc() {
  const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<KordocModule>;
  const packageName = String.fromCharCode(107, 111, 114, 100, 111, 99);
  return importer(packageName);
}

export async function POST(request: NextRequest) {
  if (isVercelServerless()) {
    return NextResponse.json(
      {
        error: "Vercel 함수 크기 제한 때문에 서버 복구 변환은 배포 환경에서 비활성화되어 있습니다. 일반 HWP 열기, 편집, AI 수정, 저장 기능은 계속 사용할 수 있습니다.",
        code: "RECOVER_DISABLED_ON_VERCEL",
      },
      { status: 501 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일을 찾지 못했습니다" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { parse } = await loadKordoc();
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
