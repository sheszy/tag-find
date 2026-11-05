self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Tag & Find", {
    body: payload.body || "A nearby lost item may need your help.",
    icon: "/tag-find-icon.svg",
    badge: "/tag-find-icon.svg",
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
    const existing = windowClients.find(client => client.url === target);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
