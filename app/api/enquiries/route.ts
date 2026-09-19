import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAdminAuth, getFirebaseAdminDatabase, hasFirebaseAdminConfig } from "@/lib/firebase/admin";

const ENQUIRIES_PATH = "lydia_hotel_v1_enquiries";
const SESSION_COOKIE = "hotel_lidia_session";

export async function GET() {
  const auth = await verifySession();
  if (!auth.ok) return auth.response;

  const snapshot = await getFirebaseAdminDatabase().ref(ENQUIRIES_PATH).get();
  const raw = (snapshot.val() || {}) as Record<string, Record<string, unknown>>;
  const enquiries = Object.values(raw)
    .map(normalizeEnquiry)
    .filter((item): item is NonNullable<ReturnType<typeof normalizeEnquiry>> => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ enquiries });
}

export async function PATCH(request: NextRequest) {
  const auth = await verifySession();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { id?: string; status?: string } | null;
  const id = String(body?.id || "").trim();
  const status = String(body?.status || "").trim();

  if (!id || !["new", "contacted", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "Invalid enquiry update." }, { status: 400 });
  }

  const ref = getFirebaseAdminDatabase().ref(`${ENQUIRIES_PATH}/${id}`);
  const existing = await ref.get();
  if (!existing.exists()) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });

  await ref.update({ status, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}

async function verifySession(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!hasFirebaseAdminConfig()) {
    return { ok: false, response: NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 }) };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };

  try {
    await getFirebaseAdminAuth().verifyIdToken(token);
    return { ok: true };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
}

function normalizeEnquiry(value: Record<string, unknown>) {
  const id = String(value.id || "").trim();
  const property = String(value.property || "").trim();
  const status = String(value.status || "new").trim();
  if (!id || (property !== "villa" && property !== "guesthouse")) return null;

  return {
    id,
    source: "vilalidia.bg",
    property,
    checkin: String(value.checkin || ""),
    checkout: String(value.checkout || ""),
    adults: Number(value.adults || 0),
    children: Number(value.children || 0),
    rooms: Array.isArray(value.rooms) ? value.rooms.map(String) : [],
    name: String(value.name || ""),
    phone: String(value.phone || ""),
    email: String(value.email || ""),
    notes: String(value.notes || ""),
    lang: String(value.lang || "bg"),
    status: status === "contacted" || status === "dismissed" ? status : "new",
    createdAt: String(value.createdAt || ""),
    updatedAt: String(value.updatedAt || "")
  };
}
