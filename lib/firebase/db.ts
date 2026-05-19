"use client";

import { get, ref, set } from "firebase/database";
import { createEmptyData, type AppData } from "@/domain/reservations/types";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";
import { getFirebaseDatabaseUrl, getFirebaseServices } from "./client";

export const DB_PATH = "lydia_hotel_v1";
export const BACKUP_PATH = "lydia_hotel_v1_backups";
export const LOCAL_CACHE_KEY = "lidia_hotel_cache_v1";

export async function loadHotelData(): Promise<{ data: AppData; source: "cloud" | "local" | "empty" }> {
  try {
    const legacy = await loadLegacyWithRest();
    if (legacy) {
      const data = normalizeImportedData(legacy);
      cacheData(data);
      return { data, source: "cloud" };
    }
  } catch (error) {
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
    } catch (error) {
      console.warn("Firebase load failed, trying local cache.", error);
    }
  }

  const cached = readCachedData();
  if (cached) return { data: cached, source: "local" };
  return { data: createEmptyData(), source: "empty" };
}

export async function saveHotelData(data: AppData): Promise<"cloud" | "local"> {
  const normalized = normalizeImportedData(data);
  const services = getFirebaseServices();
  cacheData(normalized);

  if (!services) return "local";

  try {
    const now = new Date().toISOString();
    const legacySnapshot = v2ToLegacy(normalized);
    await Promise.all([
      set(ref(services.db, DB_PATH), legacySnapshot),
      set(ref(services.db, `${BACKUP_PATH}/${now.replace(/[:.]/g, "-")}`), { ts: now, data: legacySnapshot })
    ]);
    return "cloud";
  } catch (error) {
    console.warn("Firebase save failed, data is cached locally.", error);
    return "local";
  }
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
  const response = await withTimeout(
    window.fetch(`${databaseUrl}/${DB_PATH}.json`, { cache: "no-store" }),
    12000
  );
  if (!response.ok) throw new Error(`Firebase REST load failed: ${response.status}`);
  return response.json();
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
