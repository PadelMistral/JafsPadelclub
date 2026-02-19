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

// OneSignal Web Push (set your OneSignal App ID here once created)
const ONESIGNAL_APP_ID = "";
if (typeof window !== "undefined" && ONESIGNAL_APP_ID) {
  window.__ONESIGNAL_APP_ID = ONESIGNAL_APP_ID;
  try {
    localStorage.setItem("onesignal_app_id", ONESIGNAL_APP_ID);
  } catch (_) {}
}

export { app, auth, db, storage };

