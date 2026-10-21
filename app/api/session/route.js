import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
const fallbackSecret = randomBytes(32).toString("hex");
export const runtime = "nodejs";
export function GET() { const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60 * 60_000 })).toString("base64url"); const secret = process.env.SESSION_SECRET || process.env.DEEPGRAM_API_KEY || fallbackSecret; return NextResponse.json({ token: `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}` }); }
