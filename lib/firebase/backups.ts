"use client";

import { get, ref, set } from "firebase/database";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";
import type { AppData, LegacyData } from "@/domain/reservations/types";
import { BACKUP_PATH, DB_PATH, cacheData } from "./db";
import { getFirebaseServices } from "./client";

export type BackupType = "manual" | "daily" | "before-import" | "before-delete" | "before-restore" | "auto-save";

export type BackupSummary = {
  reservationsCount: number;
  financeRecordsCount: number;
  incomeRecordsCount: number;
  expenseRecordsCount: number;
  sizeBytes: number;
};

export type HotelBackup = {
  version: 1;
  timestamp: string;
  type: BackupType;
  createdBy?: string;
  summary: BackupSummary;
  data: LegacyData & { settings?: unknown };
};

export type BackupListItem = {
  id: string;
  timestamp: string;
  type: BackupType | "legacy";
  createdBy?: string;
  summary: BackupSummary;
};

export async function createBackup(data: AppData, type: BackupType, createdBy?: string): Promise<BackupListItem> {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase не е конфигуриран.");

  const timestamp = new Date().toISOString();
  const legacy = v2ToLegacy(normalizeImportedData(data));
  const backup: HotelBackup = {
    version: 1,
    timestamp,
    type,
    createdBy,
    summary: summarizeLegacy(legacy),
    data: pickKnownPaths(legacy)
  };
  const id = backupId(timestamp, type);
  await set(ref(services.db, `${BACKUP_PATH}/${id}`), backup);
  return { id, timestamp, type, createdBy, summary: backup.summary };
}

export async function createBackupFromCurrent(type: BackupType, createdBy?: string): Promise<BackupListItem> {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase не е конфигуриран.");

  const snapshot = await get(ref(services.db, DB_PATH));
  const raw = snapshot.exists() ? snapshot.val() : {};
  const legacy = pickKnownPaths(raw as LegacyData & { settings?: unknown });
  const timestamp = new Date().toISOString();
  const backup: HotelBackup = {
    version: 1,
    timestamp,
    type,
    createdBy,
    summary: summarizeLegacy(legacy),
    data: legacy
  };
  const id = backupId(timestamp, type);
  await set(ref(services.db, `${BACKUP_PATH}/${id}`), backup);
  return { id, timestamp, type, createdBy, summary: backup.summary };
}

export async function createDailyBackupIfNeeded(data: AppData, createdBy?: string): Promise<BackupListItem | null> {
  const today = new Date().toISOString().slice(0, 10);
  const backups = await listBackups();
  const exists = backups.some((backup) => backup.type === "daily" && backup.timestamp.slice(0, 10) === today);
  if (exists) return null;
  return createBackup(data, "daily", createdBy);
}

export async function listBackups(): Promise<BackupListItem[]> {
  const services = getFirebaseServices();
  if (!services) return [];

  const snapshot = await get(ref(services.db, BACKUP_PATH));
  if (!snapshot.exists()) return [];

  return Object.entries(snapshot.val() as Record<string, unknown>)
    .map(([id, value]) => toBackupListItem(id, value))
    .filter((item): item is BackupListItem => Boolean(item))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function restoreBackup(id: string, createdBy?: string): Promise<AppData> {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase не е конфигуриран.");

  const snapshot = await get(ref(services.db, `${BACKUP_PATH}/${id}`));
  if (!snapshot.exists()) throw new Error("Backup не е намерен.");

  const backup = normalizeBackup(snapshot.val());
  validateBackup(backup);
  await createBackupFromCurrent("before-restore", createdBy);
  const data = pickKnownPaths(backup.data);
  await Promise.all([
    set(ref(services.db, `${DB_PATH}/reservationMasters`), data.reservationMasters || {}),
    set(ref(services.db, `${DB_PATH}/reservations`), data.reservations || { villa: {}, house: {} }),
    set(ref(services.db, `${DB_PATH}/finances`), data.finances || { incomes: {}, expenses: {} }),
    data.settings !== undefined ? set(ref(services.db, `${DB_PATH}/settings`), data.settings) : Promise.resolve()
  ]);

  const restored = normalizeImportedData(data);
  cacheData(restored);
  return restored;
}

export function validateBackup(value: unknown): asserts value is HotelBackup {
  const backup = normalizeBackup(value);
  if (!backup.data || typeof backup.data !== "object") throw new Error("Невалиден backup.");
  const data = backup.data;
  if (!data.reservationMasters && !data.reservations && !data.finances) throw new Error("Backup-ът не съдържа данни за възстановяване.");
  normalizeImportedData(data);
}

function normalizeBackup(value: unknown): HotelBackup {
  const raw = (value || {}) as Partial<HotelBackup> & { ts?: string; data?: LegacyData };
  const data = pickKnownPaths((raw.data || raw) as LegacyData & { settings?: unknown });
  return {
    version: 1,
    timestamp: raw.timestamp || raw.ts || new Date().toISOString(),
    type: (raw.type as BackupType) || "auto-save",
    createdBy: raw.createdBy,
    summary: raw.summary || summarizeLegacy(data),
    data
  };
}

function toBackupListItem(id: string, value: unknown): BackupListItem | null {
  try {
    const backup = normalizeBackup(value);
    return {
      id,
      timestamp: backup.timestamp,
      type: backup.type || "legacy",
      createdBy: backup.createdBy,
      summary: backup.summary
    };
  } catch {
    return null;
  }
}

function summarizeLegacy(data: LegacyData): BackupSummary {
  const appData = normalizeImportedData(data);
  const incomeRecordsCount = Object.keys(appData.manualIncomes).length;
  const expenseRecordsCount = Object.keys(appData.expenses).length;
  return {
    reservationsCount: Object.keys(appData.reservations).length,
    financeRecordsCount: incomeRecordsCount + expenseRecordsCount,
    incomeRecordsCount,
    expenseRecordsCount,
    sizeBytes: new Blob([JSON.stringify(data)]).size
  };
}

function pickKnownPaths(data: LegacyData & { settings?: unknown }): LegacyData & { settings?: unknown } {
  return {
    reservationMasters: data.reservationMasters || {},
    reservations: data.reservations || { villa: {}, house: {} },
    finances: data.finances || { incomes: {}, expenses: {} },
    ...(data.settings ? { settings: data.settings } : {})
  };
}

function backupId(timestamp: string, type: BackupType): string {
  return `${timestamp.replace(/[:.]/g, "-")}_${type}`;
}
