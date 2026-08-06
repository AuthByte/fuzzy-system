import { NextResponse } from "next/server";
import { listPlayers } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ players: await listPlayers() });
}
