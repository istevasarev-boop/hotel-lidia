import { NextResponse, type NextRequest } from "next/server";
import { getFirebaseAdminDatabase, hasFirebaseAdminConfig } from "@/lib/firebase/admin";

const ENQUIRIES_PATH = "lydia_hotel_v1_enquiries";

type IncomingEnquiry = {
  id?: string;
  property?: string;
  checkin?: string;
  checkout?: string;
  adults?: number;
  children?: number;
  rooms?: string[];
  name?: string;
  phone?: string;
  email?: string;
  notes?: string | null;
  lang?: string;
  source?: string;
};

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.EXTERNAL_ENQUIRIES_SECRET;
  const suppliedSecret = request.headers.get("x-hotel-enquiries-secret");

  if (!configuredSecret) {
    return NextResponse.json({ error: "External enquiries integration is not configured." }, { status: 503 });
  }
  if (!suppliedSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!hasFirebaseAdminConfig()) {
    return NextResponse.json({ error: "Firebase Admin is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as IncomingEnquiry | null;
  const parsed = validateEnquiry(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const ref = getFirebaseAdminDatabase().ref(ENQUIRIES_PATH).push();
  const id = ref.key;
  if (!id) {
    return NextResponse.json({ error: "Could not allocate enquiry id." }, { status: 500 });
  }

  const enquiry = {
    id,
    source: "vilalidia.bg",
    property: parsed.value.property,
    checkin: parsed.value.checkin,
    checkout: parsed.value.checkout,
    adults: parsed.value.adults,
    children: parsed.value.children,
    rooms: parsed.value.rooms,
    name: parsed.value.name,
    phone: parsed.value.phone,
    email: parsed.value.email,
    notes: parsed.value.notes,
    lang: parsed.value.lang,
    status: "new",
    createdAt: now,
    updatedAt: now
  };

  await ref.set(enquiry);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

function validateEnquiry(body: IncomingEnquiry | null):
  | { ok: true; value: Required<Pick<IncomingEnquiry, "property" | "checkin" | "checkout" | "adults" | "children" | "rooms" | "name" | "phone" | "email" | "lang">> & { notes: string } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body." };

  const property = String(body.property || "").trim();
  const checkin = String(body.checkin || "").trim();
  const checkout = String(body.checkout || "").trim();
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim();
  const lang = String(body.lang || "bg").trim();
  const adults = Number(body.adults);
  const children = Number(body.children || 0);
  const rooms = Array.isArray(body.rooms) ? body.rooms.map((room) => String(room).trim()).filter(Boolean).slice(0, 20) : [];
  const notes = String(body.notes || "").trim().slice(0, 3000);

  if (property !== "villa" && property !== "guesthouse") return { ok: false, error: "Invalid property." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return { ok: false, error: "Invalid dates." };
  if (!Number.isInteger(adults) || adults < 1 || adults > 50) return { ok: false, error: "Invalid adults count." };
  if (!Number.isInteger(children) || children < 0 || children > 50) return { ok: false, error: "Invalid children count." };
  if (!name || !phone || !email) return { ok: false, error: "Missing contact details." };
  if (!email.includes("@")) return { ok: false, error: "Invalid email." };

  return {
    ok: true,
    value: { property, checkin, checkout, adults, children, rooms, name, phone, email, lang, notes }
  };
}
