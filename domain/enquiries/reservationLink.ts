import type { AppData, Reservation } from "@/domain/reservations/types";
import { convertedEnquiryIds } from "./reporting";

export type EnquiryContact = { id: string; name: string; email: string; phone: string };

export function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) return `359${digits.slice(1)}`;
  return digits;
}

export function reservationMatchReasons(enquiry: EnquiryContact, reservation: Reservation): string[] {
  const reasons: string[] = [];
  const phone = normalizedPhone(enquiry.phone);
  if (phone.length >= 7 && phone === normalizedPhone(reservation.phone)) reasons.push("Съвпадение по телефон");
  const email = enquiry.email.trim().toLowerCase();
  const emails = reservation.notes.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (email && emails.some(value => value.toLowerCase() === email)) reasons.push("Съвпадение по имейл");
  return reasons;
}

export function linkExistingReservation(data: AppData, enquiryId: string, reservationId: string): AppData {
  if (!enquiryId || /[\[\]\s]/.test(enquiryId)) throw new Error("Невалидно запитване.");
  const reservation = data.reservations[reservationId];
  if (!reservation || reservation.status === "cancelled") throw new Error("Резервацията вече не е налична.");
  const ownMarker = `[enquiry:${enquiryId}]`;
  const links = Array.from(reservation.notes.matchAll(/\[enquiry:([^\]]+)\]/g), match => match[1]);
  if (links.some(id => id !== enquiryId)) throw new Error("Тази резервация вече е свързана с друго запитване.");
  if (links.includes(enquiryId)) return data;
  if (convertedEnquiryIds(Object.values(data.reservations)).has(enquiryId)) throw new Error("Запитването вече е свързано с резервация. Обновете списъка.");
  return { ...data, reservations: { ...data.reservations, [reservationId]: {
    ...reservation, notes: [reservation.notes.trim(), ownMarker].filter(Boolean).join(" · "), updatedAt: new Date().toISOString()
  } } };
}
