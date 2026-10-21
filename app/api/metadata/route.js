import { NextResponse } from "next/server";
export function GET() { return NextResponse.json({ title: "Next.js Flux", useCase: "flux", language: "javascript", framework: "nextjs", sdk: "@deepgram/sdk" }); }
