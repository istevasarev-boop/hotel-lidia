import { PROPERTIES, type Reservation } from "@/domain/reservations/types";
import { isISODate, isTime } from "./csv";
import { identityMode, parseEgn } from "./identity";
import type { EstiExportDraft, EstiTouristDraft } from "./types";

export type EstiValidationError = {
  field: string;
  message: string;
};

export const ACCOMODATION_PLACE_UIN_MESSAGE = "Въведете валиден ЕСТИ/НТР номер на мястото за настаняване.";

export function validateEstiExport(reservation: Reservation, draft: EstiExportDraft): EstiValidationError[] {
  const errors: EstiValidationError[] = [];

  if (!isValidAccomodationPlaceUin(draft.accomodationPlaceUin)) {
    errors.push({ field: "accomodationPlaceUin", message: ACCOMODATION_PLACE_UIN_MESSAGE });
  }
  if (!isISODate(reservation.checkin) || !isTime(draft.checkInTime)) {
    errors.push({ field: "checkInTime", message: "Попълни валиден час за check-in." });
  }
  if (!isISODate(reservation.checkout) || !isTime(draft.checkOutTime)) {
    errors.push({ field: "checkOutTime", message: "Попълни валиден час за check-out." });
  }
  if (!isCheckoutAfterCheckin(reservation.checkin, draft.checkInTime, reservation.checkout, draft.checkOutTime)) {
    errors.push({ field: "checkout", message: "Check-out трябва да бъде след check-in." });
  }
  if (!draft.tourists.length) {
    errors.push({ field: "tourists", message: "Добави поне един турист." });
  }

  draft.tourists.forEach((tourist, index) => {
    validateTourist(reservation, tourist, index, errors);
  });

  return errors;
}

export function canGenerateEstiCsv(reservation: Reservation, draft: EstiExportDraft): boolean {
  return validateEstiExport(reservation, draft).length === 0;
}

export function isValidAccomodationPlaceUin(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/\s/.test(normalized)) return false;
  return /^[A-Za-zА-Яа-я0-9._/-]+$/.test(normalized);
}

function validateTourist(reservation: Reservation, tourist: EstiTouristDraft, index: number, errors: EstiValidationError[]): void {
  const label = `Турист ${index + 1}`;
  if (!tourist.firstName.trim()) errors.push({ field: `tourists.${index}.firstName`, message: `${label}: попълни име.` });
  if (/\d/.test(tourist.firstName + tourist.lastName)) errors.push({ field: `tourists.${index}.name`, message: `${label}: имената не могат да съдържат цифри. Провери името и фамилията.` });
  if (!tourist.lastName.trim()) errors.push({ field: `tourists.${index}.lastName`, message: `${label}: попълни фамилия.` });
  if (identityMode(tourist) === "egn") {
    if (!parseEgn(tourist.identityNumber.trim())) errors.push({ field: `tourists.${index}.identityNumber`, message: `${label}: попълни валидно ЕГН.` });
  } else {
    if (!isISODate(tourist.birthDate) || tourist.birthDate > new Date().toISOString().slice(0, 10)) errors.push({ field: `tourists.${index}.birthDate`, message: `${label}: попълни валидна дата на раждане.` });
    if (tourist.genderTypeCode !== "M" && tourist.genderTypeCode !== "F") errors.push({ field: `tourists.${index}.genderTypeCode`, message: `${label}: избери пол.` });
  }
  if (tourist.identityDocumentTypeCode && !["ICA", "PAS", "DRL"].includes(tourist.identityDocumentTypeCode)) errors.push({ field: `tourists.${index}.document`, message: `${label}: невалиден вид документ.` });
  if (tourist.identityDocumentCountryCode && !/^[A-Z]{2}$/.test(tourist.identityDocumentCountryCode)) errors.push({ field: `tourists.${index}.country`, message: `${label}: невалиден код на държава.` });
  if (tourist.identityDocumentNumber.trim().length > 20) {
    errors.push({ field: `tourists.${index}.identityDocumentNumber`, message: `${label}: номерът на документа трябва да е максимум 20 символа.` });
  }
  if (tourist.room && !getAllowedRooms(reservation).includes(String(tourist.room))) {
    errors.push({ field: `tourists.${index}.room`, message: `${label}: избери реална стая. Не може да се export-ва "цялата".` });
  }
  if (tourist.touristPackage !== "TRUE" && tourist.touristPackage !== "FALSE") {
    errors.push({ field: `tourists.${index}.touristPackage`, message: `${label}: TouristPackage трябва да е TRUE или FALSE.` });
  }

}

export function getAllowedRooms(reservation: Reservation): string[] {
  if (!reservation.rooms.includes("all")) return reservation.rooms.map(String);
  return PROPERTIES.find((property) => property.id === reservation.propertyId)?.rooms || [];
}

function isCheckoutAfterCheckin(checkin: string, checkInTime: string, checkout: string, checkOutTime: string): boolean {
  if (!isISODate(checkin) || !isISODate(checkout) || !isTime(checkInTime) || !isTime(checkOutTime)) return false;
  return new Date(`${checkout}T${checkOutTime}:00`).getTime() > new Date(`${checkin}T${checkInTime}:00`).getTime();
}
