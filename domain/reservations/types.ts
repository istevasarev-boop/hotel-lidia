export type PropertyId = "villa" | "house";
export type ReservationStatus = "pending" | "deposit_paid" | "paid" | "cancelled";
export type RoomId = string;

export type PropertyConfig = {
  id: PropertyId;
  name: string;
  rooms: RoomId[];
};

export type Reservation = {
  id: string;
  propertyId: PropertyId;
  rooms: RoomId[] | ["all"];
  checkin: string;
  checkout: string;
  guestName: string;
  phone: string;
  notes: string;
  depositAmount: number;
  totalAmount: number;
  status: ReservationStatus;
  createdAt: string;
  updatedAt: string;
};

export type ManualIncome = {
  id: string;
  month: string;
  date: string;
  type: string;
  amount: number;
  note: string;
};

export type Expense = {
  id: string;
  month: string;
  date: string;
  type: string;
  amount: number;
  note: string;
};

export type AppData = {
  schemaVersion: 2;
  reservations: Record<string, Reservation>;
  manualIncomes: Record<string, ManualIncome>;
  expenses: Record<string, Expense>;
};

export type LegacyData = {
  finances?: {
    incomes?: Record<string, Array<Record<string, unknown>>>;
    expenses?: Record<string, Array<Record<string, unknown>>>;
  };
  reservations?: Record<string, Record<string, Array<Record<string, unknown>>>>;
  reservationMasters?: Record<string, Record<string, unknown>>;
};

export const PROPERTIES: PropertyConfig[] = [
  { id: "villa", name: "Вила Лидия", rooms: ["5", "6", "7", "8", "9", "10", "11"] },
  { id: "house", name: "Къща Лидия", rooms: ["1", "2", "3", "4"] }
];

export const EMPTY_DATA: AppData = {
  schemaVersion: 2,
  reservations: {},
  manualIncomes: {},
  expenses: {}
};

export function createEmptyData(): AppData {
  return {
    schemaVersion: 2,
    reservations: {},
    manualIncomes: {},
    expenses: {}
  };
}
