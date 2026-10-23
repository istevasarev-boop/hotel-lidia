const CACHE_NAME = "hotel-lidia-v5";
const APP_ASSETS = ["/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
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

// Never cache authenticated HTML, API responses or Firebase requests.
const RECOVERY_HTML = `<!doctype html><html lang="bg"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotel Lidia · Повторен опит</title><style>body{font:18px system-ui;background:#f6f1e7;color:#234b3a;margin:0;display:grid;place-items:center;min-height:100vh}main{padding:28px;max-width:420px;text-align:center}a{display:inline-block;background:#234b3a;color:white;padding:14px 24px;border-radius:12px;text-decoration:none}</style><main><h1>Hotel Lidia</h1><p>Приложението не успя да се свърже. Проверете връзката и опитайте отново.</p><a href="">Опитай отново</a><p><small>Запазените резервации не са променени.</small></p></main></html>`;

async function loadNavigation(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.status >= 500) throw new Error("Server unavailable");
    return response;
  } catch {
    return new Response(RECOVERY_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET" && event.request.mode === "navigate") {
    event.respondWith(loadNavigation(event.request));
  }
});
