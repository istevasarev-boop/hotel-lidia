import { describe, expect, it } from "vitest";
import { transition, isDraft } from "@/lib/esti/register";
import { createEmptyData, type Reservation } from "@/domain/reservations/types";
import { upsertReservation } from "@/domain/reservations/store";
import type { EstiExportDraft } from "@/lib/esti/types";
const reservation: Reservation = { id: "res_1", propertyId: "villa", rooms: ["10"], checkin: "2026-10-23", checkout: "2026-10-25", guestName: "Test Guest", phone: "", notes: "", totalAmount: 200, depositAmount: 0, status: "pending", createdAt: "", updatedAt: "" };
const draft: EstiExportDraft = { accomodationPlaceUin: "BG-1", checkInTime: "14:00", checkOutTime: "12:00", tourists: [{ id: "guest_1", firstName: "Test", lastName: "Guest", middleName: "", birthDate: "1990-01-01", genderTypeCode: "M", identityNumber: "", identityDocumentTypeCode: "PAS", identityDocumentNumber: "TEST123", identityDocumentCountryCode: "BG", floor: "1", room: "10", touristPackage: "FALSE", avgNightPrice: "100" }] };
const now = "2026-10-23T10:00:00Z";
const save = () => transition(null, { action: "save", revision: 0, draft }, reservation, now, "unused");
describe("ESTI registration isolation and lifecycle", () => {
  it("saves incomplete drafts, but blocks export", () => {
    const r = transition(null, { action: "save", revision: 0, draft: { ...draft, tourists: [] } }, reservation, now, "unused");
    expect(() => transition(r, { action: "export", revision: 1 }, reservation, now, "b1")).toThrow();
  });
  it("retains guest identity and prevents duplicate export or editing after export", () => {
    const r = transition(save(), { action: "export", revision: 1 }, reservation, now, "b1");
    expect(r.batches[0].rows[0].AccomodationRegisterUin).toBe("res_1-esti-guest_1");
    expect(r.batches[0].status).toBe("exported");
    expect(r.batches[0].rows[0].RegistrationDate).toBe("23.10.2026 13:00");
    expect(() => transition(r, { action: "export", revision: 2 }, reservation, now, "b2")).toThrow();
    expect(() => transition(r, { action: "save", revision: 2, draft }, reservation, now, "b2")).toThrow();
  });
  it("requires explicit result and preserves original file on rejection", () => {
    const r = transition(save(), { action: "export", revision: 1 }, reservation, now, "b1");
    const rejected = transition(r, { action: "rejected", revision: 2, batchId: "b1" }, reservation, now, "unused");
    const edited = transition(rejected, { action: "save", revision: 3, draft }, reservation, now, "unused");
    expect(edited.batches[0].rows).toEqual(r.batches[0].rows);
    expect(edited.batches[0].status).toBe("rejected");
    const accepted = transition(r, { action: "accepted", revision: 2, batchId: "b1" }, reservation, now, "unused");
    expect(() => transition(accepted, { action: "save", revision: 3, draft }, reservation, now, "unused")).toThrow();
  });
  it("rejects stale revisions", () => { expect(() => transition(save(), { action: "save", revision: 0, draft }, reservation, now, "unused")).toThrow(); });
  it("never changes reservation data and reservation save needs no ESTI data", () => {
    const before = JSON.stringify(reservation); save();
    expect(JSON.stringify(reservation)).toBe(before);
    expect(upsertReservation(createEmptyData(), reservation).reservations.res_1).toEqual(reservation);
  });
  it("rejects malformed or duplicated guest ids", () => {
    expect(isDraft(draft)).toBe(true);
    expect(isDraft({ ...draft, tourists: [draft.tourists[0], draft.tourists[0]] })).toBe(false);
    expect(isDraft({ tourists: [] })).toBe(false);
  });
});
