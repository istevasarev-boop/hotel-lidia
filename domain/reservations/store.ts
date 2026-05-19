import type { AppData, Reservation } from "./types";

export function upsertReservation(data: AppData, reservation: Reservation): AppData {
  return {
    ...data,
    reservations: {
      ...data.reservations,
      [reservation.id]: reservation
    }
  };
}

export function deleteReservationById(data: AppData, reservationId: string): AppData {
  const reservations = { ...data.reservations };
  delete reservations[reservationId];
  return { ...data, reservations };
}
