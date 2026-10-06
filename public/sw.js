/* Service worker: shows water-level pushes and keeps the subscription alive. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ระดับน้ำท่าน้ำนนท์", body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    tag: data.tag || "digest",
    renotify: data.tag === "alert",
    requireInteraction: Boolean(data.requireInteraction),
    // The camera picture doubles as the thumbnail, so the collapsed notification shows the river too.
    icon: data.image || "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    lang: "th",
    data: { url: data.url || "/" },
  };
  if (data.image) options.image = data.image;
  event.waitUntil(self.registration.showNotification(data.title || "ระดับน้ำท่าน้ำนนท์", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Browsers occasionally rotate a subscription; carry the old preferences over.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/api/push/key");
      if (!res.ok) return;
      const { key } = await res.json();
      const pad = "=".repeat((4 - (key.length % 4)) % 4);
      const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
      const applicationServerKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          previousEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : undefined,
        }),
      });
    })(),
  );
});
