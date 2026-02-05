// diario-logic.js - Premium Diary V7.0
import { auth, db, subscribeDoc, updateDocument, getDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';

initAppUI('profile');

document.addEventListener('DOMContentLoaded', async () => {
    const journalList = document.getElementById('journal-list');
    const modal = document.getElementById('modal-entry');
    const btnSave = document.getElementById('btn-save-entry');
    const moodBox = document.getElementById('mood-box');
    
    let selectedMood = 'Normal';
    let currentUser = null;
    let userData = null;

    // Handle Match ID from Param
    const urlParams = new URLSearchParams(window.location.search);
    const mId = urlParams.get('matchId');
    if (mId && modal) {
        modal.classList.add('active');
        loadLinkedMatch(mId);
    }

    async function loadLinkedMatch(id) {
        const match = await getDocument('partidosReto', id) || await getDocument('partidosAmistosos', id);
        if (match) {
            const infoBox = document.getElementById('linked-match-info');
            if (infoBox) {
                infoBox.classList.remove('hidden');
                document.getElementById('txt-match-date').textContent = match.fecha?.toDate ? match.fecha.toDate().toLocaleDateString() : 'Partido Anterior';
                document.getElementById('txt-match-type').textContent = match.resultado ? 'CON RESULTADO' : 'SIN RESULTADO';
                document.getElementById('inp-match-id').value = id;
                document.getElementById('inp-tipo').value = 'Partido';
                // Try to pre-fill result if available
                if (match.resultado?.sets) document.getElementById('entry-notes').value = `Resultado: ${match.resultado.sets}\n\n`;
            }
        }
    }

    // Mood Selector
    if (moodBox) {
        moodBox.querySelectorAll('.mood-btn').forEach(btn => {
            btn.onclick = () => {
                moodBox.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMood = btn.dataset.mood;
            };
        });
    }

    // Expanded Skill Buttons Logic
    window.toggleSkillChip = (el) => {
        const states = ['none', 'good', 'bad'];
        let curr = el.dataset.state || 'none';
        let nextIdx = (states.indexOf(curr) + 1) % states.length;
        let next = states[nextIdx];
        
        el.dataset.state = next;
        el.className = 'chip-item ' + (next !== 'none' ? next : '');
        const icon = el.querySelector('i');
        
        if (next === 'good') icon.className = 'fas fa-check-circle';
        else if (next === 'bad') icon.className = 'fas fa-times-circle';
        else icon.className = 'fas fa-circle-dot';
    };

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            subscribeDoc("usuarios", user.uid, (data) => {
                if (data) {
                    userData = data;
                    renderJournal(data.diario || []);
                    updateStats(data.diario || []);
                }
            });
        }
    });

    if (btnSave) {
        btnSave.onclick = async () => {
            if (!currentUser) return;
            
            const entry = {
                id: Date.now().toString(),
                fecha: new Date().toISOString(),
                tipo: document.getElementById('inp-tipo')?.value || 'Nota',
                sensaciones: selectedMood,
                detalles: {
                    pala: document.getElementById('inp-pala')?.value.trim() || '-',
                    pista: document.getElementById('inp-pista')?.value.trim() || '-',
                    rival: document.getElementById('inp-rival')?.value.trim() || ''
                },
                valoracion: {
                    defensa: parseInt(document.getElementById('inp-defensa')?.value || 5),
                    volea: parseInt(document.getElementById('inp-volea')?.value || 5),
                    ataque: parseInt(document.getElementById('inp-ataque')?.value || 5),
                    fisico: parseInt(document.getElementById('inp-fisico')?.value || 5)
                },
                comentarios: document.getElementById('entry-notes')?.value.trim() || '',
                tacticalBalance: getTacticalBalance(),
                matchId: document.getElementById('inp-match-id')?.value || null
            };

            const updatedJournal = [...(userData?.diario || []), entry];
            
            try {
                btnSave.disabled = true;
                btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
                
                await updateDocument("usuarios", currentUser.uid, { diario: updatedJournal });
                
                // Achievement trigger for journaling
                if (updatedJournal.length === 1) showToast("Logro", "Primera entrada en tu diario 📖", "success");
                if (updatedJournal.length === 10) showToast("Logro", "Analista Táctico (10 entradas) 🧠", "success");

                showToast("¡GUARDADO!", "Nueva entrada en tu bitácora", "success");
                modal?.classList.remove('active');
                resetForm();
                
                // AI Learning trigger (Simulated)
                // In a real backend, this would trigger an embedding update
            } catch (e) {
                console.error(e);
                showToast("Error", "No se pudo guardar", "error");
            } finally {
                btnSave.disabled = false;
                btnSave.innerHTML = '<i class="fas fa-save"></i> Guardar Entrada';
            }
        };
    }

    function getTacticalBalance() {
        const chips = document.querySelectorAll('.chip-item');
        const balance = {};
        chips.forEach(c => {
            if (c.dataset.state !== 'none') balance[c.dataset.skill] = c.dataset.state;
        });
        return balance;
    }

    function resetForm() {
        const notes = document.getElementById('entry-notes');
        if (notes) notes.value = '';
        ['pala', 'pista', 'rival'].forEach(id => {
            const inp = document.getElementById(`inp-${id}`);
            if (inp) inp.value = '';
        });
        document.querySelectorAll('.chip-item').forEach(c => {
            c.dataset.state = 'none';
            c.className = 'chip-item';
            c.querySelector('i').className = 'fas fa-circle-dot';
        });
    }

    function updateStats(entries) {
        if (document.getElementById('stat-entries')) document.getElementById('stat-entries').textContent = entries.length;
        
        let streak = 0;
        // Simple streak logic (consecutive days with entries)
        let lastDate = null;
        [...entries].reverse().forEach(e => {
            const d = new Date(e.fecha).toDateString();
            if (!lastDate) { streak = 1; lastDate = d; }
            else if (d === lastDate) {} // Same day
            else {
                const diff = (new Date(lastDate) - new Date(d)) / (1000 * 60 * 60 * 24);
                if (diff <= 1.5) { streak++; lastDate = d; }
                else return;
            }
        });
        
        if (document.getElementById('stat-streak')) document.getElementById('stat-streak').textContent = streak > 0 ? (streak > 2 ? '🔥 '+streak : streak) : 0;
        
        const moods = entries.map(e => e.sensaciones);
        if (moods.length > 0) {
            const counts = moods.reduce((a,b) => { a[b] = (a[b] || 0) + 1; return a; }, {});
            const topMood = Object.keys(counts).reduce((a,b) => counts[a] > counts[b] ? a : b);
            if (document.getElementById('stat-avg-mood')) document.getElementById('stat-avg-mood').textContent = topMood;
        }
    }

    function renderJournal(entries) {
        if (!journalList) return;
        if (entries.length === 0) {
            journalList.innerHTML = `
                <div class="empty-state text-center py-20 opacity-30">
                    <i class="fas fa-book-reader text-4xl mb-4"></i>
                    <p>Tu diario está vacío. Empieza a registrar para mejorar.</p>
                </div>
            `;
            return;
        }

        const moodEmojis = { 'Mal': '😡', 'Cansado': '😫', 'Normal': '😐', 'Bien': '😎', 'Genial': '🔥' };

        journalList.innerHTML = [...entries].reverse().map((e, idx) => {
            const date = new Date(e.fecha);
            const typeClass = e.tipo?.toLowerCase() || 'tactica';
            const comments = e.comentarios || '';
            const preview = comments.length > 60 ? comments.substring(0, 60) + '...' : comments;
            
            // Handle legacy structure
            const vals = e.valoracion || {
                defensa: e.defensa, volea: e.volea, ataque: e.ataque, fisico: e.fisico
            };

            return `
                <article class="entry-card-v7 stagger-item" style="animation-delay: ${idx * 0.05}s">
                    <div class="e-header-v7">
                        <span class="e-type-pill ${typeClass}">${e.tipo || 'Nota'}</span>
                        <span class="e-date-v7">${date.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                    </div>
                    
                    <div class="e-content-v7">
                        ${comments ? `<p class="e-desc-v7">"${preview}"</p>` : ''}
                        
                        <div class="stats-row-v5 mb-3">
                            <div class="s-box"><span>DEF</span><b>${vals.defensa || '-'}</b></div>
                            <div class="s-box"><span>VOL</span><b>${vals.volea || '-'}</b></div>
                            <div class="s-box"><span>ATK</span><b>${vals.ataque || '-'}</b></div>
                            <div class="s-box"><span>FIS</span><b>${vals.fisico || '-'}</b></div>
                        </div>
                    </div>
                    
                    <div class="e-footer-v7">
                        <div class="e-mood-v7">${moodEmojis[e.sensaciones] || '😐'} <span>${e.sensaciones || 'Normal'}</span></div>
                        ${renderBalance(e.tacticalBalance)}
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderBalance(balance) {
        if (!balance || Object.keys(balance).length === 0) return '';
        // Limit to 3 items to avoid clutter
        const keys = Object.keys(balance).slice(0, 3);
        const html = keys.map(k => {
            const v = balance[k];
            const color = v === 'good' ? 'text-green-400' : 'text-red-400';
            const icon = v === 'good' ? 'check' : 'times';
            return `<span class="text-[9px] font-black uppercase ${color} flex items-center gap-1"><i class="fas fa-${icon}"></i> ${k}</span>`;
        }).join('<span class="opacity-20 mx-1">|</span>');
        
        return `<div class="flex items-center">${html} ${Object.keys(balance).length > 3 ? '<span class="text-[8px] opacity-50 ml-1">+</span>' : ''}</div>`;
    }
});
