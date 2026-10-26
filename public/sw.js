const CACHE_NAME = "hotel-lidia-v6";


self.addEventListener("install", (event) => {
  // Push-only worker: installation must not depend on fetching any assets.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("hotel-lidia-") && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Ново запитване";
  const options = {
    body: payload.body || "Има ново запитване от vilalidia.bg",
    icon: "/icon-192.png",
    badge: "/favicon-32x32.png",
    tag: payload.tag || "hotel-lidia-enquiry",
    renotify: true,
    data: {
      url: payload.url || "/?tab=enquiries"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/?tab=enquiries";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Deliberately no fetch handler: browser owns navigation and network recovery.
