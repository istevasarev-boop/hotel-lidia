import { NextResponse, type NextRequest } from "next/server";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";
import { normalizeCheckout } from "@/domain/reservations/dateRange";
import { validateReservationConflict } from "@/domain/reservations/conflicts";
import { deleteReservationById, upsertReservation } from "@/domain/reservations/store";
import type { AppData, PropertyId, Reservation, RoomId } from "@/domain/reservations/types";

const DB_PATH = "lydia_hotel_v1";
const BACKUP_PATH = "lydia_hotel_v1_backups";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const action = String(form.get("action") || "save");
  const propertyId = normalizeProperty(form.get("propertyId"));
  const redirectUrl = new URL(`/?tab=calendar&property=${propertyId}`, request.url);

  try {
    const data = await loadData();

    if (action === "delete") {
      const id = String(form.get("id") || "");
      if (id) await saveData(deleteReservationById(data, id));
      return NextResponse.redirect(redirectUrl, 303);
    }

    const id = String(form.get("id") || "") || createServerId();
    const checkin = String(form.get("checkin") || "");
    const checkout = normalizeCheckout(checkin, String(form.get("checkout") || ""));
    const rooms = normalizeRooms(String(form.get("rooms") || ""));
    const now = new Date().toISOString();
    const previous = data.reservations[id];
    const reservation: Reservation = {
      id,
      propertyId,
      rooms,
      checkin,
      checkout,
      guestName: String(form.get("guestName") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      notes: String(form.get("notes") || "").trim(),
      depositAmount: numberValue(form.get("depositAmount")),
      totalAmount: numberValue(form.get("totalAmount")),
      status: numberValue(form.get("depositAmount")) > 0 ? "deposit_paid" : "pending",
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };

    const conflict = validateReservationConflict(reservation, Object.values(data.reservations));
    if (!conflict.ok) {
      redirectUrl.searchParams.set("error", "conflict");
      return NextResponse.redirect(redirectUrl, 303);
    }

    await saveData(upsertReservation(data, reservation));
    return NextResponse.redirect(redirectUrl, 303);
  } catch {
    redirectUrl.searchParams.set("error", "save");
    return NextResponse.redirect(redirectUrl, 303);
  }
}

async function loadData(): Promise<AppData> {
  const databaseUrl = getDatabaseUrl();
  const response = await fetch(`${databaseUrl}/${DB_PATH}.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Load failed: ${response.status}`);
  return normalizeImportedData(await response.json());
}

async function saveData(data: AppData): Promise<void> {
  const now = new Date().toISOString();
  const legacy = v2ToLegacy(data);
  const databaseUrl = getDatabaseUrl();
  const [main] = await Promise.all([
    fetch(`${databaseUrl}/${DB_PATH}.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(legacy),
      signal: AbortSignal.timeout(10000)
    }),
    fetch(`${databaseUrl}/${BACKUP_PATH}/${now.replace(/[:.]/g, "-")}.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ts: now, data: legacy }),
      signal: AbortSignal.timeout(10000)
    })
  ]);
  if (!main.ok) throw new Error(`Save failed: ${main.status}`);
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("Firebase database URL is not configured.");
  return databaseUrl;
}

function normalizeProperty(value: FormDataEntryValue | null): PropertyId {
  return value === "house" ? "house" : "villa";
}

function normalizeRooms(value: string): Reservation["rooms"] {
  const rooms = value.split(",").map((room) => room.trim()).filter(Boolean);
  if (rooms.includes("all")) return ["all"];
  return rooms.sort((a, b) => Number(a) - Number(b)) as RoomId[];
}

function numberValue(value: FormDataEntryValue | null): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function createServerId(): string {
  return `res_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
