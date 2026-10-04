import { initializeApp } from 'firebase/app';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

export async function generateFcmToken() {
  if (!(await isSupported())) {
    throw new Error('Firebase messaging is not supported in this browser.');
  }
  const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error('FCM VAPID public key is not configured.');
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser does not support service workers.');
  }

  const workerUrl = new URL(
    `${process.env.PUBLIC_URL || ''}/notification-worker.js`,
    window.location.origin,
  );
  const registration = await navigator.serviceWorker.register(workerUrl.toString());
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('Firebase did not return an FCM token.');
  return token;
}

export async function listenForFcmMessages(callback) {
  if (!(await isSupported())) return () => {};
  return onMessage(getMessaging(app), callback);
}

export async function removeFcmToken() {
  if (!(await isSupported())) return false;
  return deleteToken(getMessaging(app));
}
