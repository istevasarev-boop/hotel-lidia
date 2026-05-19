import { NextResponse, type NextRequest } from "next/server";
import { getSafeBookingInventory, isBookingType } from "@/domain/booking/availability";
import { addDaysISO, todayISO } from "@/domain/reservations/dateRange";
import { normalizeImportedData } from "@/domain/reservations/legacyAdapter";
import type { AppData, BookingTypeId, PropertyId } from "@/domain/reservations/types";

const DB_PATH = "lydia_hotel_v1";
const FEED_DAYS = 730;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ property: string; type: string }> }
) {
  const params = await context.params;
  const propertyId = normalizeProperty(params.property);
  const bookingType = normalizeBookingType(params.type);
  const token = request.nextUrl.searchParams.get("token") || "";

  if (!propertyId || !bookingType) {
    return new NextResponse("Unknown Booking feed.", { status: 404 });
  }

  const data = await loadData();
  const expectedToken = data.bookingFeedTokens?.[propertyId]?.[bookingType];
  if (!expectedToken || token !== expectedToken) {
    return new NextResponse("Invalid Booking feed token.", { status: 403 });
  }

  return new NextResponse(buildIcalFeed(data, propertyId, bookingType), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store, max-age=0"
    }
  });
}

async function loadData(): Promise<AppData> {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("Firebase database URL is not configured.");

  const response = await fetch(`${databaseUrl}/${DB_PATH}.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Firebase load failed: ${response.status}`);
  return normalizeImportedData(await response.json());
}

function buildIcalFeed(data: AppData, propertyId: PropertyId, bookingType: BookingTypeId): string {
  const today = todayISO();
  const blockedRanges = mergeBlockedRanges(
    Array.from({ length: FEED_DAYS }, (_, index) => addDaysISO(today, index)).filter((date) => {
      const result = getSafeBookingInventory(data, propertyId, bookingType, date);
      return result.safeInventory <= 0;
    })
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hotel Lidia//Booking Availability//BG",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...blockedRanges.flatMap((range) => [
      "BEGIN:VEVENT",
      `UID:hotel-lidia-${propertyId}-${bookingType}-${range.start}@hotel-lidia`,
      `DTSTAMP:${formatIcalDateTime(new Date())}`,
      `DTSTART;VALUE=DATE:${formatIcalDate(range.start)}`,
      `DTEND;VALUE=DATE:${formatIcalDate(addDaysISO(range.end, 1))}`,
      "SUMMARY:Blocked - Hotel Lidia",
      "END:VEVENT"
    ]),
    "END:VCALENDAR"
  ];

  return lines.join("\r\n");
}

function mergeBlockedRanges(dates: string[]): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = [];
  dates.forEach((date) => {
    const last = ranges[ranges.length - 1];
    if (last && addDaysISO(last.end, 1) === date) {
      last.end = date;
    } else {
      ranges.push({ start: date, end: date });
    }
  });
  return ranges;
}

function normalizeProperty(value: string): PropertyId | null {
  return value === "villa" || value === "house" ? value : null;
}

function normalizeBookingType(value: string): BookingTypeId | null {
  return isBookingType(value) ? value : null;
}

function formatIcalDate(date: string): string {
  return date.replaceAll("-", "");
}

function formatIcalDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
