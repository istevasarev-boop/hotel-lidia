import { validateReservationConflict } from "./conflicts";
import type { PropertyConfig, Reservation, RoomId } from "./types";

export type PropertyAvailability = {
  propertyId: string;
  availableRooms: RoomId[];
  wholeAvailable: boolean;
};

export function getPropertyAvailability(
  property: PropertyConfig,
  checkin: string,
  checkout: string,
  reservations: Reservation[]
): PropertyAvailability {
  const relevant = reservations.filter((reservation) => reservation.propertyId === property.id);
  const availableRooms = property.rooms.filter((room) => {
    const result = validateReservationConflict(
      {
        id: "__availability__",
        propertyId: property.id,
        rooms: [room],
        checkin,
        checkout
      },
      relevant
    );
    return result.ok;
  });

  const wholeAvailable = validateReservationConflict(
    {
      id: "__availability_whole__",
      propertyId: property.id,
      rooms: ["all"],
      checkin,
      checkout
    },
    relevant
  ).ok;

  return { propertyId: property.id, availableRooms, wholeAvailable };
}
