import { activeOnDate } from "@/domain/reservations/dateRange";
import type { AppData, BookingTypeId, PropertyId, Reservation, RoomId } from "@/domain/reservations/types";

export const BOOKING_ROOM_TYPES: Record<PropertyId, Record<BookingTypeId, RoomId[]>> = {
  villa: {
    spa: ["5", "9", "10"],
    balcony: ["7", "8", "11"]
  },
  house: {
    spa: ["1", "3"],
    balcony: ["2", "4"]
  }
};

export const BOOKING_TYPE_LABELS: Record<BookingTypeId, string> = {
  spa: "SPA",
  balcony: "Балкон"
};

export type BookingInventoryResult = {
  propertyId: PropertyId;
  bookingType: BookingTypeId;
  date: string;
  capacity: number;
  openedInventory: number;
  physicallyFreeInventory: number;
  safeInventory: number;
  blockedByWholeProperty: boolean;
};

export function isBookingType(value: string): value is BookingTypeId {
  return value === "spa" || value === "balcony";
}

export function isBookingEligibleRoom(propertyId: PropertyId, room: RoomId): boolean {
  return Object.values(BOOKING_ROOM_TYPES[propertyId]).some((rooms) => rooms.includes(String(room)));
}

export function getBookingTypeForRoom(propertyId: PropertyId, room: RoomId): BookingTypeId | null {
  const normalized = String(room);
  const entry = Object.entries(BOOKING_ROOM_TYPES[propertyId]).find(([, rooms]) => rooms.includes(normalized));
  return (entry?.[0] as BookingTypeId | undefined) || null;
}

export function getBookingTypeCapacity(propertyId: PropertyId, bookingType: BookingTypeId): number {
  return BOOKING_ROOM_TYPES[propertyId][bookingType].length;
}

export function getOpenedBookingInventory(
  data: Pick<AppData, "bookingOpenInventory">,
  propertyId: PropertyId,
  bookingType: BookingTypeId,
  date: string
): number {
  const rawValue = data.bookingOpenInventory?.[propertyId]?.[bookingType]?.[date] || 0;
  const numberValue = Number(rawValue);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.min(Math.floor(numberValue), getBookingTypeCapacity(propertyId, bookingType));
}

export function getPhysicalFreeInventory(
  reservations: Reservation[],
  propertyId: PropertyId,
  bookingType: BookingTypeId,
  date: string
): { freeRooms: RoomId[]; blockedByWholeProperty: boolean } {
  const rooms = BOOKING_ROOM_TYPES[propertyId][bookingType];
  const activeReservations = reservations.filter((reservation) =>
    reservation.status !== "cancelled" &&
    reservation.propertyId === propertyId &&
    activeOnDate(reservation.checkin, reservation.checkout, date)
  );

  const blockedByWholeProperty = activeReservations.some((reservation) => reservation.rooms.includes("all"));
  if (blockedByWholeProperty) {
    return { freeRooms: [], blockedByWholeProperty: true };
  }

  const reservedRooms = new Set<string>();
  activeReservations.forEach((reservation) => {
    reservation.rooms.map(String).forEach((room) => reservedRooms.add(room));
  });

  return {
    freeRooms: rooms.filter((room) => !reservedRooms.has(room)),
    blockedByWholeProperty: false
  };
}

export function getSafeBookingInventory(
  data: Pick<AppData, "reservations" | "bookingOpenInventory">,
  propertyId: PropertyId,
  bookingType: BookingTypeId,
  date: string
): BookingInventoryResult {
  const { freeRooms, blockedByWholeProperty } = getPhysicalFreeInventory(
    Object.values(data.reservations || {}),
    propertyId,
    bookingType,
    date
  );
  const openedInventory = getOpenedBookingInventory(data, propertyId, bookingType, date);
  const physicallyFreeInventory = freeRooms.length;
  const safeInventory = Math.min(openedInventory, physicallyFreeInventory);

  return {
    propertyId,
    bookingType,
    date,
    capacity: getBookingTypeCapacity(propertyId, bookingType),
    openedInventory,
    physicallyFreeInventory,
    safeInventory,
    blockedByWholeProperty
  };
}

export function getSafeMaximumForBookingRange(
  data: Pick<AppData, "reservations" | "bookingOpenInventory">,
  propertyId: PropertyId,
  bookingType: BookingTypeId,
  dates: string[]
): number {
  if (!dates.length) return 0;
  return dates.reduce((min, date) => {
    const result = getSafeBookingInventory(data, propertyId, bookingType, date);
    return Math.min(min, result.physicallyFreeInventory);
  }, getBookingTypeCapacity(propertyId, bookingType));
}
