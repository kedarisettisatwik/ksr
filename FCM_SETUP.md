# Admin order push notifications

The React app stores each opted-in admin browser's FCM token in
`AdminNotificationTokens/{adminUid}`. The `notifyAdminOnNewOrder` Cloud Function
sends a data-only push when a new document is created in `Orders`; the existing
service worker displays it and opens the Admin Mode URL when clicked.

## One-time Firebase setup

1. Keep `REACT_APP_FIREBASE_VAPID_KEY` in the local `.env` file. It is the
   **public** Web Push key and is used to register browser devices. Do not put
   the private VAPID key in the website or Functions code. Since the private
   key was shared outside Firebase Console, regenerate the Web Push key pair
   and replace the public key in `.env` before enabling devices.
2. In the Firebase Console, enable Cloud Messaging and the FCM Registration API
   for project `ksrshopping-c1f91`.
3. Merge a rule like this into the existing Firestore rules for the token
   collection. Keep the rest of the app's existing rules intact:

   ```text
   match /AdminNotificationTokens/{adminUid} {
     allow read, create, update, delete:
       if request.auth != null && request.auth.uid == adminUid;
   }
   ```

4. Install and deploy the Cloud Function from the repository root:

   ```sh
   cd functions
   npm install
   cd ..
   firebase deploy --only functions:notifyAdminOnNewOrder
   ```

   Cloud Functions deployment requires the Firebase project to use the Blaze
   pay-as-you-go plan. Set billing budget alerts before deploying.

5. Rebuild and publish the React app so the VAPID key and FCM-aware service
   worker are included. On each admin phone, sign in to Admin Mode and tap
   **Enable notifications** once, then allow notifications in Chrome.

The Functions sender uses Firebase Admin credentials provided by Cloud
Functions; no service account or VAPID private key belongs in the client bundle.
