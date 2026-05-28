import { NextRequest, NextResponse } from "next/server";
import { findCliPath, type CliName } from "../../../../lib/cli-resolver";

export async function GET(request: NextRequest) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (name !== "codex" && name !== "gemini" && name !== "antigravity") {
    return NextResponse.json({ found: false, path: null, error: "지원하지 않는 CLI입니다" }, { status: 400 });
  }
  const path = findCliPath(name as CliName);
  return NextResponse.json({ found: !!path, path: path ?? null });
}
