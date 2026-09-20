"use client";

import { getCurrentIdToken } from "@/lib/firebase/auth";

const VAPID_PUBLIC_KEY = "BNGJsA8vUTtJGSEyZ-MxVLN-cMkcThCduFEJ6RxGHhqe6LA25icMtxQocWNdAxJQdG7sRe4xPUJ_inh_F9xwvss";

export type PushSetupState =
  | NotificationPermission
  | "unsupported"
  | "needs_install"
  | "setup_error";

export async function enablePersistentPushNotifications(): Promise<PushSetupState> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  if (isIos && !isStandalone) {
    return "needs_install";
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") return permission;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource
      });
    }

    const idToken = await getCurrentIdToken();
    if (!idToken) return "setup_error";

    const response = await fetch("/api/push-subscription", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-firebase-id-token": idToken
      },
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });

    return response.ok ? "granted" : "setup_error";
  } catch (error) {
    console.warn("Push notification setup failed.", error);
    return "setup_error";
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
