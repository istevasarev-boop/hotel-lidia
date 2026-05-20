import { HotelApp } from "@/components/HotelApp";
import { normalizeImportedData } from "@/domain/reservations/legacyAdapter";
import { createEmptyData, type AppData } from "@/domain/reservations/types";
import type { PropertyId } from "@/domain/reservations/types";
import { cookies } from "next/headers";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DB_PATH = "lydia_hotel_v1";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = stringParam(params.tab);
  const property = stringParam(params.property);
  const room = stringParam(params.room);
  const month = stringParam(params.month);
  const filter = stringParam(params.filter);
  const query = stringParam(params.q);
  const initialLoad = await loadInitialData();
  const cookieStore = await cookies();
  const hasServerSession = Boolean(cookieStore.get("hotel_lidia_session")?.value);

  return (
    <HotelApp
      initialData={initialLoad.data}
      initialSyncLabel={initialLoad.source === "cloud" ? "Облак: заредено" : "Няма връзка с Firebase"}
      initialTab={tab === "calendar" || tab === "transactions" || tab === "finance" ? tab : "upcoming"}
      initialProperty={property === "house" ? "house" as PropertyId : "villa"}
      initialMonth={isMonthParam(month) ? month : undefined}
      initialListFilter={isFilterParam(filter) ? filter : undefined}
      initialQuery={query}
      initialNewReservation={stringParam(params.new) === "1"}
      initialReservationDate={stringParam(params.date)}
      initialCalendarDate={isDateParam(stringParam(params.day)) ? stringParam(params.day) : undefined}
      initialReservationRoom={room}
      initialEditReservationId={stringParam(params.edit)}
      initialServerSession={hasServerSession}
    />
  );
}

function stringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isMonthParam(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function isDateParam(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isFilterParam(value: string | undefined): value is "all" | "today" | "next7" | "month" | "noDeposit" {
  return value === "all" || value === "today" || value === "next7" || value === "month" || value === "noDeposit";
}

async function loadInitialData(): Promise<{ data: AppData; source: "cloud" | "empty" }> {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) return { data: createEmptyData(), source: "empty" };

  try {
    const response = await fetch(`${databaseUrl}/${DB_PATH}.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { data: createEmptyData(), source: "empty" };
    return { data: normalizeImportedData(await response.json()), source: "cloud" };
  } catch {
    return { data: createEmptyData(), source: "empty" };
  }
}
