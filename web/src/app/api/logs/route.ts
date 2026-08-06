import { NextRequest, NextResponse } from "next/server";
import { assertApiKey } from "@/lib/auth";
import { insertLogs, queryLogs, storageMode } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const num = (key: string) => {
      const v = sp.get(key);
      if (v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const result = await queryLogs({
      player: sp.get("player") || undefined,
      action: sp.get("action") || undefined,
      dimension: sp.get("dimension") || undefined,
      block: sp.get("block") || undefined,
      from: num("from"),
      to: num("to"),
      x: num("x"),
      y: num("y"),
      z: num("z"),
      radius: num("radius"),
      limit: num("limit"),
      offset: num("offset"),
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    assertApiKey(req);
    if (storageMode() === "none") {
      return NextResponse.json(
        {
          error:
            "Storage not configured. In Vercel → Storage, create Neon Postgres (DATABASE_URL) or Blob (BLOB_READ_WRITE_TOKEN).",
        },
        { status: 503 }
      );
    }

    const body = await req.json();
    const items = Array.isArray(body)
      ? body
      : Array.isArray(body?.logs)
        ? body.logs
        : [body];

    const inserted = await insertLogs(items);
    return NextResponse.json(
      { inserted: inserted.length, items: inserted },
      { status: 201 }
    );
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status }
    );
  }
}
