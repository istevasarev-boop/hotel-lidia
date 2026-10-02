import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
const SESSION_COOKIE = "hotel_lidia_session";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function proxy(request: NextRequest) {
  const auth = await verifySession(request);
  if (!auth.ok) return auth.response;
  if (process.env.ENQUIRY_REPLIES_ENABLED !== "true") return NextResponse.json({error:"not_configured"}, {status:503});
  const secret = process.env.EXTERNAL_ENQUIRIES_SECRET;
  if (!secret) return NextResponse.json({error:"not_configured"}, {status:503});
  const base = process.env.HOTEL_WEBSITE_ENQUIRIES_URL || "https://www.vilalidia.bg/api/public/enquiries";
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/enquiries\/?$/, "/enquiry-messages");
  url.search = "";
  if (url.protocol !== "https:" || !url.pathname.endsWith("/enquiry-messages")) return NextResponse.json({error:"not_configured"}, {status:503});
  let body: string | undefined;
  if (request.method === "GET") {
    const enquiryId = request.nextUrl.searchParams.get("enquiryId") || "";
    if (!UUID.test(enquiryId)) return NextResponse.json({error:"invalid_input"}, {status:400});
    url.searchParams.set("enquiryId", enquiryId);
  } else {
    if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({error:"invalid_origin"}, {status:403});
    const raw = await request.text();
    if (raw.length > 24000) return NextResponse.json({error:"too_large"}, {status:413});
    let data;
    try { data = JSON.parse(raw); } catch { return NextResponse.json({error:"invalid_json"}, {status:400}); }
    if (!data || !UUID.test(data.enquiryId || "")) return NextResponse.json({error:"invalid_input"}, {status:400});
    if (request.method === "POST") {
      if (typeof data.body !== "string" || !data.body.trim() || data.body.length > 5000 || !UUID.test(data.clientMessageId || "")) return NextResponse.json({error:"invalid_input"}, {status:400});
      body = JSON.stringify({enquiryId:data.enquiryId,body:data.body.trim(),clientMessageId:data.clientMessageId});
    } else {
      if (!UUID.test(data.lastReadMessageId || "")) return NextResponse.json({error:"invalid_input"}, {status:400});
      body = JSON.stringify({enquiryId:data.enquiryId,lastReadMessageId:data.lastReadMessageId});
    }
  }
  try {
    const response = await fetch(url, {method:request.method, headers:{"content-type":"application/json","x-hotel-enquiries-secret":secret},body,cache:"no-store",signal:AbortSignal.timeout(20000)});
    if (!response.headers.get("content-type")?.includes("application/json")) return NextResponse.json({error:"upstream_unavailable"}, {status:502});
    return new NextResponse(await response.text(), {status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
  } catch { return NextResponse.json({error:"upstream_unavailable"}, {status:502}); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
async function verifySession(request: NextRequest): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const headerToken = request.headers.get("x-firebase-id-token")?.trim() || "";
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(SESSION_COOKIE)?.value || "";
  const token = headerToken || cookieToken;

  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return { ok: false, response: NextResponse.json({ error: "Authentication is not configured." }, { status: 503 }) };
  }

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
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  return { ok: true };
}

