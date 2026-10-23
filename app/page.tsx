import { HotelApp } from "@/components/HotelApp";
import { createEmptyData, type PropertyId } from "@/domain/reservations/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = stringParam(params.tab);
  const property = stringParam(params.property);
  const room = stringParam(params.room);
  const month = stringParam(params.month);
  const filter = stringParam(params.filter);
  const query = stringParam(params.q);
  // Render the shell immediately. HotelApp authenticates and loads protected data once.

  return (
    <HotelApp
      initialData={createEmptyData()}
      initialSyncLabel="Зареждане..."
      initialLoadSource="empty"
      initialTab={tab === "calendar" || tab === "transactions" || tab === "finance" || tab === "enquiries" || tab === "esti" ? tab : "upcoming"}
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
