import {
  auth,
  db,
  observerAuth,
  subscribeDoc,
  updateDocument,
  uploadProfilePhoto,
  getDocument,
} from "./firebase-service.js";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { showToast, countUp, initAppUI } from "./ui-core.js";
import {
  injectHeader,
  injectNavbar,
  initBackground,
  setupModals,
} from "./modules/ui-loader.js?v=6.5";
import { AI } from './ai-engine.js';
import { PredictiveEngine } from './predictive-engine.js';
import { RivalIntelligence } from './rival-intelligence.js';
import { DashboardEvolution } from './dashboard-evolution.js';
import { SmartNotifier } from './modules/smart-notifications.js';

document.addEventListener("DOMContentLoaded", () => {
  initBackground();
  setupModals();

  let currentUser = null;
  let userData = null;
  let eloChart = null;
  let radarChart = null;

  observerAuth(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    currentUser = user;
    
    // --- PHASE 6: Contextual Checks ---
    SmartNotifier.checkInactivity({ id: user.uid, lastMatchDate: user.limitMatchDate }); 
    // Note: ensure lastMatchDate is populated correctly in user object from getDocument later, 
    // but here user object is from Auth. We need DB data.
    // Ideally call this inside subscribeDoc or after getDocument.
    
    const data = await getDocument("usuarios", user.uid);
    await injectHeader(data || {});
    injectNavbar("profile");

    // Check inactivity after loading data
    if (data) SmartNotifier.checkInactivity({ id: user.uid, lastMatchDate: data.lastMatchDate });

    subscribeDoc("usuarios", user.uid, (data) => {
      if (data) {
        userData = data;
        renderProfileData(data);
        renderAIInsights(data); // Auto-Trigger AI
        loadEloHistory(user.uid);
        loadCompetitiveData(user.uid);
        renderTacticalRadar(data);
        renderAchievements(data);
        renderDiarioStats(data.diario || []);
      } else if (!userData) {
        const fallback = {
          nombreUsuario: "Jugador",
          nombre: "Jugador",
          nivel: 2.5,
          puntosRanking: 1000,
          victorias: 0,
          partidosJugados: 0,
          rachaActual: 0,
        };
        userData = fallback;
        renderProfileData(fallback);
      }
    });

    // Make stats clickable for explanation
    setupStatInteractions();
  });

  async function renderProfileData(data) {
    if (!data) return;
    
    // Header Info
    const nameEl = document.getElementById("p-name");
    const roleEl = document.getElementById("p-role");
    const avatarEl = document.getElementById("p-avatar");
    const userInp = document.getElementById("p-username-inp");

    const photo = data.fotoPerfil || data.fotoURL;
    const name = data.nombreUsuario || data.nombre || "JUGADOR";
    const phone = data.telefono || "";

    if (nameEl) nameEl.textContent = name.toUpperCase();
    if (roleEl) roleEl.textContent = (data.rol || 'Atleta Pro').toUpperCase();
    if (avatarEl && photo) avatarEl.src = photo;
    if (userInp) userInp.value = name;
    
    // Form inputs
    const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    setVal("p-phone-inp", phone);
    setVal("p-weight-inp", data.peso || "");
    const vivInfo = data.vivienda || data.direccion || {};
    if(vivInfo.bloque) {
        setVal("addr-bloque", vivInfo.bloque);
        setVal("addr-piso", vivInfo.piso);
        setVal("addr-puerta", vivInfo.puerta);
    }

    // V7 Stats Cards
    const levelVal = (data.nivel || 2.5).toFixed(2);
    const ptsVal = Math.round(data.puntosRanking || 1000);
    const streakVal = data.rachaActual || 0;
    
    const lvlEl = document.getElementById("p-nivel");
    const ptsEl = document.getElementById("p-puntos");
    const stkEl = document.getElementById("p-streak");
    
    if(lvlEl) countUp(lvlEl, levelVal);
    if(ptsEl) countUp(ptsEl, ptsVal);
    if(stkEl) {
        stkEl.textContent = Math.abs(streakVal);
        stkEl.style.color = streakVal >= 0 ? "var(--sport-green)" : "var(--sport-red)";
    }

    // Grid Metrics (Detailed)
    const winrate = data.partidosJugados > 0
        ? Math.round((data.victorias / data.partidosJugados) * 100)
        : 0;
    const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
    setText("stat-total-matches", data.partidosJugados || 0);
    setText("stat-total-wins", data.victorias || 0);
    setText("stat-streak", Math.abs(streakVal));
    setText("stat-winrate", winrate + "%");

    // Level Progress
    updateLevelProgress(data.nivel || 2.5, data.puntosRanking || 1000);

    // Elite Stats (Positional ELO)
    renderEliteStats(data);
    
    // Gear/Palas
    renderGear(data.palas || []);
  }

  function updateLevelProgress(nivel, puntos) {
    const lvlNum = Number(nivel || 2.5);
    const currentBracket = Math.floor(lvlNum * 2) / 2;
    const progress = ((lvlNum - currentBracket) / 0.5) * 100;
    const prevStep = Math.max(1, Number((lvlNum - 0.01).toFixed(2)));
    const nextStep = Number((lvlNum + 0.01).toFixed(2));
    const pointsToUp01 = Math.max(1, Math.ceil((nextStep - lvlNum) * 400));
    const pointsToDown01 = Math.max(1, Math.ceil((lvlNum - prevStep) * 400));

    const bar = document.getElementById("level-bar");
    const currentLabel = document.getElementById("p-level-current");
    const detailEl = document.getElementById("level-progress-detail");
    const lowerLabel = document.getElementById("level-lower");
    const upperLabel = document.getElementById("level-upper");
    const upperBottomLabel = document.getElementById("level-upper-bottom");

    if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    if (currentLabel) currentLabel.textContent = `NIVEL ${lvlNum.toFixed(2)}`;
    if (detailEl) {
      detailEl.innerHTML = `
        <span class="lvl-shift-chip up">+${pointsToUp01} PTS · NV ${nextStep.toFixed(2)}</span>
        <span class="lvl-shift-chip down">-${pointsToDown01} PTS · NV ${prevStep.toFixed(2)}</span>
      `;
    }

    if (lowerLabel) lowerLabel.textContent = prevStep.toFixed(2);
    if (upperLabel) upperLabel.textContent = nextStep.toFixed(2);
    if (upperBottomLabel) upperBottomLabel.textContent = nextStep.toFixed(2);
  }

  async function loadEloHistory(uid) {
    try {
      const logs = await window.getDocsSafe(
        query(
          collection(db, "rankingLogs"),
          where("uid", "==", uid),
          orderBy("timestamp", "desc"),
          limit(10),
        ),
      );

      const data = logs.docs.map((d) => d.data()).reverse();
      renderEloChart(data);
    } catch (e) {
      console.log("No ELO history yet");
    }
  }

  async function loadCompetitiveData(uid) {
    try {
        const amSnap = await window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), limit(50)));
        const reSnap = await window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), limit(50)));
        
        const allMatches = [...amSnap.docs, ...reSnap.docs].map(d => d.data());
        
        const partners = {};
        const rivals = { won: {}, lost: {} };

        allMatches.forEach(m => {
            if (m.estado !== 'jugado' || !m.resultado) return;
            
            const isT1 = m.equipoA?.includes(uid);
            const userTeam = isT1 ? m.equipoA : m.equipoB;
            const rivalTeam = isT1 ? m.equipoB : m.equipoA;
            
            // Assume result format "6-4 6-4" means T1 won if not specified otherwise
            let userWon = false;
            // Basic heuristic if 'ganador' not present
            if(m.resultado.ganador) {
                userWon = (isT1 && m.resultado.ganador === 1) || (!isT1 && m.resultado.ganador === 2);
            } else {
                // Parse sets
                // ... (Parsing logic simplified for now)
                userWon = true; // Placeholder if no winner data
            }

            userTeam?.forEach(p => {
                if (p && p !== uid) partners[p] = (partners[p] || 0) + 1;
            });

            rivalTeam?.forEach(r => {
                if(r) {
                    if (userWon) rivals.won[r] = (rivals.won[r] || 0) + 1;
                    else rivals.lost[r] = (rivals.lost[r] || 0) + 1;
                }
            });
        });

        const fetchName = async (id) => {
            const d = await getDocument('usuarios', id);
            return { name: d?.nombreUsuario || d?.nombre || 'Desconocido', id: id };
        };

        const getTop = (obj) => {
            const keys = Object.keys(obj);
            if (keys.length === 0) return null;
            return keys.reduce((a, b) => obj[a] > obj[b] ? a : b);
        };

        const topPartnerId = getTop(partners);
        const topNemesisId = getTop(rivals.lost);
        const topVictimId = getTop(rivals.won);

        const updateCard = async (elId, uId, defaultLabel) => {
            const valEl = document.getElementById(elId);
            const boxEl = valEl?.closest('.nexus-item-v9');
            if(uId) {
                const u = await fetchName(uId);
                if(valEl) valEl.textContent = u.name;
                if(boxEl) {
                    boxEl.dataset.id = u.id;
                    boxEl.style.cursor = 'pointer';
                    boxEl.onclick = () => window.loadRivalAnalysis(u.id);
                }
            } else {
                if(valEl) valEl.textContent = "---";
                if(boxEl) boxEl.onclick = null;
            }
        };

        await updateCard('profile-partner', topPartnerId);
        await updateCard('profile-nemesis', topNemesisId);
        await updateCard('profile-victim', topVictimId);

    } catch(e) { console.error("Competitive error:", e); }
  }

  function renderEloChart(logs) {
    const canvas = document.getElementById("elo-chart");
    if (!canvas) return;

    if (logs.length < 2) {
      canvas.parentElement.innerHTML = `<div class="center flex-col py-6 opacity-40"><i class="fas fa-chart-line text-2xl mb-2"></i><span class="text-xs">Faltan datos de combates</span></div>`;
      return;
    }

    if (eloChart) eloChart.destroy();
    
    // Calculate color based on trend
    const start = logs[0].newTotal;
    const end = logs[logs.length-1].newTotal;
    const color = end >= start ? '#a3e635' : '#ef4444'; // Green or Red

    const labels = logs.map((_, i) => i);
    const points = logs.map((l) => l.newTotal);

    eloChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
            data: points,
            borderColor: color,
            backgroundColor: (ctx) => {
                const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 100);
                gradient.addColorStop(0, color + '33');
                gradient.addColorStop(1, color + '00');
                return gradient;
            },
            fill: true,
            tension: 0.4,
            pointBackgroundColor: color,
            pointRadius: 3,
            borderWidth: 2
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          y: { display:false, min: Math.min(...points) - 10, max: Math.max(...points) + 10 },
          x: { display: false }
        },
      },
    });
  }

  function renderGear(palas) {
    const list = document.getElementById("gear-container");
    if (!list) return;

    if (palas.length === 0) {
      list.innerHTML = `<div class="empty-feed-v9 py-10"><i class="fas fa-microchip mb-4"></i><p>SIN EQUIPAMIENTO</p><span>REGISTRA TU PRIMERA PALA</span></div>`;
      return;
    }

    list.innerHTML = palas.map((p, idx) => {
        const health = p.matchesUsed ? Math.max(0, 100 - (p.matchesUsed / 50) * 100) : 100;
        const color = health > 70 ? 'var(--sport-green)' : health > 30 ? 'var(--sport-gold)' : '#ff4d4d';
        return `
            <div class="stat-card-v9 ${idx % 2 === 0 ? 'cyan' : 'magenta'} mb-3">
                <div class="flex-row between items-center mb-3">
                    <div class="flex-col">
                        <span class="text-xs font-black uppercase tracking-widest text-primary">${p.marca}</span>
                        <h4 class="text-lg font-black italic uppercase">${p.modelo}</h4>
                    </div>
                    <div class="node-mood-v9"><i class="fas fa-table-tennis-paddle-ball"></i></div>
                </div>
                <div class="flex-col gap-2 mb-4">
                    <div class="flex-between text-[9px] font-black opacity-40"><span>INTEGRIDAD</span><span>${Math.round(health)}%</span></div>
                    <div class="m-bar" style="height: 3px;"><div class="m-fill" style="width: ${health}%; background: ${color}"></div></div>
                </div>
                <div class="node-tags-v9">
                    ${p.potencia ? `<span class="tag-v9 winner">POT: ${p.potencia}</span>` : ""}
                    ${p.control ? `<span class="tag-v9 elite">CTR: ${p.control}</span>` : ""}
                </div>
                <button class="btn-icon-sm text-danger absolute top-2 right-2 opacity-30 hover:opacity-100" onclick="window.removePala(${idx})"><i class="fas fa-times"></i></button>
            </div>
        `;
    }).join("");
  }

  function renderTacticalRadar(user) {
    const canvas = document.getElementById("tactical-radar-chart");
    if (!canvas) return;

    // Use Advanced Stats Evolution (Phase 3)
    // Scale: 0-100 internally, display 0-10 on chart
    const attrs = user.atributosTecnicos || { 
        mentalidad: 50, tactica: 50, fisico: 50, 
        tecnica: 50, fondo: 50, volea: 50, remate: 50 
    };

    // Mapping relevant stats for the Radar
    const dataPoints = [
        attrs.mentalidad / 10,
        (attrs.tactica || attrs.lecturaJuego || 50) / 10,
        attrs.fisico / 10,
        (attrs.tecnica || attrs.consistencia || 50) / 10,
        attrs.fondo / 10,
        ((attrs.volea + attrs.remate) / 2) / 10 // Attack composite
    ];
    
    if (radarChart) radarChart.destroy();

    radarChart = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: ['MENTAL', 'TÁCTICA', 'FÍSICO', 'TÉCNICA', 'DEFENSA', 'ATAQUE'],
        datasets: [{
          label: 'ADN',
          data: dataPoints,
          backgroundColor: 'rgba(163, 230, 53, 0.2)', // Sport Lime
          borderColor: '#a3e635',
          borderWidth: 2,
          pointBackgroundColor: '#a3e635',
          pointBorderColor: '#fff',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: 'rgba(255,255,255,0.1)' },
            grid: { color: 'rgba(255,255,255,0.1)' },
            pointLabels: { 
                color: 'rgba(255,255,255,0.8)', 
                font: { size: 10, weight: 'bold', family: "'Orbitron', sans-serif" } 
            },
            ticks: { display: false, max: 10 },
            suggestedMin: 0, requestedMax: 10
          }
        },
        plugins: { legend: { display: false } }
      }
    });

    // Render Attribute Bars (List below radar)
    const attrList = document.getElementById('attribute-list');
    if (attrList) {
        const createBar = (label, val) => `
            <div class="mb-3">
                <div class="flex-row between text-[9px] font-black uppercase mb-1">
                    <span class="text-white">${label}</span>
                    <span class="text-primary">${Math.round(val)}/99</span>
                </div>
                <div class="m-bar" style="height:4px; background:rgba(255,255,255,0.1)">
                    <div class="m-fill" style="width:${val}%; background:var(--primary); box-shadow: 0 0 10px var(--primary)"></div>
                </div>
            </div>
        `;

        attrList.innerHTML = `
            ${createBar('VOLEA', attrs.volea)}
            ${createBar('REMATE', attrs.remate)}
            ${createBar('FONDO DE PISTA', attrs.fondo)}
            ${createBar('FÍSICO', attrs.fisico)}
            ${createBar('MENTALIDAD', attrs.mentalidad)}
        `;
    }
  }

  function renderAchievements(user) {
    const grid = document.getElementById("achievements-grid");
    const countLabel = document.getElementById("achv-count-label");
    if (!grid) return;

    const rules = [
      { id: 'first_win', name: 'PRIMERA SANGRE', icon: 'fa-bolt', desc: 'Gana tu primer partido', check: u => u.victorias > 0, tier: 'bronze' },
      { id: 'streak_3', name: 'EN RACHA', icon: 'fa-fire', desc: '3 victorias seguidas', check: u => u.rachaActual >= 3, tier: 'silver' },
      { id: 'centurion', name: 'CENTURIÓN', icon: 'fa-trophy', desc: 'Gana 100 partidos', check: u => u.victorias >= 100, tier: 'gold' },
      { id: 'bagel', name: 'THE BAGEL', icon: 'fa-bread-slice', desc: 'Gana un set 6-0', check: u => u.stats?.bagels > 0, tier: 'silver' },
      { id: 'gear_fan', name: 'ARMERÍA', icon: 'fa-tags', desc: 'Registra 3 palas', check: u => u.palas?.length >= 3, tier: 'bronze' },
      { id: 'diario_master', name: 'ANALISTA', icon: 'fa-book', desc: '5 entradas de diario', check: u => u.diario?.length >= 5, tier: 'silver' }
    ];

    let unlockedCount = 0;
    grid.innerHTML = rules.map(r => {
      const isUnlocked = r.check(user);
      if (isUnlocked) unlockedCount++;
      return `
        <div class="ach-item-v9 ${isUnlocked ? 'active' : ''} ${r.tier}" title="${r.desc}">
            <div class="ach-icon-box">
                <i class="fas ${r.icon}"></i>
                ${isUnlocked ? '<div class="ach-check"><i class="fas fa-check"></i></div>' : ''}
            </div>
            <span class="ach-lbl-v9">${r.name}</span>
        </div>
      `;
    }).join('');

    if (countLabel) countLabel.textContent = `${unlockedCount} / ${rules.length} DESBLOQUEADOS`;
  }

  function renderEliteStats(data) {
      // Sub-ELO Display
      const elo = data.elo || {};
      const base = Math.round(data.puntosRanking || 1000);
      const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = Math.round(val || base); };
      setText('elo-drive', elo.drive);
      setText('elo-reves', elo.reves);
      setText('elo-indoor', elo.indoor);
      setText('elo-outdoor', elo.outdoor);
  }

  function renderDiarioStats(diario) {
     // Advanced Stats from Diary
     if(!diario || diario.length < 3) return; // Need some data

     // Averages
     let mentalSum = 0, consistencySum = 0, pressureSum = 0;
     let count = 0;
     
     diario.forEach(e => {
         if(e.biometria) {
             mentalSum += (e.biometria.mental || 5);
             pressureSum += (e.biometria.confianza || 5); // Proxy for handling pressure
             count++;
         }
         // Calculate consistency proxy from winners/UE
         if(e.stats) {
             const w = e.stats.winners || 0;
             const ue = e.stats.ue || 1;
             const ratio = Math.min(10, (w/ue)*5); // Scale to 10
             consistencySum += ratio;
         }
     });

     if(count === 0) return;

     const consPct = Math.round((consistencySum / count) * 10);
     const pressPct = Math.round((pressureSum / count) * 10);

     const setBar = (idVal, idBar, val) => {
         const v = Math.min(100, Math.max(0, val));
         const elVal = document.getElementById(idVal);
         const elBar = document.getElementById(idBar);
         if(elVal) elVal.textContent = `${v}/100`;
         if(elBar) elBar.style.width = `${v}%`;
     };

     setBar('val-consistency', 'bar-consistency', consPct);
     setBar('val-pressure', 'bar-pressure', pressPct);
  }

  async function renderAIInsights(user) {
      if(!user) return;
      try {
        const state = user.playerState || {};
        const q = state.qualitative || {};
        const recs = state.activeInterventions || [];
        const metrics = state.metrics || {};
        
        let analysis = q;
        if (!q.style) {
            analysis = { style: 'Calculando...', progression: 'Recopilando datos...' };
            // Trigger background calculation locally if needed, but normally AIOrchestrator handles this
        }

        const container = document.getElementById('ai-profile-insights');
        if (container) {
            container.innerHTML = `
                <div class="ai-insight-card animate-fade-in">
                    <div class="ai-header"><i class="fas fa-brain-circuit text-purple-400"></i><span class="text-[9px] font-black tracking-widest">ESTILO</span></div>
                    <h3 class="text-xl font-black text-white uppercase italic mb-2">${analysis.style || 'Neutro'}</h3>
                    <div class="flex-wrap gap-1 flex">${(analysis.strengths || []).slice(0, 2).map(s => `<span class="tag-v9 winner">${s}</span>`).join('')}</div>
                </div>
                <div class="ai-insight-card animate-fade-in delay-100">
                    <div class="ai-header"><i class="fas fa-chart-line text-cyan-400"></i><span class="text-[9px] font-black tracking-widest">TENDENCIA</span></div>
                    <h3 class="text-lg font-black text-white uppercase italic mb-1">${analysis.progression || 'Estable'}</h3>
                    <span class="text-[10px] text-muted">${analysis.emotionalTrend || 'Sin cambios'}</span>
                </div>
            `;
        }
        
        const auto = document.getElementById('ai-automations');
        if (auto) {
            auto.innerHTML = recs.length > 0 ? recs.map(r => `
                <div class="automation-card">
                    <div class="auto-icon"><i class="fas ${r.icon || 'fa-robot'}"></i></div>
                    <div class="flex-col">
                        <span class="text-[8px] font-black tracking-widest uppercase text-primary mb-1">${(r.type || 'AI').toUpperCase()}</span>
                        <p class="text-[10px] text-white font-bold leading-tight">${r.text}</p>
                    </div>
                </div>
            `).join('') : `<div class="automation-card opacity-50"><span class="text-[10px] p-2">Sin intervenciones activas.</span></div>`;
        }
      } catch(e) { console.error("AI Unified Error", e); }
  }

  function setupStatInteractions() {
    const bind = (id, title, msg) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.style.cursor = 'pointer';
        el.onclick = () => showVisualBreakdown(title, msg);
    };

    bind('profile-stat-level', 'Fórmula de Nivel', 'Calculado basándose en ELO: (ELO-1000)/400 + 2.5. Se pondera por dificultad del rival.');
    bind('profile-stat-points', 'Puntos Ranking', 'Puntos ELO acumulados. Suman por victorias, restan por derrotas considerando el ELO esperado.');
    bind('profile-stat-streak', 'Efecto Racha', 'Ratio de victorias recientes. Activa multiplicadores x1.25 (3), x1.6 (6), x2.5 (10).');
  }

  function showVisualBreakdown(title, content) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:320px; border: 1px solid rgba(255,255,255,0.1)">
            <div class="modal-header border-b border-white/10 p-4">
                <span class="text-xs font-black text-primary uppercase">${title}</span>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="p-5">
                <p class="text-sm text-white/80 leading-relaxed">${content}</p>
                <div class="mt-4 p-3 bg-white/5 rounded-xl border border-white/5 text-[10px] text-muted italic">
                    <i class="fas fa-info-circle mr-1"></i> Estos valores se actualizan en tiempo real tras cada partido.
                </div>
            </div>
        </div>
    `;
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  // Window Exports for HTML interactions
  window.openGearModal = () => document.getElementById("modal-gear")?.classList.add("active");
  
  window.savePala = async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    const marca = document.getElementById("gear-marca").value;
    const modelo = document.getElementById("gear-modelo").value;
    if(!marca || !modelo) return showToast("Error", "Datos incompletos", "error");
    
    const newPala = { marca, modelo, matchesUsed: 0, createdAt: new Date().toISOString() };
    try {
        showToast("Guardando...", "Registrando pala en tu inventario.", "info");
        const updated = [...(userData.palas || []), newPala];
        await updateDocument("usuarios", currentUser.uid, { palas: updated });
        document.getElementById("modal-gear").classList.remove("active");
        showToast("Éxito", "Pala añadida", "success");
    } catch(e) { showToast("Error", "Fallo al guardar", "error"); }
  };

  window.removePala = async (idx) => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if(!confirm("¿Eliminar pala?")) return;
    try {
        showToast("Eliminando...", "Actualizando inventario.", "info");
        const updated = [...(userData.palas || [])];
        updated.splice(idx, 1);
        await updateDocument("usuarios", currentUser.uid, { palas: updated });
        showToast("Inventario", "Pala eliminada correctamente.", "success");
    } catch(e) { showToast("Error", "Fallo al eliminar", "error"); }
  };

  window.loadRivalAnalysis = async (rivalId) => {
    const dashboard = document.getElementById('rival-intel-dashboard');
    if(!dashboard) return;
    
    dashboard.innerHTML = '<div class="py-10 center"><div class="spinner-neon"></div></div>';
    
    try {
        const rival = await getDocument('usuarios', rivalId);
        const { RivalIntelligence } = await import('./rival-intelligence.js');
        const { comparePlayers } = await import('./modules/player-comparator.js');
        
        // Parallel Data Fetching
        const [amSnap, reSnap, comparison] = await Promise.all([
             window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", currentUser.uid))),
             window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", currentUser.uid))),
             comparePlayers(currentUser.uid, rivalId)
        ]);

        const matches = [...amSnap.docs, ...reSnap.docs].filter(m => m.data().jugadores?.includes(rivalId)).map(d => d.data());
        const intel = RivalIntelligence.parseMatches(currentUser.uid, rivalId, matches);
        
        // Power Difference Calculation
        let powerVisual = "";
        if (comparison) {
             const p1 = comparison.powerLevel.p1; // Me
             const p2 = comparison.powerLevel.p2; // Rival
             const diff = p1 - p2;
             const color = diff > 0 ? "text-sport-green" : (diff < 0 ? "text-sport-red" : "text-white");
             const icon = diff > 0 ? "fa-bolt" : "fa-shield-halved";
             powerVisual = `
                <div class="p-3 bg-black/40 rounded-xl border border-white/5 mb-2 flex-between">
                    <span class="text-[9px] font-black uppercase text-muted tracking-widest">POWER LEVEL</span>
                    <div class="flex-row gap-4 items-center">
                        <span class="text-xs font-black text-white opacity-50">YO: ${Math.round(p1)}</span>
                        <div class="h-4 w-[1px] bg-white/10"></div>
                        <span class="text-xs font-black ${color}"><i class="fas ${icon} mr-1"></i>${Math.round(p2)}</span>
                    </div>
                </div>
             `;
        }
        
        dashboard.innerHTML = `
            <div class="flex-row items-center gap-4 mb-4">
                <img src="${rival.fotoURL || rival.fotoPerfil || './imagenes/default-avatar.png'}" class="w-10 h-10 rounded-full border border-primary/30">
                <div class="flex-col">
                    <span class="text-xs font-black text-white italic uppercase">${rival.nombreUsuario || rival.nombre}</span>
                    <span class="text-[8px] font-bold text-muted uppercase">Nivel ${rival.nivel || '---'}</span>
                </div>
            </div>
            
            ${powerVisual}

            <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="p-3 bg-white/5 rounded-xl border border-white/5">
                    <span class="text-[8px] font-black text-muted uppercase block">Balance H2H</span>
                    <span class="text-xs font-black text-white">${intel.wins}W - ${intel.losses}L</span>
                </div>
                <div class="p-3 bg-white/5 rounded-xl border border-white/5">
                    <span class="text-[8px] font-black text-muted uppercase block">Confianza</span>
                    <span class="text-xs font-black text-sport-green">${intel.confidence}%</span>
                </div>
            </div>
            <div class="p-3 bg-primary/10 rounded-xl border border-primary/20">
                <span class="text-[8px] font-black text-primary uppercase block mb-1">Análisis Táctico</span>
                <p class="text-[10px] text-white/80 leading-tight">${intel.tacticalBrief || 'No hay suficientes datos para un perfil táctico completo.'}</p>
            </div>
        `;
    } catch(e) {
        dashboard.innerHTML = '<div class="text-[10px] text-danger">Error al cargar inteligencia.</div>';
    }
  };
  
  // Theme Manager Init
  import("./modules/theme-manager.js?v=6.5").then(m => m.renderThemeSelector("theme-selector-container")).catch(console.error);
  
  function setActionBusy(buttonId, busy, loadingText = '...') {
    const btn = document.getElementById(buttonId);
    if (!btn) return () => {};
    if (!busy) return () => {};
    const prevHtml = btn.innerHTML;
    btn.disabled = true;
    if (btn.classList.contains('setting-save-btn')) {
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
    } else {
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
    }
    return () => {
      btn.disabled = false;
      btn.innerHTML = prevHtml;
    };
  }

  // Save profile handlers
  document.getElementById("p-save-name")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    const val = document.getElementById("p-username-inp").value.trim();
    if(!val) return showToast("Error", "Nombre vacío", "error");
    const unlock = setActionBusy("p-save-name", true, "Guardando");
    try {
      showToast("Guardando...", "Actualizando tu alias de combate.", "info");
      await updateDocument("usuarios", currentUser.uid, { nombreUsuario: val, nombre: val });
      showToast("Identidad", "Alias de combate actualizado", "success");
      if(document.getElementById("p-name")) document.getElementById("p-name").textContent = val.toUpperCase();
    } catch (e) {
      showToast("Error", "No se pudo actualizar el alias.", "error");
    } finally {
      unlock();
    }
  });

  document.getElementById("p-save-phone")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    const val = document.getElementById("p-phone-inp").value.trim();
    if(!val) return showToast("Error", "Teléfono vacío", "error");
    const unlock = setActionBusy("p-save-phone", true, "Guardando");
    try {
      showToast("Guardando...", "Actualizando teléfono de contacto.", "info");
      await updateDocument("usuarios", currentUser.uid, { telefono: val });
      showToast("Enlace", "Frecuencia de contacto guardada", "success");
    } catch (e) {
      showToast("Error", "No se pudo guardar el teléfono.", "error");
    } finally {
      unlock();
    }
  });

  // --- PASSWORD CHANGE ---
  document.getElementById("btn-change-password")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    const newPass = document.getElementById("p-new-password").value;
    const confirmPass = document.getElementById("p-confirm-password").value;
    
    if (!newPass || newPass.length < 6) {
      return showToast("Error", "La contraseña debe tener mínimo 6 caracteres", "error");
    }
    if (newPass !== confirmPass) {
      return showToast("Error", "Las contraseñas no coinciden", "error");
    }

    const unlock = setActionBusy("btn-change-password", true, "Actualizando");
    try {
      showToast("Actualizando...", "Aplicando nueva contraseña.", "info");
      const { updatePassword } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js');
      await updatePassword(auth.currentUser, newPass);
      document.getElementById("p-new-password").value = "";
      document.getElementById("p-confirm-password").value = "";
      showToast("Seguridad", "Contraseña actualizada con éxito ✓", "success");
    } catch (e) {
      console.error("Password change error:", e);
      if (e.code === 'auth/requires-recent-login') {
        showToast("Reautenticación", "Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña", "warning");
      } else {
        showToast("Error", "No se pudo cambiar la contraseña: " + (e.message || "Error desconocido"), "error");
      }
    } finally {
      unlock();
    }
  });

  document.getElementById("save-address")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    const b = document.getElementById("addr-bloque").value;
    const pi = document.getElementById("addr-piso").value;
    const pu = document.getElementById("addr-puerta").value;
    const unlock = setActionBusy("save-address", true, "Guardando");
    try {
      showToast("Guardando...", "Actualizando dirección.", "info");
      await updateDocument("usuarios", currentUser.uid, { vivienda: { bloque: b, piso: pi, puerta: pu } });
      showToast("Ubicación", "Coordenadas guardadas", "success");
    } catch (e) {
      showToast("Error", "No se pudo guardar la dirección.", "error");
    } finally {
      unlock();
    }
  });

  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.onclick = () => { if(confirm("¿Salir?")) auth.signOut(); };

  // Photo Upload (Enhanced Path)
  document.getElementById("upload-photo")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            showToast("Subiendo...", "Procesando imagen con el satélite", "info");
            const url = await uploadProfilePhoto(currentUser.uid, file);
            await updateDocument("usuarios", currentUser.uid, { fotoPerfil: url, fotoURL: url });
            showToast("Éxito", "Imagen actualizada", "success");
        } catch(e) { showToast("Error", "Fallo al subir", "error"); }
    }
  });

});
