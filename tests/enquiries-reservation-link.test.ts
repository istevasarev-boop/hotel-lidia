import { describe, expect, it } from "vitest";
import { linkExistingReservation, reservationMatchReasons } from "@/domain/enquiries/reservationLink";
import { convertedEnquiryIds } from "@/domain/enquiries/reporting";
import { createEmptyData, type Reservation } from "@/domain/reservations/types";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";

const enquiry = { id: "request-a", name: "Мария", phone: "0888 123 456", email: "maria@example.com" };
const reservation: Reservation = { id: "booking-a", propertyId: "house", rooms: ["1"], checkin: "2026-12-01", checkout: "2026-12-04", guestName: "Мария", phone: "+359 888 123 456", notes: "Късен чек-ин · Email: MARIA@example.com", depositAmount: 100, totalAmount: 300, status: "deposit_paid", createdAt: "2026-10-01", updatedAt: "2026-10-01" };
const data = () => ({ ...createEmptyData(), reservations: { [reservation.id]: reservation } });

describe("linking existing bookings to enquiries", () => {
  it("suggests exact contact matches regardless of booking dates or property", () => {
    expect(reservationMatchReasons(enquiry, reservation)).toHaveLength(2);
    expect(reservationMatchReasons({ ...enquiry, phone: "00359888123456" }, reservation)).toHaveLength(2);
    expect(reservationMatchReasons({ ...enquiry, phone: "123", email: "aria@example.com" }, reservation)).toEqual([]);
  });
  it("preserves booking details and counts the link after a persistence round trip", () => {
    const source = data();
    const linked = linkExistingReservation(source, enquiry.id, reservation.id);
    expect(linked.reservations[reservation.id]).toMatchObject({ ...reservation, notes: `${reservation.notes} · [enquiry:request-a]`, updatedAt: expect.any(String) });
    expect(source.reservations[reservation.id].notes).toBe(reservation.notes);
    const restored = normalizeImportedData(v2ToLegacy(linked));
    expect(convertedEnquiryIds(Object.values(restored.reservations)).has(enquiry.id)).toBe(true);
    expect(linkExistingReservation(linked, enquiry.id, reservation.id)).toBe(linked);
  });
  it("rejects cancelled, deleted and already-linked bookings and duplicate enquiry links", () => {
    expect(() => linkExistingReservation(data(), enquiry.id, "missing")).toThrow();
    expect(() => linkExistingReservation({ ...data(), reservations: { ...data().reservations, [reservation.id]: { ...reservation, status: "cancelled" } } }, enquiry.id, reservation.id)).toThrow();
    const linked = linkExistingReservation(data(), enquiry.id, reservation.id);
    expect(() => linkExistingReservation(linked, "another-request", reservation.id)).toThrow("друго запитване");
    expect(() => linkExistingReservation({ ...linked, reservations: { ...linked.reservations, other: { ...reservation, id: "other" } } }, enquiry.id, "other")).toThrow("вече е свързано");
  });
});
