// firebase-init.js - Single initialization point
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7Q90torM2Hvjidd5A3K2R90btsgt-d94",
  authDomain: "padeluminatis.firebaseapp.com",
  projectId: "padeluminatis",
  storageBucket: "padeluminatis.appspot.com",
  messagingSenderId: "40241508403",
  appId: "1:40241508403:web:c4d3bbd19370dcf3173346",
  measurementId: "G-079Q6DEQCG",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// FCM Web Push (VAPID public key)
// Public key is safe to ship in client code.
const FCM_VAPID_PUBLIC_KEY = "BNtt-g94tWGb6LPZjBWS0fO9MixrnclGyMHcDClTx0isC3uA-Bg-mCoO-yCeNzRoNFwdjXJGqLHdeOpD6w7eGRo";
if (typeof window !== "undefined") {
  window.__FCM_VAPID_PUBLIC_KEY = FCM_VAPID_PUBLIC_KEY;
  try {
    localStorage.setItem("fcm_vapid_public_key", FCM_VAPID_PUBLIC_KEY);
  } catch (_) {}
}

export { app, auth, db, storage };

