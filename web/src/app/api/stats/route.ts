import { NextResponse } from "next/server";
import { getStats, storageMode } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ...(await getStats()),
    storage: storageMode(),
  });
}
