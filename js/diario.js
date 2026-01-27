// diario.js - Performance Tracking Logic
import { auth, db, observerAuth, updateDocument, getDocument, getTimeRef } from './firebase-service.js';
import { arrayUnion } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from './ui-core.js';

initAppUI('profile');

let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('history-list');
    const saveBtn = document.getElementById('btn-save-entry');

    observerAuth(async (user) => {
        if (user) {
            currentUser = user;
            loadJournal(user.uid);
        }
    });

    if (saveBtn) {
        saveBtn.onclick = async () => {
            const entry = {
                date: getTimeRef(),
                sensaciones: document.getElementById('j-mood').value,
                pala: document.getElementById('j-racket').value,
                defensa: parseInt(document.getElementById('i-def').value),
                volea: parseInt(document.getElementById('i-vol').value),
                vibora: parseInt(document.getElementById('i-vib').value),
                remate: parseInt(document.getElementById('i-rem').value),
                notes: document.getElementById('j-notes').value
            };

            try {
                saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                await updateDocument('usuarios', currentUser.uid, {
                    diario: arrayUnion(entry)
                });
                showToast("Nexo", "Registro sincronizado con la IA.", "success");
                
                // Clear form
                document.getElementById('j-notes').value = '';
                saveBtn.disabled = false; saveBtn.innerHTML = 'GUARDAR REGISTRO <i class="fas fa-save ml-2"></i>';
                
                loadJournal(currentUser.uid);
            } catch(e) { 
                console.error(e);
                showToast("Error", "Fallo al escribir en el diario.", "error"); 
                saveBtn.disabled = false;
            }
        };
    }

    async function loadJournal(uid) {
        const data = await getDocument('usuarios', uid);
        if (!data || !data.diario || data.diario.length === 0) {
            listEl.innerHTML = '<p class="text-center p-8 opacity-20 text-xs">Sin registros de combate anteriores.</p>';
            return;
        }

        const sorted = data.diario.reverse();
        listEl.innerHTML = sorted.map(log => {
            const date = log.date?.toDate ? log.date.toDate() : new Date();
            return `
                <div class="log-v10 animate-up">
                    <div class="log-date">${date.toLocaleDateString()} - ${log.sensaciones.toUpperCase()}</div>
                    ${log.pala ? `<div class="text-2xs text-secondary mb-1">ARMAMENTO: ${log.pala}</div>` : ''}
                    <p class="log-note">"${log.notes || 'Sin anotaciones adicionales.'}"</p>
                    <div class="log-stats">
                        <span class="glass-pill" style="font-size: 0.5rem;">DEF: ${log.defensa}</span>
                        <span class="glass-pill" style="font-size: 0.5rem;">VOL: ${log.volea}</span>
                        <span class="glass-pill" style="font-size: 0.5rem;">VIB: ${log.vibora}</span>
                        <span class="glass-pill" style="font-size: 0.5rem;">REM: ${log.remate}</span>
                    </div>
                </div>
            `;
        }).join('');
    }
});
