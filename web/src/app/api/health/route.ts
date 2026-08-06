import { NextResponse } from "next/server";
import { storageMode } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "blocklogger-web",
    storage: storageMode(),
    time: new Date().toISOString(),
  });
}
