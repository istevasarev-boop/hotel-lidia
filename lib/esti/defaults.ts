import { repairAutofilledName } from "./names";
import type { PropertyId, Reservation } from "@/domain/reservations/types";
import type { EstiExportDraft } from "./types";

export const ESTI_PROPERTY_UINS: Record<PropertyId, string> = {
  house: "Б4-ИИЩ-1МА-1П",
  villa: "Б4-2ЛР-1МА-1П"
};
export function isEstiProperty(value: unknown): value is PropertyId {
  return value === "house" || value === "villa";
}
export function estiReservation(reservation: Reservation, draft: EstiExportDraft): Reservation {
  const propertyId = isEstiProperty(reservation.propertyId) ? reservation.propertyId : draft.propertyId;
  return isEstiProperty(propertyId) ? { ...reservation, propertyId } : reservation;
}
export function applyEstiDefaults(reservation: Reservation, draft: EstiExportDraft): EstiExportDraft {
  const propertyId = estiReservation(reservation, draft).propertyId;
  return { ...draft, tourists: draft.tourists.map((tourist, index) => index === 0 ? repairAutofilledName(tourist, reservation.guestName || "") : tourist), propertyId: isEstiProperty(propertyId) ? propertyId : undefined,
    accomodationPlaceUin: isEstiProperty(propertyId) ? ESTI_PROPERTY_UINS[propertyId] : "",
    checkInTime: draft.checkInTime || "14:00", checkOutTime: draft.checkOutTime || "12:00" };
}
