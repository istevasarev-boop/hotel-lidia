import { HotelApp } from "@/components/HotelApp";
import { normalizeImportedData } from "@/domain/reservations/legacyAdapter";
import { createEmptyData, type AppData } from "@/domain/reservations/types";
import { getFirebaseAdminAuth, getFirebaseAdminDatabase, hasFirebaseAdminConfig } from "@/lib/firebase/admin";
import type { PropertyId } from "@/domain/reservations/types";
import { cookies } from "next/headers";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type InitialLoadSource = "cloud" | "empty" | "permission-denied" | "cloud-unavailable";

const DB_PATH = "lydia_hotel_v1";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = stringParam(params.tab);
  const property = stringParam(params.property);
  const room = stringParam(params.room);
  const month = stringParam(params.month);
  const filter = stringParam(params.filter);
  const query = stringParam(params.q);
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("hotel_lidia_session")?.value;
  const initialLoad = await loadInitialData(sessionToken);

  return (
    <HotelApp
      initialData={initialLoad.data}
      initialSyncLabel={initialSyncLabel(initialLoad.source)}
      initialLoadSource={initialLoad.source}
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

function isFilterParam(value: string | undefined): value is "all" | "today" | "next7" | "month" | "noDeposit" | "history" {
  return value === "all" || value === "today" || value === "next7" || value === "month" || value === "noDeposit" || value === "history";
}

function initialSyncLabel(source: InitialLoadSource): string {
  if (source === "cloud") return "Облак: заредено";
  if (source === "permission-denied") return "Няма достъп до Firebase";
  if (source === "cloud-unavailable") return "Firebase не отговори";
  return "Няма данни";
}

async function loadInitialData(sessionToken?: string): Promise<{ data: AppData; source: InitialLoadSource }> {
  if (hasFirebaseAdminConfig()) {
    if (!sessionToken) return { data: createEmptyData(), source: "empty" };

    try {
      await getFirebaseAdminAuth().verifyIdToken(sessionToken);
      const snapshot = await getFirebaseAdminDatabase().ref(DB_PATH).get();
      if (!snapshot.exists()) return { data: createEmptyData(), source: "empty" };
      return { data: normalizeImportedData(snapshot.val()), source: "cloud" };
    } catch {
      return { data: createEmptyData(), source: "permission-denied" };
    }
  }

  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) return { data: createEmptyData(), source: "empty" };

  try {
    const response = await fetch(firebaseRestUrl(databaseUrl, DB_PATH, sessionToken), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 401 || response.status === 403) {
      return { data: createEmptyData(), source: "permission-denied" };
    }
    if (response.status === 404) return { data: createEmptyData(), source: "empty" };
    if (!response.ok) return { data: createEmptyData(), source: "cloud-unavailable" };
    return { data: normalizeImportedData(await response.json()), source: "cloud" };
  } catch {
    return { data: createEmptyData(), source: "cloud-unavailable" };
  }
}

function firebaseRestUrl(databaseUrl: string, path: string, authToken?: string): string {
  const url = new URL(`${databaseUrl}/${path}.json`);
  if (authToken) url.searchParams.set("auth", authToken);
  return url.toString();
}
