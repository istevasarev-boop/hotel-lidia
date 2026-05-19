export function todayISO(): string {
  return toISODate(new Date());
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function toISODate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function addDaysISO(isoDate: string, days: number): string {
  const date = parseLocalDate(isoDate);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function eachNight(checkin: string, checkout: string): string[] {
  const nights: string[] = [];
  const cursor = parseLocalDate(checkin);
  let end = parseLocalDate(checkout);

  if (end <= cursor) {
    end = parseLocalDate(addDaysISO(checkin, 1));
  }

  while (cursor < end) {
    nights.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return nights;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function activeOnDate(checkin: string, checkout: string, isoDate: string): boolean {
  return checkin <= isoDate && isoDate < checkout;
}

export function overlapsMonth(checkin: string, checkout: string, ym: string): boolean {
  const monthStart = `${ym}-01`;
  const [year, month] = ym.split("-").map(Number);
  const monthEnd = toISODate(new Date(year, month, 1));
  return rangesOverlap(checkin, checkout, monthStart, monthEnd);
}

export function normalizeCheckout(checkin: string, checkout: string): string {
  return checkout && checkout > checkin ? checkout : addDaysISO(checkin, 1);
}

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}
