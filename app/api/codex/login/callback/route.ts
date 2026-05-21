import { NextRequest, NextResponse } from "next/server";
import { completeLoginWithAuthorizationCode } from "../../../../../lib/codex-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const authorizationCode =
    searchParams.get("authorization_code") ?? searchParams.get("code") ?? "";
  const codeVerifier = searchParams.get("code_verifier") ?? "";

  if (!authorizationCode || !codeVerifier) {
    return NextResponse.json(
      { ok: false, error: "authorization_code와 code_verifier가 필요합니다" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await completeLoginWithAuthorizationCode(authorizationCode, codeVerifier),
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
