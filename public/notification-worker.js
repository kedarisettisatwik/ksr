const ADMIN_URL = "https://kedarisettisatwik.github.io/ksr/#/adminMode";

importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDZjdpzD539F01SQ1G4U_8R0gZNJg_eF-4",
  authDomain: "ksrshopping-c1f91.firebaseapp.com",
  projectId: "ksrshopping-c1f91",
  storageBucket: "ksrshopping-c1f91.firebasestorage.app",
  messagingSenderId: "1015561144281",
  appId: "1:1015561144281:web:76636fcb62ae02dcd87bc8",
});

firebase.messaging().onBackgroundMessage((payload) => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || "New KSR order", {
    body: data.body || "A new order was placed.",
    icon: "/ksr/favicon.ico",
    tag: data.orderId ? `ksr-order-${data.orderId}` : "ksr-new-order",
    data: { url: data.url || ADMIN_URL },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || ADMIN_URL;
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
        await adminWindow.navigate(targetUrl);
        return adminWindow.focus();
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
