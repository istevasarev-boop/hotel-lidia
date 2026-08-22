"use client";

import { onIdTokenChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirebaseServices } from "./client";

export function listenAuth(callback: (user: User | null) => void): () => void {
  const services = getFirebaseServices();
  if (!services) {
    callback(null);
    return () => undefined;
  }

  return onIdTokenChanged(services.auth, callback);
}

export async function loginWithEmail(email: string, password: string): Promise<void> {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase не е конфигуриран.");
  await signInWithEmailAndPassword(services.auth, email, password);
}

export async function logout(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) return;
  await signOut(services.auth);
}
