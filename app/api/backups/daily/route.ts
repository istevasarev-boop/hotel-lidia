import { NextResponse, type NextRequest } from "next/server";
import { getFirebaseAdminDatabase, hasFirebaseAdminConfig } from "@/lib/firebase/admin";
import type { LegacyData } from "@/domain/reservations/types";

const DB_PATH = "lydia_hotel_v1";
const BACKUP_PATH = "lydia_hotel_v1_backups";
const BACKUP_INDEX_PATH = "lydia_hotel_v1_backup_index";
const DAILY_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_SAVE_RETENTION_COUNT = 30;
const DAILY_RETENTION_DAYS = 90;

export const dynamic = "force-dynamic";

type BackupType = "daily";

type BackupSummary = {
  reservationsCount: number;
  financeRecordsCount: number;
  incomeRecordsCount: number;
  expenseRecordsCount: number;
  sizeBytes: number;
};

type BackupRecord = {
  version: 1;
  timestamp: string;
  type: BackupType;
  createdBy: string;
  summary: BackupSummary;
  data: LegacyData & { settings?: unknown };
};

type BackupIndexEntry = {
  id: string;
  timestamp: string;
  type: BackupType | "manual" | "auto-save" | "before-import" | "before-delete" | "before-restore" | "legacy";
  createdBy?: string;
  sizeBytes: number;
  createdAt: string;
  summary: BackupSummary;
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const latestDaily = await getLatestDailyBackup();
  const now = new Date();

  if (latestDaily && now.getTime() - Date.parse(latestDaily.timestamp) < DAILY_BACKUP_INTERVAL_MS) {
    return NextResponse.json({
      created: false,
      latestDaily
    });
  }

  const currentData = await readCurrentData();
  const timestamp = now.toISOString();
  const id = `${timestamp.replace(/[:.]/g, "-")}_daily`;
  const backup: BackupRecord = {
    version: 1,
    timestamp,
    type: "daily",
    createdBy: "vercel-cron",
    summary: summarizeLegacy(currentData),
    data: currentData
  };

  await writeBackup(id, backup);
  await applyIndexedBackupRetentionBestEffort();

  return NextResponse.json({
    created: true,
    backup: {
      id,
      timestamp,
      summary: backup.summary
    }
  });
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function readCurrentData(): Promise<LegacyData & { settings?: unknown }> {
  if (hasFirebaseAdminConfig()) {
    const snapshot = await getFirebaseAdminDatabase().ref(DB_PATH).get();
    return pickKnownPaths(snapshot.val());
  }

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(`${databaseUrl}/${DB_PATH}.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Firebase read failed: ${response.status}`);
  return pickKnownPaths(await response.json());
}

async function writeBackup(id: string, backup: BackupRecord): Promise<void> {
  const indexEntry = toBackupIndexEntry(id, backup);
  if (hasFirebaseAdminConfig()) {
    await getFirebaseAdminDatabase().ref(`${BACKUP_PATH}/${id}`).set(backup);
    await writeBackupIndexBestEffort(id, indexEntry);
    return;
  }

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(`${databaseUrl}/${BACKUP_PATH}/${id}.json`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Backup write failed: ${response.status}`);
  }
  await writeBackupIndexBestEffort(id, indexEntry);
}

async function writeBackupIndexBestEffort(id: string, indexEntry: BackupIndexEntry): Promise<void> {
  try {
    if (hasFirebaseAdminConfig()) {
      await getFirebaseAdminDatabase().ref(`${BACKUP_INDEX_PATH}/${id}`).set(indexEntry);
      return;
    }
    const databaseUrl = getDatabaseUrl();
    const response = await fetch(`${databaseUrl}/${BACKUP_INDEX_PATH}/${id}.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(indexEntry),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Backup index write failed: ${response.status}`);
  } catch (error) {
    console.warn("Daily backup index write failed; full backup exists.", error);
  }
}

async function getLatestDailyBackup(): Promise<{ id: string; timestamp: string } | null> {
  const indexed = await readBackupIndex();
  const indexedDaily = indexed
    .filter((backup) => backup.type === "daily")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  if (indexedDaily) return indexedDaily;

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(`${databaseUrl}/${BACKUP_PATH}.json?shallow=true`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return null;

  const keys = Object.keys((await response.json()) || {})
    .filter((key) => key.endsWith("_daily"))
    .sort()
    .reverse();

  const key = keys.find((item) => Number.isFinite(Date.parse(timestampFromBackupId(item))));
  if (key) return { id: key, timestamp: timestampFromBackupId(key) };

  return null;
}

async function readBackupIndex(): Promise<Array<{ id: string; timestamp: string; type: string }>> {
  if (hasFirebaseAdminConfig()) {
    const snapshot = await getFirebaseAdminDatabase().ref(BACKUP_INDEX_PATH).get();
    return Object.entries((snapshot.val() || {}) as Record<string, { timestamp?: string; type?: string }>)
      .map(([id, value]) => ({ id, timestamp: value.timestamp || "", type: value.type || "" }))
      .filter((entry) => entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)));
  }

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(`${databaseUrl}/${BACKUP_INDEX_PATH}.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return [];
  const index = ((await response.json()) || {}) as Record<string, { timestamp?: string; type?: string }>;
  return Object.entries(index)
    .map(([id, value]) => ({ id, timestamp: value.timestamp || "", type: value.type || "" }))
    .filter((entry) => entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)));
}

async function applyIndexedBackupRetention(): Promise<void> {
  const entries = await readBackupIndex();
  const autoSavesToDelete = entries
    .filter((entry) => entry.type === "auto-save")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(AUTO_SAVE_RETENTION_COUNT);

  const dailyCutoff = Date.now() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dailyToDelete = entries.filter((entry) => entry.type === "daily" && Date.parse(entry.timestamp) < dailyCutoff);

  await Promise.all([...autoSavesToDelete, ...dailyToDelete].map((entry) => deleteIndexedBackup(entry.id)));
}

async function applyIndexedBackupRetentionBestEffort(): Promise<void> {
  try {
    await applyIndexedBackupRetention();
  } catch (error) {
    console.warn("Daily backup retention cleanup failed; full backups are preserved.", error);
  }
}

async function deleteIndexedBackup(id: string): Promise<void> {
  if (hasFirebaseAdminConfig()) {
    await Promise.all([
      getFirebaseAdminDatabase().ref(`${BACKUP_PATH}/${id}`).remove(),
      getFirebaseAdminDatabase().ref(`${BACKUP_INDEX_PATH}/${id}`).remove()
    ]);
    return;
  }

  const databaseUrl = getDatabaseUrl();
  await Promise.all([
    fetch(`${databaseUrl}/${BACKUP_PATH}/${id}.json`, { method: "DELETE", signal: AbortSignal.timeout(15000) }),
    fetch(`${databaseUrl}/${BACKUP_INDEX_PATH}/${id}.json`, { method: "DELETE", signal: AbortSignal.timeout(15000) })
  ]);
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("Firebase database URL is not configured.");
  return databaseUrl;
}

function summarizeLegacy(data: LegacyData): BackupSummary {
  const reservationMasters = data.reservationMasters || {};
  const finances = data.finances || {};
  const incomes = finances.incomes || {};
  const expenses = finances.expenses || {};
  return {
    reservationsCount: Object.keys(reservationMasters).length,
    financeRecordsCount: Object.keys(incomes).length + Object.keys(expenses).length,
    incomeRecordsCount: Object.keys(incomes).length,
    expenseRecordsCount: Object.keys(expenses).length,
    sizeBytes: Buffer.byteLength(JSON.stringify(data), "utf8")
  };
}

function toBackupIndexEntry(id: string, backup: BackupRecord): BackupIndexEntry {
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

function timestampFromBackupId(id: string): string {
  const match = id.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/);
  if (match) return `${match[1]}:${match[2]}:${match[3]}.${match[4]}`;
  const dateOnly = id.match(/^(\d{4})(\d{2})(\d{2})$/);
  return dateOnly ? `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z` : "";
}

function pickKnownPaths(data: (LegacyData & { settings?: unknown }) | null): LegacyData & { settings?: unknown } {
  return {
    reservationMasters: data?.reservationMasters || {},
    reservations: data?.reservations || { villa: {}, house: {} },
    finances: data?.finances || { incomes: {}, expenses: {} },
    bookingOpenInventory: data?.bookingOpenInventory || {},
    bookingFeedTokens: data?.bookingFeedTokens || {},
    ...(data?.settings ? { settings: data.settings } : {})
  };
}
