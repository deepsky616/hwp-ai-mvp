import { NextResponse } from "next/server";
import { startGeminiLogin } from "../../../../../lib/gemini-auth";

export async function POST() {
  try {
    const result = await startGeminiLogin();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "로그인 시작에 실패했습니다" },
      { status: 500 },
    );
  }
}
