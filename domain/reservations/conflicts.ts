import { rangesOverlap } from "./dateRange";
import type { Reservation, RoomId } from "./types";

export type ConflictResult = {
  ok: boolean;
  message?: string;
  conflictingReservationId?: string;
};

export function hasWholeProperty(rooms: RoomId[] | ["all"]): boolean {
  return rooms.includes("all");
}

export function validateReservationConflict(
  candidate: Pick<Reservation, "id" | "propertyId" | "rooms" | "checkin" | "checkout">,
  existingReservations: Reservation[]
): ConflictResult {
  for (const existing of existingReservations) {
    if (existing.id === candidate.id) continue;
    if (existing.status === "cancelled") continue;
    if (existing.propertyId !== candidate.propertyId) continue;
    if (!rangesOverlap(candidate.checkin, candidate.checkout, existing.checkin, existing.checkout)) continue;

    if (hasWholeProperty(candidate.rooms)) {
      return {
        ok: false,
        message: `Има друга резервация в периода ${candidate.checkin} - ${candidate.checkout}.`,
        conflictingReservationId: existing.id
      };
    }

    if (hasWholeProperty(existing.rooms)) {
      return {
        ok: false,
        message: `Обектът е резервиран като ЦЯЛА за част от периода.`,
        conflictingReservationId: existing.id
      };
    }

    const existingRooms = new Set(existing.rooms.map(String));
    const conflictRoom = candidate.rooms.find((room) => existingRooms.has(String(room)));
    if (conflictRoom) {
      return {
        ok: false,
        message: `Стая ${conflictRoom} е заета за част от периода.`,
        conflictingReservationId: existing.id
      };
    }
  }

  return { ok: true };
}
