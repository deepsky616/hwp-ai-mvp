import { NextRequest, NextResponse } from "next/server";
import { getClaudeAuthStatusAsync } from "../../../../lib/claude-auth";

export async function GET(request: NextRequest) {
  const cliPath = new URL(request.url).searchParams.get("cliPath") ?? undefined;
  return NextResponse.json(await getClaudeAuthStatusAsync(cliPath || undefined));
}
