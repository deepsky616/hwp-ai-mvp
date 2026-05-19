import { NextResponse } from "next/server";
import { startCodexDeviceLogin } from "../../../../../lib/codex-auth";

export async function POST() {
  try {
    const result = await startCodexDeviceLogin();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
