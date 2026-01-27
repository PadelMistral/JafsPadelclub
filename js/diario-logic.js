// diario-logic.js - Player Journal Core (v12.0)
import { auth, db, subscribeDoc, updateDocument, getDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { initGalaxyBackground } from './modules/galaxy-bg.js';

initAppUI('perfil');
initGalaxyBackground();

document.addEventListener('DOMContentLoaded', async () => {
    const journalList = document.getElementById('journal-list');
    const modal = document.getElementById('modal-entry');
    const btnNew = document.getElementById('btn-new-entry');
    const btnSave = document.getElementById('btn-save-entry');
    const moodBox = document.getElementById('mood-box');
    const notesInp = document.getElementById('entry-notes');
    
    let selectedMood = 'Normal';
    let currentUser = null;
    let userData = null;

    // Handle Match ID from Param
    const urlParams = new URLSearchParams(window.location.search);
    const mId = urlParams.get('matchId');
    if (mId) {
        modal.classList.add('active');
        loadLinkedMatch(mId);
    }

    async function loadLinkedMatch(id) {
        const match = await getDocument('partidosReto', id) || await getDocument('partidosAmistosos', id);
        if (match) {
            const infoBox = document.getElementById('linked-match-info');
            infoBox.classList.remove('hidden');
            document.getElementById('txt-match-date').textContent = match.fecha?.toDate ? match.fecha.toDate().toLocaleDateString() : 'Partido Anterior';
            document.getElementById('txt-match-type').textContent = match.resultado ? 'CON RESULTADO' : 'SIN RESULTADO';
            document.getElementById('inp-match-id').value = id;
            document.getElementById('inp-tipo').value = 'Partido';
        }
    }

    // Mood toggle
    moodBox.querySelectorAll('.mood-item').forEach(btn => {
        btn.onclick = () => {
            moodBox.querySelectorAll('.mood-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedMood = btn.dataset.mood;
        };
    });

    // Range value syncing
    ['defensa', 'volea', 'ataque', 'fisico'].forEach(id => {
        const inp = document.getElementById(`inp-${id}`);
        const val = document.getElementById(`val-${id}`);
        if (inp && val) inp.oninput = () => val.textContent = inp.value;
    });

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            subscribeDoc("usuarios", user.uid, (data) => {
                if (data) {
                    userData = data;
                    renderJournal(data.diario || []);
                }
            });
        }
    });

    btnSave.onclick = async () => {
        if (!currentUser) return;
        
        const entry = {
            fecha: new Date().toISOString(),
            tipo: document.getElementById('inp-tipo').value,
            sensaciones: selectedMood,
            pala: document.getElementById('inp-pala').value.trim() || 'Desconocida',
            pista: document.getElementById('inp-pista').value.trim() || '-',
            defensa: parseInt(document.getElementById('inp-defensa').value),
            volea: parseInt(document.getElementById('inp-volea').value),
            ataque: parseInt(document.getElementById('inp-ataque').value),
            fisico: parseInt(document.getElementById('inp-fisico').value),
            mejorGolpe: document.getElementById('inp-golpe').value.trim(),
            rivalDificil: document.getElementById('inp-rival').value.trim(),
            comentarios: notesInp.value.trim(),
            matchId: document.getElementById('inp-match-id').value || null
        };

        const updatedJournal = [...(userData.diario || []), entry];
        
        try {
            btnSave.disabled = true;
            btnSave.textContent = "GUARDANDO...";
            await updateDocument("usuarios", currentUser.uid, { diario: updatedJournal });
            // Family Points Reward for journaling
            const currentFP = userData.familyPoints || 0;
            await updateDocument("usuarios", currentUser.uid, { familyPoints: currentFP + 10 });
            
            showToast("AGENDA ACTUALIZADA", "+10 FP Ganados", "success");
            modal.classList.remove('active');
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {
            showToast("ERROR", "Fallo al guardar", "error");
        } finally {
            btnSave.disabled = false;
            btnSave.textContent = "GUARDAR EN BITÁCORA";
        }
    };

    function renderJournal(entries) {
        if (!journalList) return;
        if (entries.length === 0) {
            journalList.innerHTML = '<div class="center flex-col py-10 opacity-30"><i class="fas fa-book mb-4 text-3xl"></i><span>Diario vacío</span></div>';
            return;
        }

        journalList.innerHTML = [...entries].reverse().map((e, idx) => {
            const date = new Date(e.fecha);
            return `
                <div class="sport-card animate-up" style="animation-delay: ${idx * 0.05}s">
                    <div class="flex-row between mb-4">
                        <div class="flex-col">
                            <span class="text-xs font-black text-white">${date.toLocaleDateString().toUpperCase()}</span>
                            <span class="text-[9px] text-scnd uppercase">${e.tipo}</span>
                        </div>
                        <span class="status-badge badge-blue text-[10px]">${e.sensaciones.toUpperCase()}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="flex-col"><span class="text-[8px] text-scnd font-black">PALA</span><span class="text-xs font-bold text-white">${e.pala}</span></div>
                        <div class="flex-col"><span class="text-[8px] text-scnd font-black">PISTA</span><span class="text-xs font-bold text-white">${e.pista}</span></div>
                    </div>
                    <div class="flex-row gap-2 mb-4 bg-white/5 p-2 rounded-lg justify-around">
                        ${['defensa','volea','ataque','fisico'].map(s => `<div class="text-center"><div class="text-[7px] text-scnd font-black uppercase">${s}</div><div class="text-xs font-black text-sport-blue">${e[s]}</div></div>`).join('')}
                    </div>
                    ${e.comentarios ? `<p class="text-xs text-scnd italic border-l-2 border-white/10 pl-3 leading-relaxed">"${e.comentarios}"</p>` : ''}
                    ${e.matchId ? `<div class="mt-3 text-[9px] text-sport-blue font-bold"><i class="fas fa-link mr-1"></i> PARTIDO VINCULADO</div>` : ''}
                </div>
            `;
        }).join('');
    }
});
