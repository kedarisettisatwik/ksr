const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");

initializeApp();

const db = getFirestore();
const ADMIN_URL = "https://kedarisettisatwik.github.io/ksr/#/adminMode";

exports.notifyAdminOnNewOrder = onDocumentCreated(
  "Orders/{orderId}",
  async (event) => {
    const order = event.data?.data();
    if (!order) return;

    const subscriptions = await db.collection("AdminNotificationTokens").get();
    const tokenOwners = new Map();
    subscriptions.forEach((snapshot) => {
      const tokens = Array.isArray(snapshot.data().tokens)
        ? snapshot.data().tokens
        : [];
      tokens.forEach((token) => {
        if (!tokenOwners.has(token)) tokenOwners.set(token, []);
        tokenOwners.get(token).push(snapshot.ref);
      });
    });

    const tokens = [...tokenOwners.keys()];
    if (!tokens.length) {
      logger.info("No admin devices have enabled notifications.");
      return;
    }

    const messageData = {
      title: "New KSR order",
      body: `New order received${order.pickup_name ? ` from ${order.pickup_name}` : ""}`,
      orderId: String(event.params.orderId),
      url: ADMIN_URL,
    };
    const invalidTokensByDocument = new Map();

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const tokenBatch = tokens.slice(offset, offset + 500);
      const result = await getMessaging().sendEachForMulticast({
        tokens: tokenBatch,
        data: messageData,
        webpush: { headers: { Urgency: "high" } },
      });

      result.responses.forEach((response, index) => {
        const code = response.error?.code;
        if (
          response.success ||
          !["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(code)
        ) {
          return;
        }
        const token = tokenBatch[index];
        (tokenOwners.get(token) || []).forEach((reference) => {
          const key = reference.path;
          if (!invalidTokensByDocument.has(key)) {
            invalidTokensByDocument.set(key, { reference, tokens: [] });
          }
          invalidTokensByDocument.get(key).tokens.push(token);
        });
      });
    }

    await Promise.all(
      [...invalidTokensByDocument.values()].map(({ reference, tokens: invalid }) =>
        reference.update({ tokens: FieldValue.arrayRemove(...invalid) }),
      ),
    );
    logger.info("Sent new-order notification", {
      orderId: event.params.orderId,
      deviceCount: tokens.length,
    });
  },
);
