import { NextRequest, NextResponse } from "next/server";
import { exceedsRecoverContentLength, isRecoverFileSizeAllowed, markdownToImportHtml } from "../../../../lib/hwp-load";
import { createRateLimiter } from "../../../../lib/rate-limit";
import { isTrustedLocalRequest, UNTRUSTED_REQUEST_MESSAGE } from "../../../../lib/request-guard";

export const runtime = "nodejs";

const limiter = createRateLimiter({ windowMs: 60_000, max: 30 });

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

// 문서 변환 의존성(char code 107,111,114,100,111,99)은 무겁다. 소스에 리터럴
// 패키지명이나 정적 import가 남으면 Next/Vercel이 이를 서버리스 함수 번들에 정적
// 포함시켜 함수 크기 제한을 초과한다. 그래서 패키지명을 런타임에 조합하고 동적
// import로만 로드한다. (이 동작은 route.test.ts가 강제 — 변경 시 함께 확인할 것)
async function loadKordoc() {
  const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<KordocModule>;
  const packageName = String.fromCharCode(107, 111, 114, 100, 111, 99);
  return importer(packageName);
}

export async function POST(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: UNTRUSTED_REQUEST_MESSAGE }, { status: 403 });
  }

  const rl = limiter("local");
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  if (isVercelServerless()) {
    return NextResponse.json(
      {
        error: "Vercel 함수 크기 제한 때문에 서버 복구 변환은 배포 환경에서 비활성화되어 있습니다. 일반 HWP 열기, 편집, AI 수정, 저장 기능은 계속 사용할 수 있습니다.",
        code: "RECOVER_DISABLED_ON_VERCEL",
      },
      { status: 501 },
    );
  }

  // 본문을 메모리에 적재하기 전에 Content-Length로 과대 요청을 먼저 거른다.
  if (exceedsRecoverContentLength(request.headers.get("content-length"))) {
    return NextResponse.json(
      { error: "파일이 너무 큽니다 (최대 50MB)", code: "FILE_TOO_LARGE" },
      { status: 413 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일을 찾지 못했습니다" }, { status: 400 });
  }

  if (!isRecoverFileSizeAllowed(file.size)) {
    return NextResponse.json(
      { error: "파일이 너무 크거나 비어 있습니다 (최대 50MB)", code: "FILE_TOO_LARGE" },
      { status: 413 },
    );
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
