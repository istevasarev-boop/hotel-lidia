import { PROPERTIES, type Reservation } from "@/domain/reservations/types";
import { formatEstiMoney, isISODate, isTime } from "./csv";
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
  if (/[\u0400-\u04FF]/.test(normalized)) return false;
  return /^[A-Za-z0-9._/-]+$/.test(normalized);
}

function validateTourist(reservation: Reservation, tourist: EstiTouristDraft, index: number, errors: EstiValidationError[]): void {
  const label = `Турист ${index + 1}`;
  if (!tourist.firstName.trim()) errors.push({ field: `tourists.${index}.firstName`, message: `${label}: попълни име.` });
  if (!tourist.lastName.trim()) errors.push({ field: `tourists.${index}.lastName`, message: `${label}: попълни фамилия.` });
  if (!isISODate(tourist.birthDate)) errors.push({ field: `tourists.${index}.birthDate`, message: `${label}: попълни валидна дата на раждане.` });
  if (tourist.genderTypeCode !== "M" && tourist.genderTypeCode !== "F") {
    errors.push({ field: `tourists.${index}.genderTypeCode`, message: `${label}: избери пол M или F.` });
  }
  if (!["ICA", "PAS", "DRL"].includes(tourist.identityDocumentTypeCode)) {
    errors.push({ field: `tourists.${index}.identityDocumentTypeCode`, message: `${label}: избери тип документ ICA, PAS или DRL.` });
  }
  const country = tourist.identityDocumentCountryCode.trim();
  if (!/^[A-Z]{2}$/.test(country)) {
    errors.push({ field: `tourists.${index}.identityDocumentCountryCode`, message: `${label}: държавата на документа трябва да е 2 главни букви, напр. BG.` });
  }
  if (tourist.identityNumber.trim().length > 10) {
    errors.push({ field: `tourists.${index}.identityNumber`, message: `${label}: ЕГН/ЛНЧ трябва да е максимум 10 символа.` });
  }
  if (tourist.identityDocumentNumber.trim().length > 20) {
    errors.push({ field: `tourists.${index}.identityDocumentNumber`, message: `${label}: номерът на документа трябва да е максимум 20 символа.` });
  }
  if (!hasCompleteIdentification(tourist)) {
    errors.push({ field: `tourists.${index}.identity`, message: `${label}: попълни ЕГН/ЛНЧ или пълни данни за документ.` });
  }
  if (!getAllowedRooms(reservation).includes(String(tourist.room))) {
    errors.push({ field: `tourists.${index}.room`, message: `${label}: избери реална стая. Не може да се export-ва "цялата".` });
  }
  if (tourist.touristPackage !== "TRUE" && tourist.touristPackage !== "FALSE") {
    errors.push({ field: `tourists.${index}.touristPackage`, message: `${label}: TouristPackage трябва да е TRUE или FALSE.` });
  }
  if (!tourist.avgNightPrice.trim() || !formatEstiMoney(tourist.avgNightPrice)) {
    errors.push({ field: `tourists.${index}.avgNightPrice`, message: `${label}: попълни валидна неотрицателна средна цена на нощувка.` });
  }
}

export function getAllowedRooms(reservation: Reservation): string[] {
  if (!reservation.rooms.includes("all")) return reservation.rooms.map(String);
  return PROPERTIES.find((property) => property.id === reservation.propertyId)?.rooms || [];
}

function hasCompleteIdentification(tourist: EstiTouristDraft): boolean {
  const hasIdentityNumber = tourist.identityNumber.trim().length > 0;
  const hasDocument = Boolean(
    tourist.identityDocumentTypeCode &&
      tourist.identityDocumentNumber.trim() &&
      /^[A-Z]{2}$/.test(tourist.identityDocumentCountryCode.trim())
  );
  return hasIdentityNumber || hasDocument;
}

function isCheckoutAfterCheckin(checkin: string, checkInTime: string, checkout: string, checkOutTime: string): boolean {
  if (!isISODate(checkin) || !isISODate(checkout) || !isTime(checkInTime) || !isTime(checkOutTime)) return false;
  return new Date(`${checkout}T${checkOutTime}:00`).getTime() > new Date(`${checkin}T${checkInTime}:00`).getTime();
}
