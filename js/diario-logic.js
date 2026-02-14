// diario-logic.js - Premium Diary V9.0 (Advanced Data & Wizard)
import { auth, db, subscribeDoc, updateDocument, getDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { getDetailedWeather } from './external-data.js';

initAppUI('profile');

document.addEventListener('DOMContentLoaded', async () => {
    let currentStep = 1;
    const totalSteps = 5;
    let currentUser = null;
    let userData = null;
    let wizardData = {};

    // --- WIZARD LOGIC ---
    window.openWizard = (matchId = null) => {
        const modal = document.getElementById('modal-entry');
        modal.classList.add('active');
        currentStep = 1;
        updateWizardUI();
        loadAvailableMatches(); // Always try to load played matches
        if (matchId) loadLinkedMatch(matchId);
    };

    window.closeWizard = () => {
        document.getElementById('modal-entry').classList.remove('active');
    };

    // --- DETAILS MODAL ---
    window.showEntryDetails = (entryId) => {
        const entry = userData.diario.find(e => e.id === entryId);
        if (!entry) return;

        const date = new Date(entry.fecha);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '11000';
        
        overlay.innerHTML = `
            <div class="modal-card glass-strong animate-up p-0 overflow-hidden" style="max-width:420px; border-radius: 30px !important;">
                <div class="modal-header relative overflow-hidden p-6">
                    <div class="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-50"></div>
                    <div class="relative z-10 flex-col">
                        <span class="text-[9px] font-black text-primary tracking-[4px] uppercase mb-1">Análisis Táctico</span>
                        <h2 class="text-2xl font-black italic text-white leading-none">${date.toLocaleDateString('es-ES', {day:'numeric', month:'long'}).toUpperCase()}</h2>
                        <span class="text-[10px] font-bold text-muted mt-2 uppercase">${entry.tipo} | ${entry.posicion.toUpperCase()} | ${entry.hora.toUpperCase()}</span>
                    </div>
                    <button class="close-btn absolute top-6 right-6" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="modal-body custom-scroll p-6">
                    <!-- Stats Grid -->
                    <div class="grid grid-cols-2 gap-4 mb-6">
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col center">
                            <span class="text-xs font-black text-sport-green">${entry.stats?.winners || 0}</span>
                            <span class="text-[8px] font-bold text-muted uppercase tracking-widest mt-1">WINNERS</span>
                        </div>
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col center">
                            <span class="text-xs font-black text-sport-red">${entry.stats?.ue || 0}</span>
                            <span class="text-[8px] font-bold text-muted uppercase tracking-widest mt-1">ERRORES</span>
                        </div>
                    </div>

                    <!-- Tactical Insights -->
                    <div class="flex-col gap-4 mb-6">
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h4 class="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Clave del Partido</h4>
                            <p class="text-xs text-white/80 italic">"${entry.tactica?.clave || 'No registrada'}"</p>
                        </div>
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h4 class="text-[9px] font-black text-sport-red uppercase tracking-widest mb-2">Daño Recibido</h4>
                            <p class="text-xs text-white/80">${entry.tactica?.dañoRecibido || 'N/A'}</p>
                        </div>
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h4 class="text-[9px] font-black text-sport-green uppercase tracking-widest mb-2">Daño Infligido</h4>
                            <p class="text-xs text-white/80">${entry.tactica?.dañoInfligido || 'N/A'}</p>
                        </div>
                    </div>

                    <!-- Mood & Biometrics -->
                    <div class="p-5 bg-gradient-to-br from-primary/5 to-transparent rounded-3xl border border-primary/10">
                        <div class="flex-row between items-center mb-4">
                            <span class="text-[9px] font-black text-white/40 uppercase tracking-widest">Estado Biométrico</span>
                            <span class="badge-premium-v7 sm neutral" style="font-size: 8px;">${entry.biometria?.mood?.toUpperCase()}</span>
                        </div>
                        <div class="flex-row gap-3">
                             <div class="flex-1 flex-col center p-2 bg-black/20 rounded-xl">
                                <span class="text-sm font-black text-white">${entry.biometria?.fisico}/10</span>
                                <span class="text-[7px] text-muted font-bold uppercase mt-1">Físico</span>
                             </div>
                             <div class="flex-1 flex-col center p-2 bg-black/20 rounded-xl">
                                <span class="text-sm font-black text-white">${entry.biometria?.mental}/10</span>
                                <span class="text-[7px] text-muted font-bold uppercase mt-1">Mental</span>
                             </div>
                             <div class="flex-1 flex-col center p-2 bg-black/20 rounded-xl">
                                <span class="text-sm font-black text-white">${entry.biometria?.confianza}/10</span>
                                <span class="text-[7px] text-muted font-bold uppercase mt-1">Confianza</span>
                             </div>
                        </div>
                    </div>

                    <!-- Notes -->
                    ${entry.tactica?.notas ? `
                        <div class="mt-6 p-4 bg-primary/5 rounded-2xl border border-primary/10">
                            <h4 class="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Observaciones Libres</h4>
                            <p class="text-xs text-white/70 leading-relaxed">${entry.tactica.notas}</p>
                        </div>
                    ` : ''}
                </div>
                
                <div class="p-6 bg-black/20 border-t border-white/5 flex-row center">
                    <button class="btn btn-primary btn-sm w-full" onclick="this.closest('.modal-overlay').remove()">CERRAR ANÁLISIS</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    };

    window.wizardNext = async () => {
        // Validation for step 1
        if (currentStep === 1) {
            const mId = document.getElementById('inp-match-id').value || document.getElementById('inp-match-selector').value;
            if (!mId) {
                showToast('ACCIÓN REQUERIDA', 'Debes seleccionar un partido completado para crear un reporte.', 'warning');
                return;
            }

            // Verify match is played
            try {
                const match = await getDocument('partidosReto', mId) || await getDocument('partidosAmistosos', mId);
                if (!match || !match.resultado) {
                     showToast('PARTIDO PENDIENTE', 'El partido seleccionado aún no tiene resultado registrado. Juega primero, analiza después.', 'warning');
                     return;
                }
            } catch(e) {
                 showToast('ERROR', 'No se pudo verificar el estado del partido.', 'error');
                 return;
            }
        }

        if (currentStep < totalSteps) {
            currentStep++;
            updateWizardUI();
        } else {
            await saveEntry();
        }
    };

    window.wizardPrev = () => {
        if (currentStep > 1) {
            currentStep--;
            updateWizardUI();
        }
    };

    function updateWizardUI() {
        // Hide all steps
        document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
        // Show current
        document.getElementById(`step-${currentStep}`).classList.add('active');
        
        // Update Progress Bar
        for(let i=1; i<=totalSteps; i++) {
            const bar = document.getElementById(`wb-${i}`);
            if(i <= currentStep) bar.classList.add('active');
            else bar.classList.remove('active');
        }

        // Update Buttons
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const nextText = document.getElementById('btn-next-text');
        const nextIcon = document.getElementById('btn-next-icon');
        const title = document.getElementById('wizard-title');

        if(currentStep === 1) {
            btnPrev.style.display = 'none';
            title.textContent = 'CONTEXTO GLOBAL';
        } else {
            btnPrev.style.display = 'block';
            if(currentStep === 2) title.textContent = 'ALINEACIÓN TÁCTICA';
            if(currentStep === 3) title.textContent = 'MÉTRICAS DE RENDIMIENTO';
            if(currentStep === 4) title.textContent = 'BIOMETRÍA Y EMOCIÓN';
            if(currentStep === 5) title.textContent = 'ANÁLISIS FINAL';
        }

        if(currentStep === totalSteps) {
            nextText.textContent = 'GUARDAR EN MATRIX';
            nextIcon.className = 'fas fa-save';
            btnNext.classList.add('btn-finish');
        } else {
            nextText.textContent = 'SIGUIENTE';
            nextIcon.className = 'fas fa-chevron-right';
            btnNext.classList.remove('btn-finish');
        }
    }

    // --- FIELD HANDLERS ---

    // Segmented Buttons
    document.querySelectorAll('.segmented-v9 button').forEach(btn => {
        btn.onclick = function() {
            this.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        }
    });

    // Mood Matrix
    document.querySelectorAll('.mood-face').forEach(btn => {
        btn.onclick = function() {
            document.querySelectorAll('.mood-face').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        }
    });

    // Range Sliders display update
    document.querySelectorAll('input[type=range]').forEach(rng => {
        rng.addEventListener('input', function() {
            const valId = this.id.replace('inp-', 'val-').replace('rng-', 'val-');
            const disp = document.getElementById(valId);
            if(disp) disp.innerText = this.value;
        });
    });

    // --- DATA LOADING & AUTH ---

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            subscribeDoc("usuarios", user.uid, (data) => {
                if (data) {
                    userData = data;
                    renderJournalList(data.diario || []);
                    updateStats(data.diario || []);
                }
            });
        }
    });

    // Check URL params for match linking
    const urlParams = new URLSearchParams(window.location.search);
    const mId = urlParams.get('matchId');
    if (mId) {
        window.openWizard();
        loadLinkedMatch(mId);
    }

    async function loadAvailableMatches() {
        if (!currentUser) return;
        const selector = document.getElementById('inp-match-selector');
        if (!selector) return;

        try {
            const { query, collection, where, getDocs, orderBy } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
            
            // Fetch from both collections
            const qA = query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", currentUser.uid), where("estado", "==", "jugado"), orderBy("fecha", "desc"));
            const qR = query(collection(db, "partidosReto"), where("jugadores", "array-contains", currentUser.uid), where("estado", "==", "jugado"), orderBy("fecha", "desc"));
            
            const [snapA, snapR] = await Promise.all([getDocs(qA), getDocs(qR)]);
            
            let all = [
                ...snapA.docs.map(d => ({ id: d.id, ...d.data(), type: 'Amistoso' })),
                ...snapR.docs.map(d => ({ id: d.id, ...d.data(), type: 'Reto' }))
            ].sort((a,b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0));

            selector.innerHTML = '<option value="">-- Selecciona un partido --</option>';
            all.forEach(m => {
                const date = m.fecha?.toDate ? m.fecha.toDate().toLocaleDateString() : '---';
                const res = m.resultado?.sets || 'Sin resultado';
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${date} - ${m.type} [${res}]`;
                selector.appendChild(opt);
            });
        } catch (e) {
            console.error("Error loading matches for diary:", e);
        }
    }

    window.onMatchSelectChange = (id) => {
        if (id) loadLinkedMatch(id);
    };

    async function loadLinkedMatch(id) {
        const match = await getDocument('partidosReto', id) || await getDocument('partidosAmistosos', id);
        if (match) {
            const infoBox = document.getElementById('linked-match-info');
            if (infoBox) {
                infoBox.classList.remove('hidden');
                document.getElementById('txt-match-date').textContent = match.fecha?.toDate ? match.fecha.toDate().toLocaleDateString() : 'Partido Anterior';
                document.getElementById('txt-result').textContent = match.resultado ? `RESULTADO: ${match.resultado.sets}` : 'PENDIENTE';
                document.getElementById('inp-match-id').value = id;
                
                // Pre-fill context if available
                if (match.surface) {
                    document.querySelectorAll('#surface-selector button').forEach(b => {
                        if(b.dataset.val === match.surface) b.click();
                    });
                }
                
                // Pre-fill players
                if (match.jugadores) {
                    const myIdx = match.jugadores.indexOf(currentUser.uid);
                    if (myIdx !== -1) {
                         const partnerIdx = myIdx < 2 ? (myIdx === 0 ? 1 : 0) : (myIdx === 2 ? 3 : 2);
                         const partId = match.jugadores[partnerIdx];
                         if (partId) {
                             getDocument('usuarios', partId).then(u => {
                                 if (u) document.getElementById('inp-partner').value = u.nombreUsuario || u.nombre;
                             });
                         }
                    }
                }
            }
        }
    }

    // --- SAVE LOGIC ---

    async function saveEntry() {
        if (!currentUser) return;

        const btn = document.getElementById('btn-next');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';

        try {
            // 1. Gather Data
            const entry = {
                id: Date.now().toString(),
                fecha: new Date().toISOString(),
                matchId: document.getElementById('inp-match-id').value || null,
                
                // Context
                tipo: document.getElementById('inp-tipo').value,
                hora: document.getElementById('inp-hora').value,
                surface: document.querySelector('#surface-selector .active')?.dataset.val || 'indoor',
                pista: document.getElementById('inp-court-type').value,
                
                // Alignment
                posicion: document.querySelector('#pos-selector .active')?.dataset.val || 'reves',
                rivalStyle: Array.from(document.querySelectorAll('#rival-tags .active')).map(el => el.innerText),
                partner: document.getElementById('inp-partner').value,
                rivals: [document.getElementById('inp-rival1').value, document.getElementById('inp-rival2').value],
                
                // Metrics (Advanced)
                stats: {
                    winners: parseInt(document.getElementById('val-winners').innerText),
                    ue: parseInt(document.getElementById('val-ue').innerText),
                    netPoints: parseInt(document.getElementById('rng-net').value),
                    backPoints: parseInt(document.getElementById('rng-back').value)
                },
                
                // Biometrics & Mood
                biometria: {
                    fisico: parseInt(document.getElementById('inp-fisico').value),
                    mental: parseInt(document.getElementById('inp-mental').value),
                    confianza: parseInt(document.getElementById('inp-confianza').value),
                    mood: document.querySelector('#mood-box .active')?.dataset.mood || 'Normal'
                },

                // Analysis
                tactica: {
                    clave: document.getElementById('inp-key-moment').value,
                    dañoRecibido: document.getElementById('inp-damage-received').value,
                    dañoInfligido: document.getElementById('inp-damage-inflicted').value,
                    notas: document.getElementById('entry-notes').value
                }
            };

            // 2. Weather Snapshot
            try {
                const w = await getDetailedWeather();
                if (w && w.current) {
                    entry.weather = {
                        temp: w.current.temperature_2m,
                        rain: w.current.rain,
                        wind: w.current.wind_speed_10m
                    };
                }
            } catch(e) {}

            // 3. AI Summary (Simulated for now)
            entry.aiSummary = generateSmartSummary(entry);

            // --- PHASE 3.5: PREDICTION VALIDATION & BRAIN SYNC ---
            if (entry.matchId) {
                try {
                    let mSnap = await getDoc(doc(db, 'partidosAmistosos', entry.matchId));
                    if (!mSnap.exists()) {
                        mSnap = await getDoc(doc(db, 'partidosReto', entry.matchId));
                    }
                    
                    if (mSnap.exists()) {
                        const mData = mSnap.data();
                        
                        // Link concrete result
                        entry.resultSnapshot = mData.resultado || null;
                        
                        if (mData.preMatchPrediction) {
                            entry.predictionSnapshot = mData.preMatchPrediction;
                        }
                    }
                } catch(err) { console.warn("Prediction fetch error", err); }
            }
            
            // --- PHASE 7: AI ORCHESTRATOR SYNC ---
            // Notify the Brain about this subjective data
            try {
                const { AIOrchestrator } = await import('./ai-orchestrator.js');
                // Dispatch event (Async, don't block save)
                AIOrchestrator.dispatch('DIARY_SAVED', { 
                    uid: currentUser.uid, 
                    diaryEntry: entry 
                }).catch(e => console.warn("Orchestrator sync warning:", e));
            } catch(e) {
                console.warn("Orchestrator module not found:", e);
            }


            // 4. Save to Firebase
            const currentJournal = userData.diario || [];
            // Limit journal size? No, keep history.
            await updateDocument("usuarios", currentUser.uid, { diario: [...currentJournal, entry] });
            
            // 5. Update Advanced Stats in User Profile (Accumulated)
            const currentStats = userData.advancedStats || { winners: 0, ue: 0, matches: 0 };
            currentStats.winners = (currentStats.winners || 0) + entry.stats.winners;
            currentStats.ue = (currentStats.ue || 0) + entry.stats.ue;
            currentStats.matches = (currentStats.matches || 0) + 1;
            
            // Update average
            currentStats.winnersAvg = Math.round(currentStats.winners / currentStats.matches);
            currentStats.ueAvg = Math.round(currentStats.ue / currentStats.matches);
            
            await updateDocument("usuarios", currentUser.uid, { advancedStats: currentStats });

            showToast("DATA UPLOADED", "Entrada registrada en la Matrix", "success");
            window.closeWizard();
            resetWizard();

        } catch (e) {
            console.error(e);
            showToast("ERROR", "Fallo en la sincronización", "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    function resetWizard() {
        currentStep = 1;
        document.getElementById('inp-key-moment').value = '';
        document.getElementById('inp-damage-received').value = '';
        document.getElementById('inp-damage-inflicted').value = '';
        document.getElementById('entry-notes').value = '';
        document.getElementById('val-winners').innerText = '0';
        document.getElementById('val-ue').innerText = '0';
        // Reset others...
    }

    // --- RENDER JOURNAL LIST ---
    function renderJournalList(entries) {
        const list = document.getElementById('journal-list');
        if (!list) return;
        
        if (entries.length === 0) {
            list.innerHTML = `<div class="opacity-30 text-center py-10 font-mono text-xs">NO DATA STREAMS FOUND</div>`;
            return;
        }

        list.innerHTML = [...entries].reverse().map(e => {
            const date = new Date(e.fecha);
            const moodColor = {
                'Frustrado': 'text-red-400',
                'Cansado': 'text-orange-400',
                'Normal': 'text-gray-400',
                'Motivado': 'text-blue-400',
                'Fluido': 'text-green-400'
            }[e.biometria?.mood || 'Normal'];

            return `
                <div class="journal-card-v10 animate-fade-in mb-4 cursor-pointer hover:bg-white/5 transition-all" 
                     onclick="window.showEntryDetails('${e.id}')">
                    <div class="card-header-v10 flex-row between items-center mb-3">
                        <div class="flex-col">
                            <span class="text-[9px] font-black uppercase tracking-widest text-primary">${e.tipo || 'SESIÓN'}</span>
                            <span class="text-xs font-black text-white">${date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                        </div>
                        <div class="mood-badge ${moodColor} border border-white/10 px-3 py-1 rounded-full bg-black/40">
                            <span class="text-[10px] font-black uppercase">${e.biometria?.mood || 'N/A'}</span>
                        </div>
                    </div>

                    ${e.aiSummary ? `
                        <div class="ai-insight-box mb-4 p-3 bg-white/5 rounded-xl border border-white/5">
                            <i class="fas fa-brain text-purple-400 text-[10px] mr-2"></i>
                            <span class="text-[10px] italic text-gray-300">"${e.aiSummary}"</span>
                        </div>
                    ` : ''}

                    <div class="stat-mini-grid">
                        <div class="sm-item flex-col">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">Winners</span>
                            <b class="text-sport-green text-sm">${e.stats?.winners || 0}</b>
                        </div>
                        <div class="sm-item flex-col">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">Errores</span>
                            <b class="text-sport-red text-sm">${e.stats?.ue || 0}</b>
                        </div>
                        <div class="sm-item flex-col">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">Posición</span>
                            <b class="text-white text-sm">${(e.posicion || '-').toUpperCase()}</b>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateStats(entries) {
        document.getElementById('stat-entries').innerText = entries.length;
        // Calculation of streak...
        // This part remains similar to previous version, omitted for brevity but should be there
    }

    function generateSmartSummary(e) {
        // Simple rule-based generation
        const feels = e.biometria?.mood || 'Normal';
        const ratio = (e.stats?.winners || 0) / ((e.stats?.ue || 1));
        
        let txt = "";
        if (ratio > 1.5) txt += "Gran eficiencia ofensiva. ";
        else if (ratio < 0.5) txt += "Exceso de errores no forzados. ";
        
        if (feels === 'Frustrado') txt += "La gestión emocional limitó el rendimiento. ";
        if (feels === 'Fluido') txt += "Estado de flow alcanzado. ";
        
        if (e.tactica?.clave) txt += `Clave: ${e.tactica.clave}.`;
        
        return txt || "Sesión registrada sin incidencias mayores.";
    }

    // Export global functions
    window.showAIAnalysis = async () => {
         const { initVecinaChat, toggleChat } = await import('./modules/vecina-chat.js?v=6.5');
         initVecinaChat();
         toggleChat();
    };
});
