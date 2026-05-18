import { NextResponse } from "next/server";
import { getCodexAuthStatus } from "../../../../lib/codex-auth";

export async function GET() {
  return NextResponse.json(getCodexAuthStatus());
}
