import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hotel Lidia",
  description: "Управление на резервации и финанси за Hotel Lidia",
  manifest: "/manifest.json",
  applicationName: "Hotel Lidia",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: "/apple-touch-icon.png"
  },
  appleWebApp: {
    capable: true,
    title: "Hotel Lidia",
    statusBarStyle: "default"
  },
  formatDetection: {
    telephone: true
  }
};

export const viewport: Viewport = {
  themeColor: "#2f855f",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bg">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            if (typeof window !== "undefined" && typeof window.fetch !== "function") {
              document.documentElement.setAttribute("data-fetch-polyfill", "ran");
              window.fetch = function(input, init) {
                return new Promise(function(resolve, reject) {
                  var xhr = new XMLHttpRequest();
                  var method = (init && init.method) || "GET";
                  var url = typeof input === "string" ? input : input.url;
                  xhr.open(method, url, true);
                  if (init && init.headers) {
                    Object.keys(init.headers).forEach(function(key) {
                      xhr.setRequestHeader(key, init.headers[key]);
                    });
                  }
                  xhr.onload = function() {
                    var headers = {};
                    xhr.getAllResponseHeaders().trim().split(/[\\r\\n]+/).forEach(function(line) {
                      var parts = line.split(": ");
                      var header = parts.shift();
                      if (header) headers[header.toLowerCase()] = parts.join(": ");
                    });
                    resolve({
                      ok: xhr.status >= 200 && xhr.status < 300,
                      status: xhr.status,
                      statusText: xhr.statusText,
                      url: xhr.responseURL,
                      headers: { get: function(name) { return headers[String(name).toLowerCase()] || null; } },
                      text: function() { return Promise.resolve(xhr.responseText || ""); },
                      json: function() { return this.text().then(JSON.parse); },
                      arrayBuffer: function() {
                        var text = xhr.responseText || "";
                        var bytes = new Uint8Array(text.length);
                        for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
                        return Promise.resolve(bytes.buffer);
                      }
                    });
                  };
                  xhr.onerror = reject;
                  xhr.send(init && init.body ? init.body : null);
                });
              };
            }
          `
          }}
        />
      </head>
      <body>{children}<script dangerouslySetInnerHTML={{ __html: `
        setTimeout(function () {
          if (document.documentElement.dataset.appMounted === "true") return;
          var box = document.createElement("section");
          box.id = "startup-recovery";
          box.setAttribute("role", "alert");
          box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#f6f1e7;color:#234b3a;padding:32px;font:18px system-ui;overflow:auto";
          box.innerHTML = '<h1>Hotel Lidia</h1><p>Началният екран е получен, но приложението не успя да стартира.</p><p><a href="/connection-check.html">Провери връзката и възстанови отварянето</a></p><p>Резервациите не са променени.</p>';
          document.body.appendChild(box);
        }, 20000);
      ` }} /></body>
    </html>
  );
}
