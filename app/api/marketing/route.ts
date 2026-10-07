import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-firebase-id-token")?.trim() || (await cookies()).get("hotel_lidia_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Authentication unavailable" }, { status: 503 });
  const verification = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }), cache: "no-store" }).catch(() => null);
  if (!verification?.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = process.env.MARKETING_SNAPSHOT_JSON;
  if (!raw) return NextResponse.json({ error: "Marketing report not configured" }, { status: 503 });
  try {
    return NextResponse.json(JSON.parse(raw), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Marketing report unavailable" }, { status: 503 });
  }
}
