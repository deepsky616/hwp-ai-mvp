import { NextRequest, NextResponse } from "next/server";
import { pollAndCompleteLogin } from "../../../../../lib/codex-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const device_auth_id = searchParams.get("device_auth_id") ?? "";
  const user_code = searchParams.get("user_code") ?? "";

  const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
  const CODE_PATTERN = /^[A-Z0-9-]{4,20}$/;
  if (!device_auth_id || !user_code || !ID_PATTERN.test(device_auth_id) || !CODE_PATTERN.test(user_code)) {
    return NextResponse.json(
      { status: "error", error: "device_auth_id와 user_code가 필요합니다" },
      { status: 400 },
    );
  }

  try {
    const result = await pollAndCompleteLogin(device_auth_id, user_code);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
