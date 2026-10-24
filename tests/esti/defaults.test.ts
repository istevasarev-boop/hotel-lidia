import { describe, expect, it } from "vitest";
import { applyEstiDefaults, estiReservation } from "@/lib/esti/defaults";
import { isValidAccomodationPlaceUin } from "@/lib/esti/validation";
import type { Reservation } from "@/domain/reservations/types";
import type { EstiExportDraft } from "@/lib/esti/types";
const draft: EstiExportDraft = { accomodationPlaceUin: "OLD", checkInTime: "", checkOutTime: "", tourists: [] };
describe("ESTI property defaults", () => {
  it.each([["house", "Б4-ИИЩ-1МА-1П"], ["villa", "Б4-2ЛР-1МА-1П"]])("uses the exact configured number for %s", (propertyId, uin) => {
    const result = applyEstiDefaults({ propertyId } as Reservation, draft);
    expect(result.accomodationPlaceUin).toBe(uin);
    expect(isValidAccomodationPlaceUin(uin)).toBe(true);
    expect(result.checkInTime).toBe("14:00");
    expect(result.checkOutTime).toBe("12:00");
  });
  it("prefers the booking property over a stale selection and preserves edited times", () => {
    const result = applyEstiDefaults({ propertyId: "villa" } as Reservation, { ...draft, propertyId: "house", checkInTime: "16:30" });
    expect(result.propertyId).toBe("villa");
    expect(result.checkInTime).toBe("16:30");
  });
  it("requires selection for missing property without changing the booking", () => {
    const reservation = { rooms: ["all"] } as Reservation;
    expect(applyEstiDefaults(reservation, draft).accomodationPlaceUin).toBe("");
    const selected = applyEstiDefaults(reservation, { ...draft, propertyId: "house" });
    expect(estiReservation(reservation, selected).propertyId).toBe("house");
    expect(reservation.propertyId).toBeUndefined();
  });
});
