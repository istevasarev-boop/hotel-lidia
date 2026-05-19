import { describe, expect, it } from "vitest";
import { getPropertyAvailability } from "@/domain/reservations/availability";
import { validateReservationConflict } from "@/domain/reservations/conflicts";
import { eachNight } from "@/domain/reservations/dateRange";
import { deleteReservationById } from "@/domain/reservations/store";
import { PROPERTIES, type Reservation } from "@/domain/reservations/types";

const base: Reservation = {
  id: "res_1",
  propertyId: "villa",
  rooms: ["5"],
  checkin: "2026-06-10",
  checkout: "2026-06-12",
  guestName: "Иван",
  phone: "",
  notes: "",
  depositAmount: 50,
  totalAmount: 200,
  status: "deposit_paid",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("reservation conflict logic", () => {
  it("treats checkout date as exclusive", () => {
    expect(eachNight("2026-06-10", "2026-06-12")).toEqual(["2026-06-10", "2026-06-11"]);

    const result = validateReservationConflict(
      { ...base, id: "res_2", checkin: "2026-06-12", checkout: "2026-06-13" },
      [base]
    );

    expect(result.ok).toBe(true);
  });

  it("blocks overlapping booking for the same room", () => {
    const result = validateReservationConflict(
      { ...base, id: "res_2", checkin: "2026-06-11", checkout: "2026-06-13" },
      [base]
    );

    expect(result.ok).toBe(false);
  });

  it("allows overlapping booking for a different room in the same property", () => {
    const result = validateReservationConflict(
      { ...base, id: "res_2", rooms: ["6"], checkin: "2026-06-11", checkout: "2026-06-13" },
      [base]
    );

    expect(result.ok).toBe(true);
  });

  it("blocks whole-property booking when any room is occupied", () => {
    const result = validateReservationConflict(
      { ...base, id: "res_2", rooms: ["all"], checkin: "2026-06-11", checkout: "2026-06-13" },
      [base]
    );

    expect(result.ok).toBe(false);
  });

  it("blocks room booking when the whole property is occupied", () => {
    const result = validateReservationConflict(
      { ...base, id: "res_2", rooms: ["5"], checkin: "2026-06-11", checkout: "2026-06-13" },
      [{ ...base, rooms: ["all"] }]
    );

    expect(result.ok).toBe(false);
  });

  it("ignores the edited reservation itself", () => {
    const result = validateReservationConflict(
      { ...base, rooms: ["5", "6"], checkout: "2026-06-13" },
      [base]
    );

    expect(result.ok).toBe(true);
  });

  it("updates availability for room and whole-property checks", () => {
    const villa = PROPERTIES.find((property) => property.id === "villa")!;
    const result = getPropertyAvailability(villa, "2026-06-11", "2026-06-12", [base]);

    expect(result.availableRooms).not.toContain("5");
    expect(result.availableRooms).toContain("6");
    expect(result.wholeAvailable).toBe(false);
  });

  it("deletes reservation records by id", () => {
    const data = {
      schemaVersion: 2 as const,
      reservations: { [base.id]: base },
      manualIncomes: {},
      expenses: {}
    };

    expect(deleteReservationById(data, base.id).reservations[base.id]).toBeUndefined();
  });
});
