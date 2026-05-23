import { NextResponse } from "next/server";
import { getGeminiAuthStatus } from "../../../../lib/gemini-auth";

export async function GET() {
  return NextResponse.json(getGeminiAuthStatus());
}
