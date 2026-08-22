import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getDatabase, type Database } from "firebase-admin/database";

type ServiceAccountConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function hasFirebaseAdminConfig(): boolean {
  return Boolean(getServiceAccountConfig() && getAdminDatabaseUrl());
}

export function getFirebaseAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccount = getServiceAccountConfig();
  const databaseURL = getAdminDatabaseUrl();
  if (!serviceAccount || !databaseURL) {
    throw new Error("Firebase Admin is not configured.");
  }

  return initializeApp({
    credential: cert(serviceAccount),
    databaseURL
  });
}

export function getFirebaseAdminDatabase(): Database {
  return getDatabase(getFirebaseAdminApp());
}

export function getFirebaseAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

function getAdminDatabaseUrl(): string | undefined {
  return process.env.FIREBASE_ADMIN_DATABASE_URL || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
}

function getServiceAccountConfig(): ServiceAccountConfig | null {
  const jsonConfig = parseServiceAccountJson();
  if (jsonConfig) return jsonConfig;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function parseServiceAccountJson(): ServiceAccountConfig | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      projectId?: string;
      client_email?: string;
      clientEmail?: string;
      private_key?: string;
      privateKey?: string;
    };
    const projectId = parsed.project_id || parsed.projectId;
    const clientEmail = parsed.client_email || parsed.clientEmail;
    const privateKey = normalizePrivateKey(parsed.private_key || parsed.privateKey);
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

function normalizePrivateKey(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n");
}
