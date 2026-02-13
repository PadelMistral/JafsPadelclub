// perfil.js - Pro Player Profile (v15.0) with Address, ELO Graph & Enhanced Palas
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
    const data = await getDocument("usuarios", user.uid);
    await injectHeader(data || {});
    injectNavbar("profile");

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

    // Stats
    const vivInfo = data.vivienda || data.direccion || {};
    const viviendaStr = vivInfo.bloque
      ? `Blq ${vivInfo.bloque} - ${vivInfo.piso}º${vivInfo.puerta}`
      : "Sin vivienda";

    if (nameEl) nameEl.textContent = name.toUpperCase();
    if (roleEl) roleEl.textContent = viviendaStr.toUpperCase();
    if (avatarEl && photo) avatarEl.src = photo;
    if (userInp) userInp.value = name;
    
    // Form inputs
    const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    setVal("p-phone-inp", phone);
    setVal("p-weight-inp", data.peso || "");
    if(vivInfo.bloque) {
        setVal("addr-bloque", vivInfo.bloque);
        setVal("addr-piso", vivInfo.piso);
        setVal("addr-puerta", vivInfo.puerta);
    }

    // Big Stats - Quick View
    countUp(document.getElementById("p-nivel"), (data.nivel || 2.5).toFixed(2));
    countUp(document.getElementById("p-puntos"), Math.round(data.puntosRanking || 1000));
    
    const winrate = data.partidosJugados > 0
        ? Math.round((data.victorias / data.partidosJugados) * 100)
        : 0;
    const winrateEl = document.getElementById("p-winrate");
    if (winrateEl) winrateEl.textContent = winrate + "%";

    // Grid Metrics
    const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
    setText("stat-total-matches", data.partidosJugados || 0);
    setText("stat-total-wins", data.victorias || 0);
    setText("stat-streak", Math.abs(data.rachaActual || 0));
    setText("stat-winrate", winrate + "%");

    // Streak styling
    const rachaEl = document.getElementById("stat-streak");
    if (rachaEl) {
      rachaEl.style.color = (data.rachaActual || 0) >= 0 ? "var(--sport-green)" : "var(--sport-red)";
      rachaEl.parentElement.classList.toggle('fire-effect', (data.rachaActual || 0) >= 3);
    }

    // Level Progress
    updateLevelProgress(data.nivel || 2.5, data.puntosRanking || 1000);

    // Elite Stats (Positional ELO)
    renderEliteStats(data);
    
    // Gear/Palas
    renderGear(data.palas || []);
  }

  function updateLevelProgress(nivel, puntos) {
    const currentLevel = Math.floor(nivel * 2) / 2;
    const nextLevel = currentLevel + 0.5;
    const prevLevel = currentLevel - 0.5;

    // Progress: Each 0.5 level bracket is 200 points approx, but we use strict ELO mapping
    // ELO 1000 = 2.5. ELO 1200 = 3.0. ELO 1400 = 3.5. ELO 1600 = 4.0.
    // So 1 level = 400 points. 0.5 level = 200 points.
    // Points for current base level: (currentLevel - 2.5) * 400 + 1000
    // But easier: derive progress from fractional level
    
    const fraction = nivel - currentLevel; // 0.00 to 0.49
    const progress = (fraction / 0.5) * 100;

    const bar = document.getElementById("level-bar");
    const progressText = document.getElementById("level-progress-text");
    const lowerLabel = document.getElementById("level-lower");
    const currentLabel = document.getElementById("level-current");
    const upperLabel = document.getElementById("level-upper");

    if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;

    if (progressText) {
      const nextStepPts = ((nextLevel - 2.5) * 400) + 1000;
      const pointsNeeded = Math.max(0, Math.round(nextStepPts - puntos));
      
      if (progress >= 90) {
        progressText.textContent = "¡Casi subes de categoría!";
        progressText.classList.add("text-sport-green");
        progressText.classList.add("pulse-fast");
      } else {
        progressText.textContent = `${pointsNeeded} pts para Nivel ${nextLevel}`;
        progressText.classList.remove("text-sport-green", "pulse-fast");
      }
    }

    if (lowerLabel) lowerLabel.textContent = currentLevel.toFixed(1);
    if (currentLabel) currentLabel.textContent = `NIVEL ${nivel.toFixed(2)}`;
    if (upperLabel) upperLabel.textContent = nextLevel.toFixed(1);
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
        const amSnap = await window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("participantes", "array-contains", uid), limit(50)));
        const reSnap = await window.getDocsSafe(query(collection(db, "partidosReto"), where("participantes", "array-contains", uid), limit(50)));
        
        const allMatches = [...amSnap.docs, ...reSnap.docs].map(d => d.data());
        
        const partners = {};
        const rivals = { won: {}, lost: {} };

        allMatches.forEach(m => {
            if (m.estado !== 'jugado' || !m.resultado) return;
            
            const isT1 = m.equipo1?.includes(uid);
            const userTeam = isT1 ? m.equipo1 : m.equipo2;
            const rivalTeam = isT1 ? m.equipo2 : m.equipo1;
            
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

    // Use Advanced Stats if available or fallback
    const stats = user.tacticalAnalysis || { mental: 5, tactica: 5, fisico: 5, tecnica: 5, defensa: 5, ataque: 5 };
    const data = [stats.mental, stats.tactica, stats.fisico, stats.tecnica, stats.defensa, stats.ataque];
    
    if (radarChart) radarChart.destroy();

    radarChart = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: ['MENTAL', 'TÁCTICA', 'FÍSICO', 'TÉCNICA', 'DEFENSA', 'ATAQUE'],
        datasets: [{
          label: 'ADN',
          data: data,
          backgroundColor: 'rgba(0, 212, 255, 0.2)',
          borderColor: '#00d4ff',
          borderWidth: 2,
          pointBackgroundColor: '#00d4ff',
          pointBorderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: 'rgba(255,255,255,0.05)' },
            grid: { color: 'rgba(255,255,255,0.05)' },
            pointLabels: { color: 'rgba(255,255,255,0.6)', font: { size: 9, weight: 'bold' } },
            ticks: { display: false, max: 10 },
            suggestedMin: 0, requestedMax: 10
          }
        },
        plugins: { legend: { display: false } }
      }
    });
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
      // Explanation Modals logic could go here, for now using simple alerts or custom toasts as user requested visual feedback
      // Implementing quick tooltip-like toasts
      const bind = (id, title, msg) => {
          const el = document.getElementById(id);
          if(!el) return;
          el.style.cursor = 'help';
          el.onclick = () => showToast(title, msg, 'info');
      };

      bind('p-nivel', 'Sistema de Nivel', 'Tu nivel (1.0-7.0) se basa en tus puntos ELO. Gana partidos oficiales para subir.');
      bind('p-puntos', 'Ranking ELO', 'Puntos ganados vs rivales. Victorias contra rivales fuertes dan más puntos.');
      bind('stat-streak', 'Sistema de Racha', 'Victorias consecutivas activan multiplicadores de ELO (x1.1, x1.2...).');
      bind('val-consistency', 'Consistencia', 'Calculado basándose en tu ratio Winners/Errores reportado en el Diario.');
  }

  // Window Exports for HTML interactions
  window.openGearModal = () => document.getElementById("modal-gear")?.classList.add("active");
  
  window.savePala = async () => {
    // ... (Existing save logic) ...
    const marca = document.getElementById("gear-marca").value;
    const modelo = document.getElementById("gear-modelo").value;
    if(!marca || !modelo) return showToast("Error", "Datos incompletos", "error");
    
    const newPala = { marca, modelo, matchesUsed: 0, createdAt: new Date().toISOString() };
    try {
        const updated = [...(userData.palas || []), newPala];
        await updateDocument("usuarios", currentUser.uid, { palas: updated });
        document.getElementById("modal-gear").classList.remove("active");
        showToast("Éxito", "Pala añadida", "success");
    } catch(e) { showToast("Error", "Fallo al guardar", "error"); }
  };

  window.removePala = async (idx) => {
    if(!confirm("¿Eliminar pala?")) return;
    try {
        const updated = [...(userData.palas || [])];
        updated.splice(idx, 1);
        await updateDocument("usuarios", currentUser.uid, { palas: updated });
    } catch(e) { showToast("Error", "Fallo al eliminar", "error"); }
  };

  window.loadRivalAnalysis = async (rivalId) => {
      const dashboard = document.getElementById('rival-intel-dashboard');
      if(!dashboard) return;
      dashboard.innerHTML = `<div class="text-center py-4"><div class="spinner-neon"></div><span class="text-xs blink">Descifrando Rival...</span></div>`;
      
      try {
          const rivalDoc = await getDocument('usuarios', rivalId);
          if(!rivalDoc) throw new Error("Rival no encontrado");
          
          // Use RivalIntelligence module
          // Mocking history for now as fetching all matches is expensive, in prod use cached interactions
          const h2h = { wins: 0, losses: 0, winRate: 50, status: 'Neutral' }; // Placeholder
          const classification = RivalIntelligence.classifyRival(h2h);
          
          let html = `
             <div class="flex items-center justify-between mb-4 px-2 animate-fade-in">
                <div class="flex items-center gap-3">
                    <img src="${rivalDoc.fotoPerfil || rivalDoc.fotoURL || './imagenes/default-avatar.png'}" class="w-10 h-10 rounded-xl border border-white/20 object-cover">
                    <div class="flex flex-col">
                        <span class="text-[12px] font-black text-white uppercase">${rivalDoc.nombreUsuario || 'Rival'}</span>
                        <div class="flex items-center gap-1">
                            <span class="text-[9px] font-bold text-white/50">NIVEL ${rivalDoc.nivel || 2.5}</span>
                            <span class="text-[9px] font-bold text-${classification.color}-500">• ${classification.class}</span>
                        </div>
                    </div>
                </div>
             </div>
             <div class="mb-2 px-2">
                 <div class="bg-black/40 rounded-lg p-3 border border-white/5">
                    <span class="text-[10px] text-muted block mb-1">PROBABILIDAD DE VICTORIA</span>
                    <div class="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500" style="width: 50%"></div>
                    </div>
                    <span class="text-xs font-black text-center block mt-1">50%</span>
                 </div>
             </div>
          `;
          dashboard.innerHTML = html;
      } catch(e) {
          dashboard.innerHTML = `<div class="text-center text-red-500 text-xs py-4">${e.message}</div>`;
      }
  };
  
  // Theme Manager Init
  import("./modules/theme-manager.js?v=6.5").then(m => m.renderThemeSelector("theme-selector-container")).catch(console.error);
  
  // Save profile handlers (Name, Phone, etc)
  document.getElementById("save-address")?.addEventListener("click", async () => {
    const b = document.getElementById("addr-bloque").value;
    const pi = document.getElementById("addr-piso").value;
    const pu = document.getElementById("addr-puerta").value;
    await updateDocument("usuarios", currentUser.uid, { vivienda: { bloque: b, piso: pi, puerta: pu } });
    showToast("Ubicación", "Guardada", "success");
  });

  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.onclick = () => { if(confirm("¿Salir?")) auth.signOut(); };

  // Photo Upload
  document.getElementById("upload-photo")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            showToast("Subiendo...", "Procesando imagen", "info");
            const url = await uploadProfilePhoto(currentUser.uid, file);
            await updateDocument("usuarios", currentUser.uid, { fotoPerfil: url });
            showToast("Éxito", "Imagen actualizada", "success");
        } catch(e) { showToast("Error", "Fallo al subir", "error"); }
    }
  });

});
