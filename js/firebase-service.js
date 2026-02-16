// firebase-service.js - Core Services (v6.0)
import { app, auth, db, storage } from "./firebase-init.js";
import {
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
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-storage.js";

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
            rol: 'Jugador',
            status: 'pending',
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
  try {
    const snap = await getDoc(doc(db, col, id));
    if (!snap.exists()) return null;
    const d = snap.data();
    
    // Legacy user fallback
    if (col === 'usuarios') {
        if (!d.rol) d.rol = 'Jugador';
        if (!d.status && d.rol !== 'Admin') d.status = 'pending';
    }
    
    return { id: snap.id, ...d };
  } catch (err) {
    console.error("Firestore getDocument error:", err);
    return null;
  }
}

export async function getDocsSafe(q, label = "") {
  try {
    return await getDocs(q);
  } catch (err) {
    if (typeof window !== "undefined") {
      window.__dataErrors = window.__dataErrors || [];
      window.__dataErrors.push({ label, code: err?.code || "unknown" });
    }
    return { empty: true, docs: [], forEach: () => {}, size: 0, _errorCode: err?.code || "unknown" };
  }
}

if (typeof window !== "undefined") {
  window.getDocsSafe = getDocsSafe;
}

export function subscribeDoc(col, id, callback) {
  return onSnapshot(
    doc(db, col, id),
    (s) => callback(s.exists() ? { id: s.id, ...s.data() } : null),
    (err) => {
      if (typeof window !== "undefined") {
        window.__dataErrors = window.__dataErrors || [];
        window.__dataErrors.push({ label: `doc:${col}`, code: err?.code || "unknown" });
      }
    },
  );
}

export async function subscribeCol(col, callback, filters = [], orders = [], limitCount = null) {
  let q = collection(db, col);
  filters.forEach((f) => (q = query(q, where(f[0], f[1], f[2]))));
  orders.forEach((o) => (q = query(q, orderBy(o[0], o[1]))));
  if (limitCount) q = query(q, limit(limitCount));
  const warm = await getDocsSafe(q, `${col}`);
  if (warm?._errorCode === "failed-precondition") {
    callback([]);
    return () => {};
  }
  return onSnapshot(
    q,
    (s) => callback(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      if (typeof window !== "undefined") {
        window.__dataErrors = window.__dataErrors || [];
        window.__dataErrors.push({ label: `col:${col}`, code: err?.code || "unknown" });
      }
    },
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
  const path = `users/${uid}/profile.jpg`;
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
  }).catch((err) => {
    console.warn("Presence update failed:", err?.code || err?.message || err);
  });
}
