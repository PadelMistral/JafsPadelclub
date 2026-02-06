// firebase-service.js - Core Services (v6.0)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

// === FIREBASE CONFIG ===
const firebaseConfig = {
  apiKey: "AIzaSyA7Q90torM2Hvjidd5A3K2R90btsgt-d94",
  authDomain: "padeluminatis.firebaseapp.com",
  projectId: "padeluminatis",
  storageBucket: "padeluminatis.appspot.com",
  messagingSenderId: "40241508403",
  appId: "1:40241508403:web:c4d3bbd19370dcf3173346",
  measurementId: "G-079Q6DEQCG",
};

// Initialize App
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);

// Modern Firestore Cache initialization
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager(),
  }),
});

// Set default persistence
setPersistence(auth, browserLocalPersistence).catch(console.error);

// === FIREBASE EXPORTS ===
export { auth, db, app, storage, serverTimestamp };

export function observerAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Enhanced Login (Supports Email or Username)
 */
export async function login(identificador, password) {
  let email = identificador.trim();
  
  if (!email.includes("@")) {
    const q = query(
      collection(db, "usuarios"),
      where("nombreUsuario", "==", email)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      email = snap.docs[0].data().email;
    } else {
       throw { code: "auth/user-not-found" };
    }
  }
  return signInWithEmailAndPassword(auth, email, password);
}

export async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Ensure user document exists
    const userRef = doc(db, "usuarios", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
        const defaultLevel = 2.5;
        const basePoints = Math.round(1000 + (defaultLevel - 2.0) * 200);

        await setDoc(userRef, {
            nombre: user.displayName,
            email: user.email,
            fotoURL: user.photoURL,
            nivel: defaultLevel,
            puntosRanking: basePoints,
            victorias: 0,
            partidosJugados: 0,
            rachaActual: 0,
            rol: 'Usuario',
            fechaRegistro: serverTimestamp()
        });
    }
    return user;
}

export function logout() {
  return signOut(auth);
}

// === FIRESTORE EXPORTS ===
export async function getDocument(col, id) {
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeDoc(col, id, callback) {
  return onSnapshot(doc(db, col, id), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null),
  );
}

export function subscribeCol(col, callback, filters = [], orders = [], limitCount = null) {
  let q = collection(db, col);
  filters.forEach((f) => (q = query(q, where(f[0], f[1], f[2]))));
  orders.forEach((o) => (q = query(q, orderBy(o[0], o[1]))));
  if (limitCount) q = query(q, limit(limitCount));
  return onSnapshot(q, (s) =>
    callback(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export async function updateDocument(col, id, data) {
  return updateDoc(doc(db, col, id), data);
}

export async function addDocument(col, data) {
  return addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
}

export function getTimeRef() { return serverTimestamp(); }
export function getIncrement(val) { return increment(val); }

// === STORAGE EXPORTS ===
export async function uploadProfilePhoto(uid, file) {
  const path = `profiles/${uid}/${Date.now()}.jpg`;
  const sRef = ref(storage, path);
  await uploadBytes(sRef, file);
  return getDownloadURL(sRef);
}
/**
 * Presence System - Simple Version
 */
export async function updatePresence(uid) {
  if (!uid) return;
  const userRef = doc(db, "usuarios", uid);
  return updateDoc(userRef, {
    ultimoAcceso: serverTimestamp()
  }).catch(() => {}); // Fail silently
}
