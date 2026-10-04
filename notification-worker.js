const ADMIN_URL = "https://kedarisettisatwik.github.io/ksr/#/adminMode";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const adminWindow = windows.find((client) =>
        client.url.startsWith("https://kedarisettisatwik.github.io/ksr"),
      );
      if (adminWindow) {
        await adminWindow.navigate(ADMIN_URL);
        return adminWindow.focus();
      }
      return self.clients.openWindow(ADMIN_URL);
    })(),
  );
});
