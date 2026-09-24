self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "BBK AUCTION", body: "มีการแจ้งเตือนใหม่" };
  }

  const title = typeof data.title === "string" ? data.title : "BBK AUCTION";
  const options = {
    body: typeof data.body === "string" ? data.body : "มีการแจ้งเตือนใหม่",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: typeof data.tag === "string" ? data.tag : "bbk-notification",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/account" },
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/account", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
