import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAdminAuth, hasFirebaseAdminConfig } from "@/lib/firebase/admin";

const SESSION_COOKIE = "hotel_lidia_session";
const WEBSITE_ENQUIRIES_URL =
  process.env.HOTEL_WEBSITE_ENQUIRIES_URL || "https://www.vilalidia.bg/api/public/enquiries";

export async function GET() {
  const auth = await verifySession();
  if (!auth.ok) return auth.response;

  const secret = process.env.EXTERNAL_ENQUIRIES_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "External enquiries integration is not configured." }, { status: 503 });
  }

  const response = await fetch(WEBSITE_ENQUIRIES_URL, {
    method: "GET",
    headers: { "x-hotel-enquiries-secret": secret },
    cache: "no-store"
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" }
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await verifySession();
  if (!auth.ok) return auth.response;

  const secret = process.env.EXTERNAL_ENQUIRIES_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "External enquiries integration is not configured." }, { status: 503 });
  }

  const body = await request.text();
  const response = await fetch(WEBSITE_ENQUIRIES_URL, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-hotel-enquiries-secret": secret
    },
    body,
    cache: "no-store"
  });

  const result = await response.text();
  return new NextResponse(result, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" }
  });
}

async function verifySession(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };

  if (!hasFirebaseAdminConfig()) {
    // Preview can still rely on the existing Firebase-authenticated client session cookie.
    // The website enquiries endpoint itself remains protected by the server-side shared secret.
    return { ok: true };
  }

  try {
    await getFirebaseAdminAuth().verifyIdToken(token);
    return { ok: true };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
}
