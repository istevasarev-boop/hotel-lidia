import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hotel Lidia",
  description: "Управление на резервации и финанси за Hotel Lidia",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Hotel Lidia"
  }
};

export const viewport: Viewport = {
  themeColor: "#1f6fb2",
  width: "device-width",
  initialScale: 1
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
      <body>{children}</body>
    </html>
  );
}
