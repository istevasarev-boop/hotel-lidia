import { describe, expect, it } from "vitest";
import { calculateOccupancyPercent } from "@/domain/finance/kpis";
import type { AppData, Reservation } from "@/domain/reservations/types";

function dataWithReservations(reservations: Reservation[]): AppData {
  return {
    schemaVersion: 2,
    reservations: Object.fromEntries(reservations.map((reservation) => [reservation.id, reservation])),
    manualIncomes: {},
    expenses: {},
    bookingOpenInventory: {},
    bookingFeedTokens: {}
  };
}

function reservation(partial: Partial<Reservation> & Pick<Reservation, "id" | "propertyId" | "rooms" | "checkin" | "checkout">): Reservation {
  return {
    guestName: "Guest",
    phone: "",
    notes: "",
    depositAmount: 0,
    totalAmount: 0,
    status: "pending",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...partial
  };
}

describe("finance occupancy percent", () => {
  it("counts normal room nights inside the selected month", () => {
    const data = dataWithReservations([
      reservation({ id: "r1", propertyId: "villa", rooms: ["5"], checkin: "2026-05-01", checkout: "2026-05-03" })
    ]);

    expect(calculateOccupancyPercent(data, "2026-05")).toBe(1);
  });

  it("counts whole villa reservations as 7 room nights per night", () => {
    const data = dataWithReservations([
      reservation({ id: "r1", propertyId: "villa", rooms: ["all"], checkin: "2026-05-01", checkout: "2026-05-02" })
    ]);

    expect(calculateOccupancyPercent(data, "2026-05")).toBe(2);
  });

  it("counts whole house reservations as 4 room nights per night", () => {
    const data = dataWithReservations([
      reservation({ id: "r1", propertyId: "house", rooms: ["all"], checkin: "2026-05-01", checkout: "2026-05-02" })
    ]);

    expect(calculateOccupancyPercent(data, "2026-05")).toBe(1);
  });

  it("uses checkout-exclusive logic and only selected-month nights", () => {
    const data = dataWithReservations([
      reservation({ id: "r1", propertyId: "villa", rooms: ["5", "6"], checkin: "2026-04-30", checkout: "2026-05-02" })
    ]);

    expect(calculateOccupancyPercent(data, "2026-05")).toBe(1);
  });
});
