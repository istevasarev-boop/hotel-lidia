"use client";

import { get, ref, remove, set } from "firebase/database";
import { createEmptyData, type AppData } from "@/domain/reservations/types";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";
import { deleteReservationById } from "@/domain/reservations/store";
import { getFirebaseDatabaseUrl, getFirebaseServices } from "./client";

export const DB_PATH = "lydia_hotel_v1";
export const BACKUP_PATH = "lydia_hotel_v1_backups";
export const BACKUP_INDEX_PATH = "lydia_hotel_v1_backup_index";
export const LOCAL_CACHE_KEY = "lidia_hotel_cache_v1";
const AUTO_SAVE_RETENTION_COUNT = 30;
const DAILY_RETENTION_DAYS = 90;

export class FirebaseDataError extends Error {
  constructor(
    message: string,
    public readonly kind: "permission-denied" | "cloud-unavailable" | "write-failed"
  ) {
    super(message);
    this.name = "FirebaseDataError";
  }
}

export function isFirebaseDataError(error: unknown, kind?: FirebaseDataError["kind"]): error is FirebaseDataError {
  return error instanceof FirebaseDataError && (!kind || error.kind === kind);
}

export async function loadHotelData(): Promise<{ data: AppData; source: "cloud" | "local" | "empty" }> {
  try {
    const legacy = await loadLegacyWithRest();
    if (legacy) {
      const data = normalizeImportedData(legacy);
      cacheData(data);
      return { data, source: "cloud" };
    }
  } catch (error) {
    if (isPermissionError(error)) {
      throw new FirebaseDataError("Нямаме достъп до Firebase данните. Влезте отново.", "permission-denied");
    }
    console.warn("Firebase REST load failed, trying SDK/local cache.", error);
  }

  const services = getFirebaseServices();

  if (services) {
    try {
      const current = await withTimeout(get(ref(services.db, DB_PATH)), 12000);
      if (current.exists()) {
        const data = normalizeImportedData(current.val());
        cacheData(data);
        return { data, source: "cloud" };
      }
      return { data: createEmptyData(), source: "empty" };
    } catch (error) {
      if (isPermissionError(error)) {
        throw new FirebaseDataError("Нямаме достъп до Firebase данните. Влезте отново.", "permission-denied");
      }
      console.warn("Firebase load failed, trying local cache.", error);
    }
  }

  const cached = readCachedData();
  if (cached) return { data: cached, source: "local" };
  if (services || getFirebaseDatabaseUrl()) {
    throw new FirebaseDataError("Firebase не върна данни и няма локален backup.", "cloud-unavailable");
  }
  return { data: createEmptyData(), source: "empty" };
}

export async function saveHotelData(data: AppData): Promise<"cloud" | "local"> {
  const normalized = normalizeImportedData(data);

  if (!getFirebaseServices() && !getFirebaseDatabaseUrl()) {
    cacheData(normalized);
    return "local";
  }

  try {
    const now = new Date().toISOString();
    const legacySnapshot = v2ToLegacy(normalized);
    await saveLegacySnapshot(legacySnapshot);
    await writeAutoSaveBackup(legacySnapshot, now);
    cacheData(normalized);
    return "cloud";
  } catch (error) {
    console.warn("Firebase save failed; UI state was not treated as cloud truth.", error);
    throw new FirebaseDataError("Записът във Firebase не беше успешен.", isPermissionError(error) ? "permission-denied" : "write-failed");
  }
}

export type DeleteHotelReservationResult = {
  data: AppData;
  target: "cloud" | "local";
  verified: boolean;
  warnings: string[];
};

export async function deleteHotelReservation(data: AppData, reservationId: string): Promise<DeleteHotelReservationResult> {
  const nextData = deleteReservationById(normalizeImportedData(data), reservationId);

  if (!getFirebaseServices() && !getFirebaseDatabaseUrl()) {
    cacheData(nextData);
    return { data: nextData, target: "local", verified: false, warnings: ["Firebase is not configured."] };
  }

  const now = new Date().toISOString();
  const legacySnapshot = v2ToLegacy(nextData);
  await saveLegacySnapshot(legacySnapshot);

  const warnings: string[] = [];
  try {
    await writeAutoSaveBackup(legacySnapshot, now);
  } catch (error) {
    const message = toErrorMessage(error);
    warnings.push(`Auto-save backup failed: ${message}`);
    console.warn("Auto-save backup failed after reservation delete.", error);
  }

  const verification = await verifyReservationDeleted(reservationId);
  if (verification.status === "still-exists") {
    throw new Error(`Reservation ${reservationId} still exists after canonical delete.`);
  }
  if (verification.status === "unavailable") {
    warnings.push(`Delete verification unavailable: ${verification.message}`);
    console.warn("Reservation delete verification unavailable after canonical save.", verification.message);
  }

  cacheData(nextData);
  return { data: nextData, target: "cloud", verified: verification.status === "confirmed", warnings };
}

export function cacheData(data: AppData): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
}

export function readCachedData(): AppData | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
  if (!raw) return null;

  try {
    return normalizeImportedData(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function loadLegacyWithRest(): Promise<unknown | null> {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return null;
  const databaseUrl = getFirebaseDatabaseUrl();
  if (!databaseUrl) return null;
  const authToken = await getClientAuthToken();
  const response = await withTimeout(
    window.fetch(firebaseRestUrl(databaseUrl, DB_PATH, authToken), { cache: "no-store" }),
    12000
  );
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new FirebaseDataError(`Firebase REST load denied: ${response.status}`, "permission-denied");
  }
  if (!response.ok) throw new FirebaseDataError(`Firebase REST load failed: ${response.status}`, "cloud-unavailable");
  return response.json();
}

async function saveLegacySnapshot(legacySnapshot: unknown): Promise<void> {
  const services = getFirebaseServices();
  const databaseUrl = getFirebaseDatabaseUrl();
  let sdkError: unknown = null;

  if (services) {
    try {
      await set(ref(services.db, DB_PATH), legacySnapshot);
      return;
    } catch (error) {
      sdkError = error;
      console.warn("Firebase SDK save failed, trying REST save.", error);
    }
  }

  if (!databaseUrl) throw sdkError || new Error("Firebase database URL is not configured.");
  const authToken = await getClientAuthToken();
  const response = await withTimeout(
    window.fetch(firebaseRestUrl(databaseUrl, DB_PATH, authToken), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(legacySnapshot),
      cache: "no-store"
    }),
    12000
  );
  if (response.status === 401 || response.status === 403) {
    throw new FirebaseDataError(`Firebase REST save denied: ${response.status}`, "permission-denied");
  }
  if (!response.ok) throw new FirebaseDataError(`Firebase REST save failed: ${response.status}`, "write-failed");
}

async function writeAutoSaveBackup(legacySnapshot: unknown, timestamp: string): Promise<void> {
  const services = getFirebaseServices();
  const id = `${timestamp.replace(/[:.]/g, "-")}_auto-save`;
  const sizeBytes = byteLength(legacySnapshot);
  const backup = {
    version: 1,
    timestamp,
    type: "auto-save",
    summary: {
      reservationsCount: countObjectKeys((legacySnapshot as { reservationMasters?: unknown })?.reservationMasters),
      financeRecordsCount:
        countObjectKeys((legacySnapshot as { finances?: { incomes?: unknown } })?.finances?.incomes) +
        countObjectKeys((legacySnapshot as { finances?: { expenses?: unknown } })?.finances?.expenses),
      incomeRecordsCount: countObjectKeys((legacySnapshot as { finances?: { incomes?: unknown } })?.finances?.incomes),
      expenseRecordsCount: countObjectKeys((legacySnapshot as { finances?: { expenses?: unknown } })?.finances?.expenses),
      sizeBytes
    },
    data: legacySnapshot
  };
  const indexEntry = {
    id,
    timestamp,
    type: "auto-save",
    sizeBytes,
    createdAt: timestamp,
    summary: backup.summary
  };

  try {
    if (services) {
      await Promise.all([
        set(ref(services.db, `${BACKUP_PATH}/${id}`), backup),
        set(ref(services.db, `${BACKUP_INDEX_PATH}/${id}`), indexEntry)
      ]);
      await applyIndexedBackupRetention();
      return;
    }
    const databaseUrl = getFirebaseDatabaseUrl();
    if (!databaseUrl) return;
    const authToken = await getClientAuthToken();
    await withTimeout(
      window.fetch(firebaseRestUrl(databaseUrl, `${BACKUP_PATH}/${id}`, authToken), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(backup),
        cache: "no-store"
      }),
      12000
    );
    await withTimeout(
      window.fetch(firebaseRestUrl(databaseUrl, `${BACKUP_INDEX_PATH}/${id}`, authToken), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(indexEntry),
        cache: "no-store"
      }),
      12000
    );
    await applyIndexedBackupRetention();
  } catch (error) {
    console.warn("Auto-save backup failed.", error);
  }
}

async function applyIndexedBackupRetention(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) return;

  const snapshot = await get(ref(services.db, BACKUP_INDEX_PATH));
  const entries = Object.entries((snapshot.val() || {}) as Record<string, { timestamp?: string; type?: string }>)
    .map(([id, value]) => ({ id, timestamp: value.timestamp || timestampFromBackupId(id), type: value.type || typeFromBackupId(id) }))
    .filter((entry) => entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)));

  const autoSavesToDelete = entries
    .filter((entry) => entry.type === "auto-save")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(AUTO_SAVE_RETENTION_COUNT);

  const dailyCutoff = Date.now() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dailyToDelete = entries.filter((entry) => entry.type === "daily" && Date.parse(entry.timestamp) < dailyCutoff);

  await Promise.all([...autoSavesToDelete, ...dailyToDelete].map((entry) => Promise.all([
    remove(ref(services.db, `${BACKUP_PATH}/${entry.id}`)),
    remove(ref(services.db, `${BACKUP_INDEX_PATH}/${entry.id}`))
  ])));
}

async function verifyReservationDeleted(reservationId: string): Promise<{ status: "confirmed" | "still-exists" | "unavailable"; message?: string }> {
  try {
    const services = getFirebaseServices();
    if (services) {
      const current = await withTimeout(get(ref(services.db, DB_PATH)), 12000);
      const latest = normalizeImportedData(current.exists() ? current.val() : {});
      return latest.reservations[reservationId] ? { status: "still-exists" } : { status: "confirmed" };
    }

    const raw = await loadLegacyWithRest();
    if (!raw) return { status: "unavailable", message: "No Firebase data was returned." };
    const latest = normalizeImportedData(raw);
    return latest.reservations[reservationId] ? { status: "still-exists" } : { status: "confirmed" };
  } catch (error) {
    return { status: "unavailable", message: toErrorMessage(error) };
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

function isPermissionError(error: unknown): boolean {
  if (isFirebaseDataError(error, "permission-denied")) return true;
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = toErrorMessage(error);
  return code.includes("permission") || /permission|denied|PERMISSION_DENIED|401|403/i.test(message);
}

async function getClientAuthToken(): Promise<string | undefined> {
  const user = getFirebaseServices()?.auth.currentUser;
  if (!user) return undefined;
  return user.getIdToken();
}

function firebaseRestUrl(databaseUrl: string, path: string, authToken?: string): string {
  const url = new URL(`${databaseUrl}/${path}.json`);
  if (authToken) url.searchParams.set("auth", authToken);
  return url.toString();
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function byteLength(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

function timestampFromBackupId(id: string): string {
  const match = id.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/);
  if (match) return `${match[1]}:${match[2]}:${match[3]}.${match[4]}`;
  const dateOnly = id.match(/^(\d{4})(\d{2})(\d{2})$/);
  return dateOnly ? `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z` : "";
}

function typeFromBackupId(id: string): string {
  if (id.endsWith("_auto-save")) return "auto-save";
  if (id.endsWith("_daily")) return "daily";
  if (id.endsWith("_manual")) return "manual";
  if (id.endsWith("_before-delete")) return "before-delete";
  if (id.endsWith("_before-import")) return "before-import";
  if (id.endsWith("_before-restore")) return "before-restore";
  return "legacy";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Firebase request timed out.")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
