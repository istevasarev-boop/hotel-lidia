import { NextResponse, type NextRequest } from "next/server";

const WEBSITE_PUSH_SUBSCRIPTIONS_URL =
  process.env.HOTEL_WEBSITE_PUSH_SUBSCRIPTIONS_URL ||
  "https://www.vilalidia.bg/api/public/push-subscriptions";

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-firebase-id-token")?.trim() || "";
  if (!token) {
    console.error("push subscription: missing Firebase token");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });

  const verification = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      cache: "no-store"
    }
  ).catch(() => null);

  if (!verification?.ok) {
    console.error("push subscription: Firebase token verification failed");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const secret = process.env.EXTERNAL_ENQUIRIES_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Push integration is not configured." }, { status: 503 });
  }

  const payload = await request.json().catch(() => null);
  const subscription = payload?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const upstream = await fetch(WEBSITE_PUSH_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hotel-enquiries-secret": secret
    },
    body: JSON.stringify({ subscription }),
    cache: "no-store"
  });

  const body = await upstream.text();
  if (!upstream.ok) {
    console.error(`push subscription upstream failed: status=${upstream.status} body=${body.slice(0, 80)}`);
  }
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" }
  });
}
