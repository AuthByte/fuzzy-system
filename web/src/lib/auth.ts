import { NextRequest } from "next/server";

export function assertApiKey(req: NextRequest) {
  const expected = process.env.BLOCKLOGGER_API_KEY;
  if (!expected) return;
  const provided =
    req.headers.get("x-blocklogger-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.nextUrl.searchParams.get("key");
  if (provided !== expected) {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
}
