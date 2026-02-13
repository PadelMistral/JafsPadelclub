// registro.js - Definitive Identity Generation
import { auth, db } from './firebase-service.js';
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js";
import { doc, setDoc, getDocs, collection, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from './ui-core.js';

initAppUI('register');

document.addEventListener('DOMContentLoaded', () => {
    const regForm = document.getElementById('reg-form');
    
    if (regForm) {
        regForm.onsubmit = async (e) => {
            e.preventDefault();
            
            const user = document.getElementById('r-user').value.trim();
            const name = document.getElementById('r-name').value.trim();
            const email = document.getElementById('r-email').value.trim();
            const phone = document.getElementById('r-phone').value.trim();
            const block = document.getElementById('r-block').value.trim() || '';
            const floor = document.getElementById('r-floor').value.trim() || '';
            const door = document.getElementById('r-door').value.trim() || '';
            const pass = document.getElementById('r-pass').value;
            const pass2 = document.getElementById('r-pass2').value;
            let lvl = parseFloat(document.getElementById('r-lvl').value);

            // Validation
            if (pass !== pass2) return showToast("Error clave", "Las claves no coinciden.", "warning");
            if (user.length < 3) return showToast("Error ID", "El ID de pista es demasiado corto.", "warning");

            setLoading(true);

            try {
                // 1. Check if username is taken
                const q = query(collection(db, "usuarios"), where("nombreUsuario", "==", user));
                const snap = await window.getDocsSafe(q);
                if (!snap.empty) {
                    setLoading(false);
                    return showToast("ID Ocupado", "Este identificador ya está en uso.", "error");
                }

                // 2. Create Auth User
                const creds = await createUserWithEmailAndPassword(auth, email, pass);
                const uid = creds.user.uid;

                // 3. Normalizar nivel y calcular puntos iniciales según nivel
                if (isNaN(lvl)) lvl = 2.5;
                const basePoints = Math.round(1000 + (lvl - 2.0) * 200);

                // 4. Create Firestore Profile
                await setDoc(doc(db, "usuarios", uid), {
                    uid,
                    nombre: name,
                    nombreUsuario: user,
                    email: email,
                    telefono: phone,
                    vivienda: {
                        bloque: block,
                        piso: floor,
                        puerta: door
                    },
                    nivel: lvl,
                    puntosRanking: basePoints,
                    partidosJugados: 0,
                    victorias: 0,
                    rachaActual: 0,
                    rol: 'Jugador',
                    status: 'pending', 
                    diario: [],
                    fotoURL: '',
                    createdAt: serverTimestamp()
                });

                showToast("Solicitud Enviada", "Tu identidad está en revisión por el Consejo.", "info");
                setTimeout(() => window.location.href = 'index.html', 2500);

            } catch (err) {
                console.error(err);
                setLoading(false);
                let msg = "Error en el registro de ADN.";
                if (err.code === 'auth/email-already-in-use') msg = "Este email ya tiene un operativo asignado.";
                if (err.code === 'auth/weak-password') msg = "La clave es demasiado vulnerable.";
                showToast("Falla de Enlace", msg, "error");
            }
        };
    }

    function setLoading(isLoading) {
        const form = document.getElementById('reg-form');
        const btn = form?.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = isLoading;
            btn.textContent = isLoading ? "SINCRONIZANDO..." : "CREAR CUENTA";
        }
    }
});


