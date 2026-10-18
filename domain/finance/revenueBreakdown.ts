import { getBookingTypeForRoom } from "@/domain/booking/availability";
import { monthKey } from "@/domain/reservations/dateRange";
import type { AppData, Reservation } from "@/domain/reservations/types";

export function reservationRoomGroup(reservation: Reservation) {
  if (reservation.rooms.includes("all")) return "Цял обект";
  const types = new Set(reservation.rooms.map(room => getBookingTypeForRoom(reservation.propertyId, room)));
  if (types.size !== 1) return "Смесени типове стаи";
  if (types.has("spa")) return "С джакузи";
  if (types.has("balcony")) return "Без джакузи / балкон";
  return "Други / некласифицирани стаи";
}

export function buildRevenueBreakdown(data: AppData, month: string) {
  const reservations = Object.values(data.reservations).filter(row => row.status !== "cancelled" && monthKey(row.checkin) === month);
  const byRoom: Record<string, Reservation[]> = {};
  for (const row of reservations) (byRoom[reservationRoomGroup(row)] ||= []).push(row);
  const total = (rows: Reservation[]) => rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const manualIncome = Object.values(data.manualIncomes).filter(row => row.month === month && !("linkGroupId" in row)).reduce((sum, row) => sum + row.amount, 0);
  const deposits = reservations.reduce((sum, row) => sum + row.depositAmount, 0);
  return { reservations, byRoom, total, manualIncome, deposits, reservationRevenue: total(reservations),
    withDeposit: reservations.filter(row => row.depositAmount > 0), withoutDeposit: reservations.filter(row => row.depositAmount <= 0),
    expenses: Object.values(data.expenses).filter(row => row.month === month) };
}

export function financeHistoryMonths(data: AppData, selectedMonth: string, currentMonth: string) {
  const months = new Set([selectedMonth, currentMonth]);
  Object.values(data.reservations).forEach(row => months.add(monthKey(row.checkin)));
  Object.values(data.manualIncomes).forEach(row => months.add(row.month));
  Object.values(data.expenses).forEach(row => months.add(row.month));
  return [...months].filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)).sort().reverse();
}
