import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "hotel_lidia_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { idToken?: string };
  const idToken = String(body.idToken || "").trim();

  if (!idToken) {
    return NextResponse.json({ error: "Missing Firebase ID token." }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  }

  const verification = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
    cache: "no-store"
  }).catch(() => null);

  if (!verification?.ok) {
    return NextResponse.json({ error: "Invalid Firebase ID token." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, idToken, cookieOptions(SESSION_MAX_AGE_SECONDS));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return response;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/"
  };
}
