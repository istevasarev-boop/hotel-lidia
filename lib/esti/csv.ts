import type { Reservation } from "@/domain/reservations/types";
import { ESTI_CSV_HEADERS, type EstiCsvRow, type EstiExportDraft } from "./types";

export function buildEstiCsvRows(reservation: Reservation, draft: EstiExportDraft, registrationDate = new Date()): EstiCsvRow[] {
  return draft.tourists.map((tourist, index) => ({
    AccomodationPlaceUin: draft.accomodationPlaceUin.trim(),
    AccomodationRegisterUin: buildAccomodationRegisterUin(reservation.id, index),
    RegistrationDate: formatEstiDateTimeFromDate(registrationDate),
    IdentityNumber: tourist.identityNumber.trim(),
    FirstName: tourist.firstName.trim(),
    MiddleName: tourist.middleName.trim(),
    LastName: tourist.lastName.trim(),
    BirthDate: formatEstiDate(tourist.birthDate),
    GenderTypeCode: tourist.genderTypeCode,
    IdentityDocumentTypeCode: tourist.identityDocumentTypeCode,
    IdentityDocumentNumber: tourist.identityDocumentNumber.trim(),
    IdentityDocumentCountryCode: tourist.identityDocumentCountryCode.trim().toUpperCase(),
    Floor: tourist.floor.trim(),
    Room: String(tourist.room || "").trim(),
    CheckInDate: formatEstiDateTime(reservation.checkin, draft.checkInTime),
    CheckOutDate: formatEstiDateTime(reservation.checkout, draft.checkOutTime),
    TouristPackage: tourist.touristPackage,
    AvgNightPrice: formatEstiMoney(tourist.avgNightPrice),
    RegistrationTypeCode: "NEW"
  }));
}

export function serializeEstiCsv(rows: EstiCsvRow[], includeBom = true): string {
  const body = [
    ESTI_CSV_HEADERS.join(";"),
    ...rows.map((row) => ESTI_CSV_HEADERS.map((header) => escapeCsvValue(row[header])).join(";"))
  ].join("\r\n");
  return includeBom ? `\uFEFF${body}` : body;
}

export function makeEstiFilename(reservation: Reservation): string {
  const safeProperty = reservation.propertyId.replace(/[^a-z0-9_-]+/gi, "_");
  const safeId = reservation.id.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80);
  return `ESTI_${safeProperty}_${reservation.checkin}_${safeId}.csv`;
}

export function buildAccomodationRegisterUin(reservationId: string, touristIndex: number): string {
  const safeId = reservationId.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 470);
  return `${safeId}-esti-${touristIndex + 1}`.slice(0, 500);
}

export function escapeCsvValue(value: string): string {
  const text = String(value ?? "");
  if (!/[;"\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function formatEstiDate(isoDate: string): string {
  if (!isISODate(isoDate)) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

export function formatEstiDateTime(isoDate: string, time: string): string {
  if (!isISODate(isoDate) || !isTime(time)) return "";
  return `${formatEstiDate(isoDate)} ${time}`;
}

export function formatEstiDateTimeFromDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

export function formatEstiMoney(value: string | number): string {
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number < 0) return "";
  return number.toFixed(2);
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
