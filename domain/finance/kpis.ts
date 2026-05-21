import { eachNight, monthKey } from "@/domain/reservations/dateRange";
import { PROPERTIES, type AppData, type Reservation } from "@/domain/reservations/types";

export type FinanceKpis = {
  reservationRevenue: number;
  deposits: number;
  manualIncome: number;
  expenses: number;
  totalRevenue: number;
  net: number;
};

export function calculateFinanceKpis(data: AppData, month: string): FinanceKpis {
  const activeReservations = Object.values(data.reservations).filter(
    (reservation) => reservation.status !== "cancelled" && monthKey(reservation.checkin) === month
  );
  const reservationRevenue = sum(activeReservations.map((reservation) => reservation.totalAmount));
  const deposits = sum(activeReservations.map((reservation) => reservation.depositAmount));
  const manualIncome = sum(
    Object.values(data.manualIncomes)
      .filter((income) => income.month === month)
      .map((income) => income.amount)
  );
  const expenses = sum(
    Object.values(data.expenses)
      .filter((expense) => expense.month === month)
      .map((expense) => expense.amount)
  );
  const totalRevenue = reservationRevenue + manualIncome;

  return {
    reservationRevenue,
    deposits,
    manualIncome,
    expenses,
    totalRevenue,
    net: totalRevenue - expenses
  };
}

export function reservationBalance(reservation: Reservation): number {
  return reservation.totalAmount - reservation.depositAmount;
}

export function calculateOccupancyPercent(data: AppData, month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const totalAvailableRoomNights = 11 * daysInMonth;
  if (!totalAvailableRoomNights) return 0;

  const reservedRoomNights = Object.values(data.reservations)
    .filter((reservation) => reservation.status !== "cancelled")
    .reduce((total, reservation) => {
      const roomsPerNight = reservation.rooms.includes("all")
        ? PROPERTIES.find((property) => property.id === reservation.propertyId)?.rooms.length || 0
        : new Set(reservation.rooms.map(String)).size;
      const nightsInMonth = eachNight(reservation.checkin, reservation.checkout)
        .filter((night) => monthKey(night) === month).length;

      return total + roomsPerNight * nightsInMonth;
    }, 0);

  return Math.round((reservedRoomNights / totalAvailableRoomNights) * 100);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}
