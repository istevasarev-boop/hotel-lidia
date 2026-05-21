import { NextResponse, type NextRequest } from "next/server";
import type { LegacyData } from "@/domain/reservations/types";

const DB_PATH = "lydia_hotel_v1";
const BACKUP_PATH = "lydia_hotel_v1_backups";
const DAILY_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const databaseUrl = getDatabaseUrl();
  const latestDaily = await getLatestDailyBackup(databaseUrl);
  const now = new Date();

  if (latestDaily && now.getTime() - Date.parse(latestDaily.timestamp) < DAILY_BACKUP_INTERVAL_MS) {
    return NextResponse.json({
      created: false,
      latestDaily
    });
  }

  const currentData = await readCurrentData(databaseUrl);
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

  const response = await fetch(`${databaseUrl}/${BACKUP_PATH}/${id}.json`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    return NextResponse.json({ error: `Backup write failed: ${response.status}` }, { status: 500 });
  }

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

function getDatabaseUrl(): string {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseUrl) throw new Error("Firebase database URL is not configured.");
  return databaseUrl;
}

async function readCurrentData(databaseUrl: string): Promise<LegacyData & { settings?: unknown }> {
  const response = await fetch(`${databaseUrl}/${DB_PATH}.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Firebase read failed: ${response.status}`);
  return pickKnownPaths(await response.json());
}

async function getLatestDailyBackup(databaseUrl: string): Promise<{ id: string; timestamp: string } | null> {
  const response = await fetch(`${databaseUrl}/${BACKUP_PATH}.json?shallow=true`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return null;

  const keys = Object.keys((await response.json()) || {})
    .filter((key) => key.endsWith("_daily"))
    .sort()
    .reverse();

  for (const key of keys) {
    const backupResponse = await fetch(`${databaseUrl}/${BACKUP_PATH}/${encodeURIComponent(key)}.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    if (!backupResponse.ok) continue;
    const backup = (await backupResponse.json()) as Partial<BackupRecord>;
    if (backup.timestamp && Number.isFinite(Date.parse(backup.timestamp))) {
      return { id: key, timestamp: backup.timestamp };
    }
  }

  return null;
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
