import { NextRequest, NextResponse } from "next/server";
import { getCodexAuthStatusAsync } from "../../../../lib/codex-auth";

export async function GET(request: NextRequest) {
  const cliPath = new URL(request.url).searchParams.get("cliPath") ?? undefined;
  return NextResponse.json(await getCodexAuthStatusAsync(cliPath || undefined));
}
