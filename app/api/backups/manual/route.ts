import { NextResponse, type NextRequest } from "next/server";
import { getFirebaseAdminAuth, getFirebaseAdminDatabase, hasFirebaseAdminConfig } from "@/lib/firebase/admin";
import type { LegacyData } from "@/domain/reservations/types";

const DB_PATH = "lydia_hotel_v1";
const BACKUP_PATH = "lydia_hotel_v1_backups";
const BACKUP_INDEX_PATH = "lydia_hotel_v1_backup_index";
const SESSION_COOKIE = "hotel_lidia_session";
const AUTO_SAVE_RETENTION_COUNT = 30;
const DAILY_RETENTION_DAYS = 90;

export const dynamic = "force-dynamic";

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
  type: "manual";
  createdBy?: string;
  summary: BackupSummary;
  data: LegacyData & { settings?: unknown };
};

type BackupIndexEntry = {
  id: string;
  timestamp: string;
  type: "manual" | "daily" | "auto-save" | "before-import" | "before-delete" | "before-restore" | "legacy";
  createdBy?: string;
  sizeBytes: number;
  createdAt: string;
  summary: BackupSummary;
};

export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Няма активна Firebase сесия." }, { status: 401 });
  }

  try {
    const userEmail = await verifySession(sessionToken);
    const currentData = await readCurrentData(sessionToken);
    const timestamp = new Date().toISOString();
    const id = `${timestamp.replace(/[:.]/g, "-")}_manual`;
    const backup: BackupRecord = {
      version: 1,
      timestamp,
      type: "manual",
      createdBy: userEmail,
      summary: summarizeLegacy(currentData),
      data: currentData
    };

    const warnings = await writeBackup(id, backup, sessionToken);
    const verified = await verifyBackupExists(id, sessionToken);
    if (!verified) {
      return NextResponse.json({ error: "Backup-ът не беше потвърден в облака." }, { status: 502 });
    }

    try {
      await applyIndexedBackupRetention(sessionToken);
    } catch (error) {
      warnings.push(toWarningMessage("Backup retention cleanup failed", error));
      console.warn("Manual backup retention cleanup failed; full backup exists.", error);
    }

    return NextResponse.json({
      backup: {
        id,
        timestamp,
        type: backup.type,
        createdBy: backup.createdBy,
        summary: backup.summary
      },
      warnings
    });
  } catch (error) {
    console.warn("Manual backup creation failed.", error);
    return NextResponse.json({ error: toPublicError(error) }, { status: errorStatus(error) });
  }
}

async function verifySession(sessionToken: string): Promise<string | undefined> {
  if (hasFirebaseAdminConfig()) {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(sessionToken);
    return decoded.email;
  }

  return undefined;
}

async function readCurrentData(sessionToken: string): Promise<LegacyData & { settings?: unknown }> {
  if (hasFirebaseAdminConfig()) {
    const snapshot = await getFirebaseAdminDatabase().ref(DB_PATH).get();
    return pickKnownPaths(snapshot.val());
  }

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(firebaseRestUrl(databaseUrl, DB_PATH, sessionToken), {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Firebase read failed: ${response.status}`);
  return pickKnownPaths(await response.json());
}

async function writeBackup(id: string, backup: BackupRecord, sessionToken: string): Promise<string[]> {
  const warnings: string[] = [];
  const indexEntry = toBackupIndexEntry(id, backup);
  if (hasFirebaseAdminConfig()) {
    await getFirebaseAdminDatabase().ref(`${BACKUP_PATH}/${id}`).set(backup);
    try {
      await getFirebaseAdminDatabase().ref(`${BACKUP_INDEX_PATH}/${id}`).set(indexEntry);
    } catch (error) {
      warnings.push(toWarningMessage("Backup index write failed", error));
      console.warn("Manual backup index write failed; full backup exists.", error);
    }
    return warnings;
  }

  const databaseUrl = getDatabaseUrl();
  const backupResponse = await fetch(firebaseRestUrl(databaseUrl, `${BACKUP_PATH}/${id}`, sessionToken), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup),
    signal: AbortSignal.timeout(15000)
  });
  if (!backupResponse.ok) throw new Error(`Backup write failed: ${backupResponse.status}`);

  try {
    const indexResponse = await fetch(firebaseRestUrl(databaseUrl, `${BACKUP_INDEX_PATH}/${id}`, sessionToken), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(indexEntry),
      signal: AbortSignal.timeout(15000)
    });
    if (!indexResponse.ok) throw new Error(`Backup index write failed: ${indexResponse.status}`);
  } catch (error) {
    warnings.push(toWarningMessage("Backup index write failed", error));
    console.warn("Manual backup index write failed; full backup exists.", error);
  }

  return warnings;
}

async function verifyBackupExists(id: string, sessionToken: string): Promise<boolean> {
  if (hasFirebaseAdminConfig()) {
    const snapshot = await getFirebaseAdminDatabase().ref(`${BACKUP_PATH}/${id}`).get();
    return snapshot.exists();
  }

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(firebaseRestUrl(databaseUrl, `${BACKUP_PATH}/${id}`, sessionToken), {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return false;
  return Boolean(await response.json());
}

async function applyIndexedBackupRetention(sessionToken: string): Promise<void> {
  const entries = await readBackupIndex(sessionToken);
  const autoSavesToDelete = entries
    .filter((entry) => entry.type === "auto-save")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(AUTO_SAVE_RETENTION_COUNT);

  const dailyCutoff = Date.now() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dailyToDelete = entries.filter((entry) => entry.type === "daily" && Date.parse(entry.timestamp) < dailyCutoff);

  await Promise.all([...autoSavesToDelete, ...dailyToDelete].map((entry) => deleteIndexedBackup(entry.id, sessionToken)));
}

async function readBackupIndex(sessionToken: string): Promise<Array<{ id: string; timestamp: string; type: string }>> {
  if (hasFirebaseAdminConfig()) {
    const snapshot = await getFirebaseAdminDatabase().ref(BACKUP_INDEX_PATH).get();
    return Object.entries((snapshot.val() || {}) as Record<string, { timestamp?: string; type?: string }>)
      .map(([id, value]) => ({ id, timestamp: value.timestamp || "", type: value.type || "" }))
      .filter((entry) => entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)));
  }

  const databaseUrl = getDatabaseUrl();
  const response = await fetch(firebaseRestUrl(databaseUrl, BACKUP_INDEX_PATH, sessionToken), {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return [];
  const index = ((await response.json()) || {}) as Record<string, { timestamp?: string; type?: string }>;
  return Object.entries(index)
    .map(([id, value]) => ({ id, timestamp: value.timestamp || "", type: value.type || "" }))
    .filter((entry) => entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)));
}

async function deleteIndexedBackup(id: string, sessionToken: string): Promise<void> {
  if (hasFirebaseAdminConfig()) {
    await Promise.all([
      getFirebaseAdminDatabase().ref(`${BACKUP_PATH}/${id}`).remove(),
      getFirebaseAdminDatabase().ref(`${BACKUP_INDEX_PATH}/${id}`).remove()
    ]);
    return;
  }

  const databaseUrl = getDatabaseUrl();
  await Promise.all([
    fetch(firebaseRestUrl(databaseUrl, `${BACKUP_PATH}/${id}`, sessionToken), { method: "DELETE", signal: AbortSignal.timeout(15000) }),
    fetch(firebaseRestUrl(databaseUrl, `${BACKUP_INDEX_PATH}/${id}`, sessionToken), { method: "DELETE", signal: AbortSignal.timeout(15000) })
  ]);
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("Firebase database URL is not configured.");
  return databaseUrl;
}

function firebaseRestUrl(databaseUrl: string, path: string, authToken?: string): string {
  const url = new URL(`${databaseUrl}/${path}.json`);
  if (authToken) url.searchParams.set("auth", authToken);
  return url.toString();
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

function toPublicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/401|403|permission|denied|auth/i.test(message)) {
    return "Нямаш достъп до Firebase. Влез отново и пробвай пак.";
  }
  if (/timeout|network|fetch/i.test(message)) {
    return "Няма връзка с облака. Пробвай пак.";
  }
  return "Backup-ът не беше създаден.";
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/401|403|permission|denied|auth/i.test(message)) return 401;
  return 500;
}

function toWarningMessage(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  return `${prefix}: ${message}`;
}
