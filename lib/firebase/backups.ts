"use client";

import { get, ref, remove, set } from "firebase/database";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";
import type { AppData, LegacyData } from "@/domain/reservations/types";
import { BACKUP_INDEX_PATH, BACKUP_PATH, DB_PATH, cacheData } from "./db";
import { getFirebaseDatabaseUrl, getFirebaseServices } from "./client";

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

type BackupIndexEntry = {
  id: string;
  timestamp: string;
  type: BackupType | "legacy";
  createdBy?: string;
  sizeBytes: number;
  createdAt: string;
  summary: BackupSummary;
};

export const DAILY_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_SAVE_RETENTION_COUNT = 30;
const DAILY_RETENTION_DAYS = 90;

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
  await writeBackupIndexBestEffort(id, backup);
  await applyIndexedBackupRetentionBestEffort();
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
  await writeBackupIndexBestEffort(id, backup);
  await applyIndexedBackupRetentionBestEffort();
  return { id, timestamp, type, createdBy, summary: backup.summary };
}

export async function createDailyBackupIfNeeded(data: AppData, createdBy?: string): Promise<BackupListItem | null> {
  const backups = await listBackups();
  if (!shouldCreateDailyBackup(backups, new Date())) return null;
  return createBackup(data, "daily", createdBy);
}

export function shouldCreateDailyBackup(backups: Pick<BackupListItem, "type" | "timestamp">[], now = new Date()): boolean {
  const latestDaily = backups
    .filter((backup) => backup.type === "daily")
    .map((backup) => Date.parse(backup.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((a, b) => b - a)[0];

  if (!latestDaily) return true;
  return now.getTime() - latestDaily >= DAILY_BACKUP_INTERVAL_MS;
}

export async function listBackups(): Promise<BackupListItem[]> {
  const services = getFirebaseServices();
  if (!services) return [];

  const indexed = await readBackupIndex();
  const legacyKeys = await readLegacyBackupKeys();
  const byId = new Map<string, BackupListItem>();

  for (const item of indexed) byId.set(item.id, item);
  for (const item of legacyKeys) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }

  return Array.from(byId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
    set(ref(services.db, `${DB_PATH}/bookingOpenInventory`), data.bookingOpenInventory || {}),
    set(ref(services.db, `${DB_PATH}/bookingFeedTokens`), data.bookingFeedTokens || {}),
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
  if (!data.reservationMasters && !data.reservations && !data.finances) {
    throw new Error("Backup-ът не съдържа данни за възстановяване.");
  }
  normalizeImportedData(data);
}

async function readBackupIndex(): Promise<BackupListItem[]> {
  const services = getFirebaseServices();
  if (!services) return [];

  const snapshot = await get(ref(services.db, BACKUP_INDEX_PATH));
  if (!snapshot.exists()) return [];

  return Object.entries(snapshot.val() as Record<string, unknown>)
    .map(([id, value]) => toBackupListItemFromIndex(id, value))
    .filter((item): item is BackupListItem => Boolean(item));
}

async function readLegacyBackupKeys(): Promise<BackupListItem[]> {
  const databaseUrl = getFirebaseDatabaseUrl();
  if (!databaseUrl) return [];
  const authToken = await getClientAuthToken();
  const response = await fetch(firebaseRestUrl(databaseUrl, BACKUP_PATH, authToken, { shallow: "true" }), { cache: "no-store" });
  if (!response.ok) return [];

  return Object.keys((await response.json()) || {})
    .map((id) => backupListItemFromId(id))
    .filter((item): item is BackupListItem => Boolean(item));
}

async function applyIndexedBackupRetention(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) return;

  const indexed = await readBackupIndex();
  const autoSavesToDelete = indexed
    .filter((backup) => backup.type === "auto-save")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(AUTO_SAVE_RETENTION_COUNT);

  const dailyCutoff = Date.now() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dailyToDelete = indexed.filter((backup) => backup.type === "daily" && Date.parse(backup.timestamp) < dailyCutoff);

  await Promise.all([...autoSavesToDelete, ...dailyToDelete].map((backup) => Promise.all([
    remove(ref(services.db, `${BACKUP_PATH}/${backup.id}`)),
    remove(ref(services.db, `${BACKUP_INDEX_PATH}/${backup.id}`))
  ])));
}

async function writeBackupIndexBestEffort(id: string, backup: HotelBackup): Promise<void> {
  const services = getFirebaseServices();
  if (!services) return;
  try {
    await set(ref(services.db, `${BACKUP_INDEX_PATH}/${id}`), toBackupIndexEntry(id, backup));
  } catch (error) {
    console.warn("Backup index write failed; full backup exists.", error);
  }
}

async function applyIndexedBackupRetentionBestEffort(): Promise<void> {
  try {
    await applyIndexedBackupRetention();
  } catch (error) {
    console.warn("Backup retention cleanup failed; full backups are preserved.", error);
  }
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

function toBackupListItemFromIndex(id: string, value: unknown): BackupListItem | null {
  const raw = (value || {}) as Partial<BackupIndexEntry>;
  const timestamp = raw.timestamp || timestampFromBackupId(id);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  const type = normalizeBackupType(raw.type) || typeFromBackupId(id);
  return {
    id: raw.id || id,
    timestamp,
    type,
    createdBy: raw.createdBy,
    summary: raw.summary || emptySummary(raw.sizeBytes || 0)
  };
}

function backupListItemFromId(id: string): BackupListItem | null {
  const timestamp = timestampFromBackupId(id);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return {
    id,
    timestamp,
    type: typeFromBackupId(id),
    summary: emptySummary(0)
  };
}

function toBackupIndexEntry(id: string, backup: HotelBackup): BackupIndexEntry {
  return {
    id,
    timestamp: backup.timestamp,
    type: backup.type,
    createdBy: backup.createdBy,
    sizeBytes: backup.summary.sizeBytes,
    createdAt: backup.timestamp,
    summary: backup.summary
  };
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

function emptySummary(sizeBytes: number): BackupSummary {
  return {
    reservationsCount: 0,
    financeRecordsCount: 0,
    incomeRecordsCount: 0,
    expenseRecordsCount: 0,
    sizeBytes
  };
}

function pickKnownPaths(data: LegacyData & { settings?: unknown }): LegacyData & { settings?: unknown } {
  return {
    reservationMasters: data.reservationMasters || {},
    reservations: data.reservations || { villa: {}, house: {} },
    finances: data.finances || { incomes: {}, expenses: {} },
    bookingOpenInventory: data.bookingOpenInventory || {},
    bookingFeedTokens: data.bookingFeedTokens || {},
    ...(data.settings ? { settings: data.settings } : {})
  };
}

function backupId(timestamp: string, type: BackupType): string {
  return `${timestamp.replace(/[:.]/g, "-")}_${type}`;
}

function timestampFromBackupId(id: string): string {
  const match = id.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/);
  if (match) return `${match[1]}:${match[2]}:${match[3]}.${match[4]}`;
  const dateOnly = id.match(/^(\d{4})(\d{2})(\d{2})$/);
  return dateOnly ? `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z` : "";
}

function typeFromBackupId(id: string): BackupType | "legacy" {
  if (id.endsWith("_auto-save")) return "auto-save";
  if (id.endsWith("_daily")) return "daily";
  if (id.endsWith("_manual")) return "manual";
  if (id.endsWith("_before-delete")) return "before-delete";
  if (id.endsWith("_before-import")) return "before-import";
  if (id.endsWith("_before-restore")) return "before-restore";
  return "legacy";
}

function normalizeBackupType(value: unknown): BackupType | "legacy" | null {
  return value === "manual" ||
    value === "daily" ||
    value === "before-import" ||
    value === "before-delete" ||
    value === "before-restore" ||
    value === "auto-save" ||
    value === "legacy"
    ? value
    : null;
}

async function getClientAuthToken(): Promise<string | undefined> {
  const user = getFirebaseServices()?.auth.currentUser;
  if (!user) return undefined;
  return user.getIdToken();
}

function firebaseRestUrl(databaseUrl: string, path: string, authToken?: string, params?: Record<string, string>): string {
  const url = new URL(`${databaseUrl}/${path}.json`);
  if (authToken) url.searchParams.set("auth", authToken);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}
