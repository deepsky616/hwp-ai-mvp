import { NextRequest, NextResponse } from "next/server";
import { startCodexLogin } from "../../../../../lib/codex-login-flow";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const codexCliPath = typeof body?.codexCliPath === "string" ? body.codexCliPath : undefined;
    const { authUrl, sessionId } = await startCodexLogin(codexCliPath);
    return NextResponse.json({ ok: true, authUrl, sessionId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
