import { eachNight, monthKey } from "./dateRange";
import { createEmptyData, PROPERTIES, type AppData, type Expense, type LegacyData, type ManualIncome, type PropertyId, type Reservation } from "./types";

export function normalizeImportedData(input: unknown): AppData {
  if (isV2Data(input)) {
    return {
      schemaVersion: 2,
      reservations: input.reservations || {},
      manualIncomes: input.manualIncomes || {},
      expenses: input.expenses || {}
    };
  }

  return legacyToV2((input || {}) as LegacyData);
}

export function legacyToV2(legacy: LegacyData): AppData {
  const data: AppData = createEmptyData();
  const masters = Object.keys(legacy.reservationMasters || {}).length
    ? legacy.reservationMasters || {}
    : buildMastersFromLegacyRows(legacy);

  Object.entries(masters).forEach(([id, raw]) => {
    const propertyId = asProperty(raw.buildingKey);
    if (!propertyId) return;
    const checkin = stringValue(raw.checkin);
    const checkout = stringValue(raw.checkout);
    if (!checkin || !checkout) return;

    data.reservations[id] = {
      id,
      propertyId,
      rooms: normalizeRooms(raw.rooms),
      checkin,
      checkout,
      guestName: stringValue(raw.name),
      phone: stringValue(raw.phone),
      notes: stringValue(raw.notes),
      depositAmount: numberValue(raw.advanceAmount),
      totalAmount: numberValue(raw.totalAmount),
      status: numberValue(raw.advanceAmount) > 0 ? "deposit_paid" : "pending",
      createdAt: stringValue(raw.createdAt) || new Date().toISOString(),
      updatedAt: stringValue(raw.updatedAt) || new Date().toISOString()
    };
  });

  Object.entries(legacy.finances?.incomes || {}).forEach(([month, rows]) => {
    rows.forEach((row, index) => {
      if (typeof row.linkGroupId === "string") return;
      const id = `legacy_income_${month}_${index}`;
      data.manualIncomes[id] = {
        id,
        month,
        date: stringValue(row.date) || `${month}-01`,
        type: stringValue(row.type) || "Непосочен",
        amount: numberValue(row.amount),
        note: stringValue(row.note)
      } satisfies ManualIncome;
    });
  });

  Object.entries(legacy.finances?.expenses || {}).forEach(([month, rows]) => {
    rows.forEach((row, index) => {
      const id = `legacy_expense_${month}_${index}`;
      data.expenses[id] = {
        id,
        month,
        date: stringValue(row.date) || `${month}-01`,
        type: stringValue(row.type) || "Непосочен",
        amount: numberValue(row.amount),
        note: stringValue(row.note)
      } satisfies Expense;
    });
  });

  return data;
}

export function v2ToLegacy(data: AppData): LegacyData {
  const legacy: LegacyData = {
    finances: { incomes: {}, expenses: {} },
    reservations: { villa: {}, house: {} },
    reservationMasters: {}
  };

  Object.values(data.reservations).forEach((reservation) => {
    if (reservation.status === "cancelled") return;
    legacy.reservationMasters![reservation.id] = {
      groupId: reservation.id,
      buildingKey: reservation.propertyId,
      rooms: reservation.rooms,
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      name: reservation.guestName,
      phone: reservation.phone,
      notes: reservation.notes,
      advanceAmount: reservation.depositAmount,
      totalAmount: reservation.totalAmount,
      status: reservation.depositAmount > 0 ? "advance" : "pending",
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt
    };

    let first = true;
    eachNight(reservation.checkin, reservation.checkout).forEach((date) => {
      const ym = monthKey(date);
      const rowsByMonth = legacy.reservations![reservation.propertyId]!;
      rowsByMonth[ym] = rowsByMonth[ym] || [];
      if (reservation.rooms.includes("all")) {
        rowsByMonth[ym]!.push(legacyReservationRow(reservation, date, "all", first));
      } else {
        reservation.rooms.forEach((room) => {
          rowsByMonth[ym]!.push(legacyReservationRow(reservation, date, String(room), first));
        });
      }
      first = false;
    });

    if (reservation.totalAmount > 0) {
      const ym = monthKey(reservation.checkin);
      legacy.finances!.incomes![ym] = legacy.finances!.incomes![ym] || [];
      const propertyName = PROPERTIES.find((property) => property.id === reservation.propertyId)?.name || reservation.propertyId;
      const roomsLabel = reservation.rooms.includes("all") ? "ЦЯЛА" : reservation.rooms.join(",");
      legacy.finances!.incomes![ym]!.push({
        date: reservation.checkin,
        amount: reservation.totalAmount,
        type: "Общ приход",
        note: `Общ приход — ${propertyName}, стаи ${roomsLabel}`,
        linkGroupId: reservation.id
      });
    }
  });

  Object.values(data.manualIncomes).forEach((income) => {
    legacy.finances!.incomes![income.month] = legacy.finances!.incomes![income.month] || [];
    legacy.finances!.incomes![income.month]!.push({
      date: income.date,
      type: income.type,
      amount: income.amount,
      note: income.note
    });
  });

  Object.values(data.expenses).forEach((expense) => {
    legacy.finances!.expenses![expense.month] = legacy.finances!.expenses![expense.month] || [];
    legacy.finances!.expenses![expense.month]!.push({
      date: expense.date,
      type: expense.type,
      amount: expense.amount,
      note: expense.note
    });
  });

  return legacy;
}

function legacyReservationRow(reservation: Reservation, date: string, room: string, isFirstDay: boolean): Record<string, unknown> {
  return {
    id: `${reservation.id}_${date}_${room}`,
    groupId: reservation.id,
    date,
    room,
    name: reservation.guestName,
    phone: reservation.phone,
    notes: reservation.notes,
    advanceAmount: isFirstDay ? reservation.depositAmount : 0,
    isFirstDay,
    checkin: reservation.checkin,
    checkout: reservation.checkout,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt
  };
}

function buildMastersFromLegacyRows(legacy: LegacyData): Record<string, Record<string, unknown>> {
  const grouped: Record<string, { buildingKey: string; rows: Record<string, unknown>[] }> = {};
  Object.entries(legacy.reservations || {}).forEach(([buildingKey, months]) => {
    Object.values(months || {}).forEach((rows) => {
      (rows || []).forEach((row) => {
        const groupId = stringValue(row.groupId);
        if (!groupId) return;
        grouped[groupId] = grouped[groupId] || { buildingKey, rows: [] };
        grouped[groupId].rows.push(row);
      });
    });
  });

  const masters: Record<string, Record<string, unknown>> = {};
  Object.entries(grouped).forEach(([groupId, payload]) => {
    const rows = payload.rows.sort((a, b) => stringValue(a.date).localeCompare(stringValue(b.date)));
    const first = rows.find((row) => Boolean(row.isFirstDay)) || rows[0] || {};
    const rooms = Array.from(new Set(rows.map((row) => stringValue(row.room)).filter(Boolean)));
    const checkin = rows.reduce((min, row) => {
      const value = stringValue(row.checkin) || stringValue(row.date);
      return !min || value < min ? value : min;
    }, "");
    const checkout = rows.reduce((max, row) => {
      const value = stringValue(row.checkout) || stringValue(row.date);
      return !max || value > max ? value : max;
    }, "");
    masters[groupId] = {
      groupId,
      buildingKey: payload.buildingKey,
      rooms: rooms.includes("all") ? ["all"] : rooms.sort((a, b) => Number(a) - Number(b)),
      checkin,
      checkout,
      name: first.name,
      phone: first.phone,
      notes: first.notes,
      advanceAmount: first.advanceAmount,
      totalAmount: findLinkedTotal(legacy, groupId),
      createdAt: first.createdAt,
      updatedAt: first.updatedAt
    };
  });

  return masters;
}

function findLinkedTotal(legacy: LegacyData, groupId: string): number {
  let total = 0;
  Object.values(legacy.finances?.incomes || {}).forEach((rows) => {
    (rows || []).forEach((row) => {
      if (row.linkGroupId === groupId) total = numberValue(row.amount);
    });
  });
  return total;
}

function isV2Data(value: unknown): value is AppData {
  return !!value && typeof value === "object" && (value as AppData).schemaVersion === 2;
}

function asProperty(value: unknown): PropertyId | null {
  return value === "villa" || value === "house" ? value : null;
}

function normalizeRooms(value: unknown): Reservation["rooms"] {
  if (!Array.isArray(value)) return [];
  if (value.map(String).includes("all")) return ["all"];
  return value.map(String).sort((a, b) => Number(a) - Number(b));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
