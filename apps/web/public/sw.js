// Minimal offline shell: cache the app shell and static assets; never cache private looks or API calls.
// E38: Web Push (order progress, looks ready, circle votes, quotes, event reminders).
const CACHE = "nyambika-shell-v2";
const DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/icon.png", "/manifest.webmanifest"])).catch(() => undefined));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (DEV || e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.png") {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
  }
});

// Payload shape: apps/api/src/common/push/providers.ts → webPushPayload().
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "Nyambika", body: e.data ? e.data.text() : "" };
  }
  const steps = Array.isArray(d.steps) ? d.steps : null;
  // Order updates reuse one notification per order (tag), like a live ticker: only paid, on the
  // way and delivered re-alert; quieter steps replace the text silently.
  const progress = steps && typeof d.stepIndex === "number" && d.stepIndex >= 0
    ? "\n" + steps.map((s, i) => (i <= d.stepIndex ? "●" : "○") + " " + s).join("  ")
    : "";
  e.waitUntil(
    self.registration.showNotification(d.title || "Nyambika", {
      body: (d.body || "") + progress,
      icon: "/icon.png",
      badge: "/icon.png",
      tag: d.tag || undefined,
      renotify: Boolean(d.tag && d.renotify),
      silent: Boolean(d.silent),
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === target.origin && "focus" in w) {
          w.navigate(target.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

// The browser rotated the subscription: the next app open re-registers it (lib/push.ts syncPush).
self.addEventListener("pushsubscriptionchange", () => undefined);
