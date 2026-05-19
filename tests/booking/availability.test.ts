import { describe, expect, it } from "vitest";
import { getBookingTypeForRoom, getSafeBookingInventory, isBookingEligibleRoom } from "@/domain/booking/availability";
import { createEmptyData, type AppData, type Reservation } from "@/domain/reservations/types";

function reservation(partial: Partial<Reservation>): Reservation {
  return {
    id: partial.id || "res_1",
    propertyId: partial.propertyId || "villa",
    rooms: partial.rooms || ["5"],
    checkin: partial.checkin || "2026-05-20",
    checkout: partial.checkout || "2026-05-22",
    guestName: "",
    phone: "",
    notes: "",
    depositAmount: 0,
    totalAmount: 0,
    status: "pending",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  };
}

function withOpenInventory(data: AppData, date: string, count: number): AppData {
  return {
    ...data,
    bookingOpenInventory: {
      villa: {
        spa: {
          [date]: count
        }
      }
    }
  };
}

describe("Booking.com safe inventory", () => {
  it("excludes room 6 from Booking.com mapping", () => {
    expect(isBookingEligibleRoom("villa", "6")).toBe(false);
    expect(getBookingTypeForRoom("villa", "6")).toBeNull();
  });

  it("is closed by default when no inventory is explicitly opened", () => {
    const data = createEmptyData();
    const result = getSafeBookingInventory(data, "villa", "spa", "2026-05-20");
    expect(result.physicallyFreeInventory).toBe(3);
    expect(result.openedInventory).toBe(0);
    expect(result.safeInventory).toBe(0);
  });

  it("returns opened inventory when rooms are physically free", () => {
    const data = withOpenInventory(createEmptyData(), "2026-05-20", 2);
    const result = getSafeBookingInventory(data, "villa", "spa", "2026-05-20");
    expect(result.physicallyFreeInventory).toBe(3);
    expect(result.openedInventory).toBe(2);
    expect(result.safeInventory).toBe(2);
  });

  it("clamps opened inventory by physical free rooms", () => {
    const data = withOpenInventory(createEmptyData(), "2026-05-20", 3);
    data.reservations.res_1 = reservation({ id: "res_1", rooms: ["5"] });
    data.reservations.res_2 = reservation({ id: "res_2", rooms: ["9"] });

    const result = getSafeBookingInventory(data, "villa", "spa", "2026-05-20");
    expect(result.openedInventory).toBe(3);
    expect(result.physicallyFreeInventory).toBe(1);
    expect(result.safeInventory).toBe(1);
  });

  it("blocks every Booking type during whole-property reservations", () => {
    const data = withOpenInventory(createEmptyData(), "2026-05-20", 3);
    data.reservations.res_1 = reservation({ rooms: ["all"] });

    const result = getSafeBookingInventory(data, "villa", "spa", "2026-05-20");
    expect(result.blockedByWholeProperty).toBe(true);
    expect(result.safeInventory).toBe(0);
  });

  it("recalculates automatically when reservation dates change", () => {
    const data = withOpenInventory(createEmptyData(), "2026-05-20", 1);
    data.bookingOpenInventory.villa!.spa!["2026-05-23"] = 1;
    data.reservations.res_1 = reservation({ rooms: ["5"], checkin: "2026-05-20", checkout: "2026-05-21" });
    expect(getSafeBookingInventory(data, "villa", "spa", "2026-05-20").safeInventory).toBe(1);

    data.reservations.res_1 = reservation({ rooms: ["5"], checkin: "2026-05-23", checkout: "2026-05-24" });
    expect(getSafeBookingInventory(data, "villa", "spa", "2026-05-20").safeInventory).toBe(1);
    expect(getSafeBookingInventory(data, "villa", "spa", "2026-05-23").safeInventory).toBe(1);
  });
});
