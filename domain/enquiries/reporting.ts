import type { Reservation } from "@/domain/reservations/types";

export type ReportEnquiry = { id: string; email: string; createdAt: string; status: "new" | "contacted" | "dismissed" };

export function isInternalEnquiry(enquiry: { email: string }) {
  const email = enquiry.email.trim().toLowerCase();
  return email === "istevasarev@gmail.com" || email === "codex-qa@example.invalid";
}

// A booking must explicitly reference its source enquiry; email/name guesses are not conversions.
export function convertedEnquiryIds(reservations: Reservation[]) {
  const ids = new Set<string>();
  for (const reservation of reservations) {
    if (reservation.status === "cancelled") continue;
    for (const match of reservation.notes.matchAll(/\[enquiry:([^\]]+)\]/g)) ids.add(match[1]);
  }
  return ids;
}

export function enquiryReceivedMonth(createdAt: string) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}`;
}

export function enquirySummary(enquiries: ReportEnquiry[], converted: Set<string>) {
  const real = enquiries.filter(item => !isInternalEnquiry(item));
  const convertedCount = real.filter(item => converted.has(item.id)).length;
  return { total: real.length, converted: convertedCount, conversion: real.length ? convertedCount / real.length * 100 : null,
    new: real.filter(item => item.status === "new" && !converted.has(item.id)).length,
    contacted: real.filter(item => item.status === "contacted" && !converted.has(item.id)).length,
    archived: real.filter(item => item.status === "dismissed" && !converted.has(item.id)).length };
}
