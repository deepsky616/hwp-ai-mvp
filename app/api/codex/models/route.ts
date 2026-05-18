import { NextResponse } from "next/server";
import { listUsableModels } from "../../../../lib/codex-auth";

export async function GET() {
  const models = await listUsableModels();
  return NextResponse.json({ models });
}
