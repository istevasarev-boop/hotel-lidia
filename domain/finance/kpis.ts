import { monthKey } from "@/domain/reservations/dateRange";
import type { AppData, Reservation } from "@/domain/reservations/types";

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

function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}
