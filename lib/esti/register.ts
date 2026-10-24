import type { Reservation } from "@/domain/reservations/types";
import type { EstiExportDraft, EstiCsvRow } from "./types";
import { buildEstiCsvRows } from "./csv";
import { applyEstiDefaults, estiReservation, isEstiProperty } from "./defaults";
import { validateEstiExport } from "./validation";

export type EstiBatch = { id: string; createdAt: string; rows: EstiCsvRow[]; status: "exported" | "accepted" | "rejected"; resolvedAt?: string };
export type EstiRecord = { propertyId?: string; revision: number; draft: EstiExportDraft; batches: EstiBatch[]; updatedAt: string };
export type EstiAction = { action: "save"; draft: EstiExportDraft; revision: number } | { action: "export"; revision: number } | { action: "accepted" | "rejected"; revision: number; batchId: string };
export function isLocked(record?: EstiRecord | null) {
  return Boolean(record?.batches?.some(b => b.status !== "rejected"));
}
export function transition(record: EstiRecord | null, action: EstiAction, reservation: Reservation, now: string, batchId: string): EstiRecord {
  if (record) record = { ...record, batches: record.batches || [] };
  if ((record?.revision || 0) !== action.revision) throw new Error("Данните са променени от друг екран. Затвори и отвори отново.");
  if (action.action === "save") {
    if (isLocked(record)) throw new Error("Има изтеглен или приет файл. Отбележи резултата преди промяна.");
    const draft = applyEstiDefaults(reservation, action.draft);
    return { propertyId: draft.propertyId, revision: action.revision + 1, draft, batches: record?.batches || [], updatedAt: now };
  }
  if (!record) throw new Error("Първо запази гостите.");
  if (action.action === "export") {
    if (isLocked(record)) throw new Error("Използвай вече изтегления файл от историята.");
    record = { ...record, draft: applyEstiDefaults(reservation, record.draft) };
    reservation = estiReservation(reservation, record.draft);
    const errors = validateEstiExport(reservation, record.draft);
    if (errors.length) throw new Error(errors[0].message);
    const exportDraft = record.draft;
    const rows = buildEstiCsvRows(reservation, exportDraft, new Date(now)).map((row, i) => ({ ...row, RegistrationDate: sofiaRegistrationDate(now), AccomodationRegisterUin: `${reservation.id}-esti-${exportDraft.tourists[i].id}`.slice(0, 500) }));
    return { ...record, revision: record.revision + 1, updatedAt: now, batches: [...record.batches, { id: batchId, createdAt: now, rows, status: "exported" }] };
  }
  const batch = record.batches.find(b => b.id === action.batchId);
  if (!batch || batch.status !== "exported") throw new Error("Този файл вече има отбелязан резултат.");
  return { ...record, revision: record.revision + 1, updatedAt: now, batches: record.batches.map(b => b.id === action.batchId ? { ...b, status: action.action, resolvedAt: now } : b) };
}

export function isDraft(value: unknown): value is EstiExportDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as EstiExportDraft;
  if (d.propertyId !== undefined && !isEstiProperty(d.propertyId)) return false;
  if (![d.accomodationPlaceUin, d.checkInTime, d.checkOutTime].every(v => typeof v === "string" && v.length <= 500) || !Array.isArray(d.tourists) || d.tourists.length > 100) return false;
  const keys = ["id", "firstName", "middleName", "lastName", "birthDate", "genderTypeCode", "identityNumber", "identityDocumentTypeCode", "identityDocumentNumber", "identityDocumentCountryCode", "floor", "room", "touristPackage", "avgNightPrice"] as const;
  return d.tourists.every(t => t && keys.every(k => typeof t[k] === "string" && t[k].length <= 500) && /^[a-zA-Z0-9_-]{1,100}$/.test(t.id)) && new Set(d.tourists.map(t => t.id)).size === d.tourists.length;
}

function sofiaRegistrationDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}
