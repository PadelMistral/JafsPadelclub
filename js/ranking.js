// ranking.js - Leaderboard & Points History V5.0 (con desglose detallado CORREGIDO)
import { db, auth, observerAuth, getDocument } from "./firebase-service.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, countUp, showToast } from "./ui-core.js";
import {
  injectHeader,
  injectNavbar,
  initBackground,
  setupModals,
} from "./modules/ui-loader.js?v=6.5";

let currentUser = null;
let userData = null;
window.podiumData = [];

document.addEventListener("DOMContentLoaded", () => {
  initAppUI("ranking");
  initBackground();
  setupModals();

  observerAuth(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    currentUser = user;
    userData = await getDocument("usuarios", user.uid);

    await injectHeader(userData);
    injectNavbar("ranking");

    await initRankingRealTime();
    await window.loadPointsHistory('mine');
  });
});

window.switchHistoryTab = async (mode) => {
  const tabs = document.querySelectorAll('.hist-tab');
  tabs.forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`tab-hist-${mode}`);
  if (activeTab) activeTab.classList.add('active');
  
  await window.loadPointsHistory(mode);
};

async function initRankingRealTime() {
    const { subscribeCol } = await import('./firebase-service.js');
    return subscribeCol("usuarios", async (users) => {
        users.sort((a, b) => (b.puntosRanking || 1000) - (a.puntosRanking || 1000));
        const list = users.map((u, i) => ({ ...u, rank: i + 1 }));
        await renderRanking(list);
    }, [], [["puntosRanking", "desc"]]);
}

async function renderRanking(list) {
  const myIdx = list.findIndex((u) => u.id === currentUser.uid);
  const totalPlayers = list.length || 1;
  const totalInfoEl = document.getElementById("lb-total-info");
  if (totalInfoEl) totalInfoEl.textContent = `${totalPlayers} jugadores clasificados`;

  if (myIdx !== -1) {
    const me = list[myIdx];
    const myPts = Number(me.puntosRanking || 1000);
    const played = Number(me.partidosJugados || 0);

    document.getElementById("my-rank").textContent = `#${me.rank}`;
    countUp(document.getElementById("my-pts"), myPts);
    document.getElementById("my-level").textContent = (me.nivel || 2.5).toFixed(2);
    const playedEl = document.getElementById("my-played");
    const levelCardEl = document.getElementById("my-level-card");
    if (playedEl) playedEl.textContent = `${played}`;
    if (levelCardEl) levelCardEl.textContent = (me.nivel || 2.5).toFixed(2);

    const lvl = me.nivel || 2.5;
    const progress = (lvl % 1) * 100;
    const base = Math.floor(lvl);
    document.getElementById("level-fill").style.width = `${progress}%`;
    document.getElementById("level-prev").textContent = base.toFixed(1);
    document.getElementById("level-next").textContent = (base + 1).toFixed(1);

    const trendEl = document.getElementById("rank-trend");
    if (trendEl) {
      trendEl.style.display = "inline-flex";
      trendEl.className = "rank-trend";
      trendEl.innerHTML = `<i class="fas fa-minus"></i> 0`;
    }

    const metaEl = document.getElementById("rank-meta-text");
    if (metaEl) {
      const percentile = Math.max(1, Math.min(100, Math.round((1 - (me.rank - 1) / totalPlayers) * 100)));
      metaEl.textContent = `Estás en el TOP ${percentile}% (${me.rank}/${totalPlayers}) del circuito activo`;
    }
  }

  window.podiumData = list.slice(0, 3);
  for (let i = 0; i < 3; i++) {
    if (list[i]) await renderPodiumSlot(i + 1, list[i]);
  }

  const movementMap = await getRecentRankMovements(list);
  const myMove = Number(movementMap.get(currentUser.uid) || 0);
  const trendEl = document.getElementById("rank-trend");
  if (trendEl) {
    if (myMove > 0) {
      trendEl.className = "rank-trend up";
      trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> +${myMove}`;
    } else if (myMove < 0) {
      trendEl.className = "rank-trend down";
      trendEl.innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(myMove)}`;
    } else {
      trendEl.className = "rank-trend";
      trendEl.innerHTML = `<i class="fas fa-minus"></i> 0`;
    }
  }

  renderLeaderboard(list.slice(3), totalPlayers, movementMap);
}

async function getRecentRankMovements(users) {
  const movementMap = new Map();
  users.forEach((u) => movementMap.set(u.id, 0));
  if (!users.length) return movementMap;

  try {
    const logsSnap = await window.getDocsSafe(
      query(
        collection(db, "rankingLogs"),
        orderBy("timestamp", "desc"),
        limit(Math.max(120, users.length * 6)),
      ),
    );
    if (!logsSnap || logsSnap._errorCode) return movementMap;

    const latestLogByUid = new Map();
    logsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (data?.uid && !latestLogByUid.has(data.uid)) latestLogByUid.set(data.uid, data);
    });

    users.forEach((u) => {
      const log = latestLogByUid.get(u.id);
      if (!log || typeof log.diff !== "number") return;

      const previousPoints = Number(u.puntosRanking || 1000) - Number(log.diff || 0);
      let previousRank = 1;

      users.forEach((other) => {
        if (other.id === u.id) return;
        const otherPoints = Number(other.puntosRanking || 1000);
        if (otherPoints > previousPoints) previousRank += 1;
      });

      movementMap.set(u.id, previousRank - Number(u.rank || 0));
    });
  } catch (e) {
    console.warn("Could not compute rank movement map:", e);
  }

  return movementMap;
}

async function renderPodiumSlot(pos, user) {
  const av = document.getElementById(`p-av-${pos}`);
  const name = document.getElementById(`p-name-${pos}`);
  const pts = document.getElementById(`p-pts-${pos}`);

  if (!user) return;

  const photo = user.fotoPerfil || user.fotoURL;
  const userName = (
    user.nombreUsuario ||
    user.nombre ||
    "Jugador"
  ).toUpperCase();

  if (av) {
    if (photo)
      av.innerHTML = `<img src="${photo}" class="podium-img" style="width:100%; height:100%; object-fit:cover; border-radius:inherit">`;
    else
      av.innerHTML = `<div class="podium-initials" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.05); font-weight:900; color:white">${userName.substring(0, 2)}</div>`;
  }
  if (name) name.textContent = userName;
  if (pts) countUp(pts, user.puntosRanking || 1000);
}

function renderLeaderboard(
  list,
  totalPlayers = list.length,
  movementMap = new Map(),
) {
  const container = document.getElementById("lb-list");
  if (!container) return;

  container.innerHTML = list
    .map((u, i) => {
      const isMe = currentUser && u.id === currentUser.uid;
      const name = u.nombreUsuario || u.nombre || "Jugador";
      const photo = u.fotoPerfil || u.fotoURL || "./imagenes/Logojafs.png";
      const ps = u.partidosJugados || 0;
      const level = Number(u.nivel || 2.5).toFixed(2);
      const points = Math.round(u.puntosRanking || 1000);
      const movement = Number(movementMap.get(u.id) || 0);

      let rankClass = "rank-entry";
      if (u.rank === 1) rankClass = "rank-gold";
      else if (u.rank === 2) rankClass = "rank-silver";
      else if (u.rank === 3) rankClass = "rank-bronze";
      else if (u.rank <= 10) rankClass = "rank-elite";

      const depth = totalPlayers > 1 ? (u.rank - 1) / (totalPlayers - 1) : 0;
      const hue = Math.max(6, Math.round(130 - depth * 124));
      const sat = Math.max(62, Math.round(84 - depth * 16));
      const light = Math.max(41, Math.round(56 - depth * 13));
      const tintOpacity = Math.max(0.08, 0.24 - depth * 0.14);
      const rowStyle = `animation-delay:${i * 0.05}s; --rank-accent:hsl(${hue} ${sat}% ${light}%); --rank-tint:hsla(${hue} ${sat}% ${light}% / ${tintOpacity});`;
      const movementClass =
        movement > 0 ? "up" : movement < 0 ? "down" : "neutral";
      const movementIcon =
        movement > 0
          ? "fa-arrow-up"
          : movement < 0
            ? "fa-arrow-down"
            : "fa-minus";
      const movementText =
        movement > 0 ? `+${movement}` : movement < 0 ? `${Math.abs(movement)}` : "=";

      return `
            <div class="ranking-card ${isMe ? "me" : ""} ${rankClass} animate-up" 
                 onclick="window.viewProfile('${u.id}')" 
                 style="${rowStyle}">
                
                <div class="lb-rank">#${u.rank}</div>
                
                <div class="lb-avatar">
                    <img src="${photo}" alt="${name}" loading="lazy">
                </div>

                <div class="lb-info truncate">
                    <span class="lb-name">${name.toUpperCase()}</span>
                    <div class="lb-meta-row">
                        <span class="lb-meta-chip">${ps} PARTIDOS</span>
                        <span class="lb-meta-chip">NIVEL ${level}</span>
                    </div>
                </div>
                
                <div class="flex-col items-end">
                    <span class="lb-pts">${points}</span>
                    <span class="lb-rank-move ${movementClass}"><i class="fas ${movementIcon}"></i>${movementText}</span>
                </div>
            </div>
        `;
    })
    .join("");
}

window.loadPointsHistory = async (mode = 'mine') => {
  const container = document.getElementById("points-history");
  if (!container) return;

  container.innerHTML = '<div class="center py-6 opacity-30"><i class="fas fa-circle-notch fa-spin"></i></div>';

  if (!window.logCache) window.logCache = new Map();

  try {
    let qBase;
    if (mode === 'global') {
        qBase = query(
            collection(db, "rankingLogs"),
            orderBy("timestamp", "desc"),
            limit(20)
        );
    } else {
        qBase = query(
            collection(db, "rankingLogs"),
            where("uid", "==", currentUser.uid),
            orderBy("timestamp", "desc"),
            limit(20)
        );
    }
    
    const logs = await window.getDocsSafe(qBase);

    if (logs.empty) {
      container.innerHTML =
        '<div class="empty-state"><span class="empty-text">Sin historial</span></div>';
      return;
    }

    const entries = await Promise.all(
      logs.docs.map(async (docSnap) => {
        const log = docSnap.data();
        window.logCache.set(docSnap.id, log);
        const isWin = log.diff > 0;

        let levelIcon = "";
        if (log.details?.levelAfter && log.details?.levelBefore) {
            const lDiff = log.details.levelAfter - log.details.levelBefore;
            if (lDiff > 0) levelIcon = `<span class="text-[8px] text-sport-green ml-1"><i class="fas fa-caret-up"></i></span>`;
            else if (lDiff < 0) levelIcon = `<span class="text-[8px] text-sport-red ml-1"><i class="fas fa-caret-down"></i></span>`;
        }

        let matchInfo = "";
        let date = "";
        if (log.matchId) {
          const match =
            (await getDocument("partidosReto", log.matchId)) ||
            (await getDocument("partidosAmistosos", log.matchId));
          if (match) {
            matchInfo = match.resultado?.sets || "";
            if (match.fecha) {
              const d = match.fecha.toDate();
              date = d.toLocaleDateString("es-ES", {
                day: "numeric",
                month: "short",
              });
            }
          }
        }
        if (!date && log.timestamp) {
          const d = log.timestamp.toDate();
          date = d.toLocaleDateString("es-ES", {
            day: "numeric",
            month: "short",
          });
        }

        const isDiary = String(log.type || "").startsWith("DIARY_");
        const isPeerDiary = log.type === "DIARY_PEER_BONUS";
        const title = isDiary ? (isPeerDiary ? "Evaluacion Diario" : "Analisis Diario") : (isWin ? "Victoria" : "Derrota");
        
        let userNameLabel = "";
        if (mode === 'global' && log.uid !== currentUser.uid) {
            const u = await getDocument('usuarios', log.uid);
            userNameLabel = `<span class="text-[9px] font-black opacity-40 uppercase block">${u?.nombreUsuario || 'Jugador'}</span>`;
        }

        return `
                <div class="history-entry ${isDiary ? "bonus" : (isWin ? "win" : "loss")}" onclick="window.showMatchBreakdownV3('${docSnap.id}')">
                    <div class="history-icon">
                        <i class="fas ${isDiary ? "fa-book" : (isWin ? "fa-arrow-up" : "fa-arrow-down")}"></i>
                    </div>
                    <div class="history-details">
                        ${userNameLabel}
                        <span class="history-title">${title} ${matchInfo ? `<span class="history-score">${matchInfo}</span>` : ""} ${levelIcon}</span>
                        <span class="history-date">${date || "N/A"} ${isDiary ? `<span class="text-[9px] opacity-60 ml-1">(${log.reason || 'Bonus'})</span>` : ''}</span>
                    </div>
                    <span class="history-value">${isWin ? "+" : ""}${log.diff}</span>
                </div>
            `;
      }),
    );

    container.innerHTML = entries.join("");
  } catch (e) {
    console.error("Error loading history:", e);
    container.innerHTML =
      '<div class="error-state">Error cargando historial</div>';
  }
}

// ============================================
// MODAL DE DESGLOSE TÁCTICO CORREGIDO
// ============================================
window.showMatchBreakdownV3 = async (logId) => {
  const log = window.logCache?.get(logId);
  if (!log) return showToast("Error", "No se encontró el registro en memoria", "error");

  // Crear overlay del modal
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = "11000";

  const isDiary = String(log.type || "").startsWith("DIARY_");
  const isPeerDiary = log.type === "DIARY_PEER_BONUS";
  const diff = log.diff;
  const total = log.newTotal;
  const matchId = log.matchId;

  overlay.innerHTML = `
    <div class="modal-card glass-strong animate-up p-0 overflow-hidden" style="max-width:380px">
      <div class="modal-header">
        <span class="modal-title font-black italic tracking-widest">${isDiary ? 'RECOMPENSA DIARIO' : 'DESGLOSE TÁCTICO'}</span>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
      </div>
      <div id="breakdown-content" class="modal-body custom-scroll p-4">
        <div class="center py-10"><i class="fas fa-circle-notch fa-spin text-primary"></i></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const content = document.getElementById("breakdown-content");

  try {
    // Caso especial: bonus diario
    if (isDiary) {
      content.innerHTML = `
        <div class="text-center py-6">
          <div class="text-5xl font-black mb-2 text-sport-green animate-bounce-soft">+${diff}</div>
          <span class="text-[10px] text-muted uppercase tracking-[4px] font-black">${isPeerDiary ? "Impacto por Evaluacion" : "Bonus de Constancia"}</span>
          <div class="mt-8 p-5 bg-white/5 rounded-2xl border border-white/5 mx-2">
            <p class="text-[11px] text-white/70 italic leading-relaxed">${isPeerDiary ? (log.reason || "Tu puntuacion se ajusto por evaluacion de MVP/rendimiento del partido.") : "Sincronizacion completada. La Matrix ha procesado tu analisis diario y ha inyectado puntos de experiencia en tu perfil."}</p>
            <div class="mt-6 pt-4 border-t border-white/10 flex-row between">
              <span class="text-[9px] font-black text-muted uppercase">PUNTOS TOTALES</span>
              <span class="text-[11px] font-black text-primary">${total} PTS</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Caso: ajuste manual sin partido
    if (!matchId) {
      content.innerHTML = `
        <div class="text-center py-6">
          <div class="text-5xl font-black mb-2 ${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${diff >= 0 ? "+" : ""}${diff}</div>
          <span class="text-[10px] text-muted uppercase tracking-[4px] font-black">Ajuste de Sistema</span>
          <div class="mt-8 p-5 bg-white/5 rounded-2xl border border-white/10 mx-2 text-left">
            <p class="text-[11px] text-white/60 mb-4">Esta es una modificación directa en la Matrix realizada por un administrador o corrección de red.</p>
            <div class="flex-row between items-center pt-4 border-t border-white/5">
              <span class="text-[10px] font-black text-muted uppercase">NUEVO TOTAL:</span>
              <span class="text-lg font-black text-white italic">${total}</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Obtener datos del partido
    const match = (await getDocument("partidosReto", matchId)) || (await getDocument("partidosAmistosos", matchId));
    if (!match) throw new Error("Partido no encontrado");

    // Obtener todos los usuarios involucrados para nombres y niveles
    const players = match.jugadores || [];
    const myUid = log.uid;
    const myIdx = players.indexOf(myUid);
    
    if (myIdx === -1) throw new Error("Usuario no encontrado en el partido");

    // Determinar compañero y rivales
    const isTeam1 = myIdx < 2;
    const partnerId = isTeam1 ? (myIdx === 0 ? players[1] : players[0]) : (myIdx === 2 ? players[3] : players[2]);
    const rivalIds = isTeam1 ? [players[2], players[3]] : [players[0], players[1]];

    // Obtener datos completos de todos los jugadores
    const [myData, partnerData, rival1Data, rival2Data] = await Promise.all([
      getDocument("usuarios", myUid),
      partnerId && !partnerId.startsWith('GUEST_') ? getDocument("usuarios", partnerId) : Promise.resolve(null),
      rivalIds[0] && !rivalIds[0].startsWith('GUEST_') ? getDocument("usuarios", rivalIds[0]) : Promise.resolve(null),
      rivalIds[1] && !rivalIds[1].startsWith('GUEST_') ? getDocument("usuarios", rivalIds[1]) : Promise.resolve(null)
    ]);

    // Nombres para mostrar
    const myName = myData?.nombreUsuario || myData?.nombre || "Tú";
    const partnerName = partnerData?.nombreUsuario || partnerData?.nombre || (partnerId?.startsWith('GUEST_') ? partnerId.split('_')[1] : "Invitado");
    const rival1Name = rival1Data?.nombreUsuario || rival1Data?.nombre || (rivalIds[0]?.startsWith('GUEST_') ? rivalIds[0].split('_')[1] : "Rival 1");
    const rival2Name = rival2Data?.nombreUsuario || rival2Data?.nombre || (rivalIds[1]?.startsWith('GUEST_') ? rivalIds[1].split('_')[1] : "Rival 2");

    // Niveles
    const myLevel = myData?.nivel || 2.5;
    const partnerLevel = partnerData?.nivel || 2.5;
    const rival1Level = rival1Data?.nivel || 2.5;
    const rival2Level = rival2Data?.nivel || 2.5;

    // Datos del resultado
    const result = match.resultado?.sets || "0-0";
    const scores = result.split('-').map(Number);
    const isWin = isTeam1 ? scores[0] > scores[1] : scores[1] > scores[0];
    
    // Formatear fecha
    const date = match.fecha?.toDate ? 
      match.fecha.toDate().toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : 
      "Fecha desconocida";

    // ===== CORRECCIÓN IMPORTANTE =====
    // Buscar puntosDetalle en TODAS las ubicaciones posibles
    // 1. Primero en log.details.puntosCalculados (formato antiguo)
    // 2. Luego en log.details.puntosDetalle (formato alternativo)
    // 3. Finalmente en match.puntosDetalle[myUid] (formato nuevo)
    // ================================
    const puntosDetalle = log.details?.puntosCalculados || 
                          log.details?.puntosDetalle || 
                          match.puntosDetalle?.[myUid];
    
    // Datos de nivel antes/después
    const levelBefore = log.details?.levelBefore || myLevel;
    const levelAfter = log.details?.levelAfter || myLevel;
    const levelDiff = levelAfter - levelBefore;
    const levelChangePct = levelBefore > 0 ? ((levelDiff / levelBefore) * 100) : 0;
    const levelArrow = levelDiff > 0 ? 
      '<i class="fas fa-angles-up text-sport-green ml-1"></i>' : 
      (levelDiff < 0 ? '<i class="fas fa-angles-down text-sport-red ml-1"></i>' : '');

    // Construir HTML del modal
    content.innerHTML = `
      <div class="flex-col gap-4">
        <!-- Cabecera con resultado -->
        <div class="p-5 rounded-3xl bg-gradient-to-br ${isWin ? 'from-sport-green/20 to-transparent border-sport-green/30' : 'from-sport-red/20 to-transparent border-sport-red/30'} border">
          <div class="flex-row between items-center mb-4">
            <span class="text-[10px] font-black ${isWin ? 'text-sport-green' : 'text-sport-red'} uppercase tracking-widest">${isWin ? 'VICTORIA' : 'DERROTA'}</span>
            <span class="text-[10px] text-white/40 font-bold uppercase tracking-widest">${date}</span>
          </div>
          <div class="text-center mb-2">
            <span class="text-xs font-bold text-white/60 mb-2 block tracking-[4px]">RESULTADO FINAL</span>
            <span class="text-5xl font-black italic text-white tracking-widest font-mono">${result}</span>
          </div>
        </div>

        <!-- Niveles de todos los jugadores -->
        <div class="grid grid-cols-2 gap-3">
          <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col gap-2">
            <span class="text-[8px] font-black text-muted uppercase tracking-widest">MI EQUIPO</span>
            <div class="flex-col gap-1">
              <div class="flex-row between">
                <span class="text-[10px] text-white/40">${myName}</span>
                <span class="text-[10px] font-black text-white">${myLevel.toFixed(2)}</span>
              </div>
              <div class="flex-row between">
                <span class="text-[10px] text-white/40">${partnerName}</span>
                <span class="text-[10px] font-black text-white/70">${partnerLevel.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col gap-2">
            <span class="text-[8px] font-black text-muted uppercase tracking-widest">EQUIPO RIVAL</span>
            <div class="flex-col gap-1">
              <div class="flex-row between">
                <span class="text-[10px] text-white/40">${rival1Name}</span>
                <span class="text-[10px] font-black text-white">${rival1Level.toFixed(2)}</span>
              </div>
              <div class="flex-row between">
                <span class="text-[10px] text-white/40">${rival2Name}</span>
                <span class="text-[10px] font-black text-white">${rival2Level.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Desglose de puntos -->
        <div class="p-5 bg-black/40 rounded-3xl border border-white/10">
          <h4 class="text-[10px] font-black text-primary uppercase tracking-[3px] mb-5 border-b border-white/5 pb-2">Desglose de Puntos</h4>
          
          ${puntosDetalle ? `
            <div class="flex-col gap-3">
              ${puntosDetalle.base !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Base Victoria</span>
                  <span class="text-white font-mono font-bold">${puntosDetalle.base.toFixed(1)}</span>
                </div>
              ` : ''}
              
              ${puntosDetalle.dificultad !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Ajuste Dificultad</span>
                  <span class="text-sport-gold font-mono font-bold">${puntosDetalle.dificultad >= 0 ? '+' : ''}${puntosDetalle.dificultad.toFixed(1)}</span>
                </div>
              ` : ''}
              
              ${puntosDetalle.rival !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Dificultad Rival</span>
                  <span class="text-sport-gold font-mono font-bold">${puntosDetalle.rival >= 0 ? '+' : ''}${puntosDetalle.rival.toFixed(1)}</span>
                </div>
              ` : ''}
              
              ${puntosDetalle.companero !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Bono Compañero</span>
                  <span class="text-sport-blue font-mono font-bold">${puntosDetalle.companero >= 0 ? '+' : ''}${puntosDetalle.companero.toFixed(1)}</span>
                </div>
              ` : ''}
              
              ${puntosDetalle.racha !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Racha / Desempeño</span>
                  <span class="text-primary font-mono font-bold">${puntosDetalle.racha >= 0 ? '+' : ''}${puntosDetalle.racha.toFixed(1)}</span>
                </div>
              ` : ''}
              
              ${puntosDetalle.sets !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Control de Sets</span>
                  <span class="text-sport-blue font-mono font-bold">${puntosDetalle.sets >= 0 ? '+' : ''}${puntosDetalle.sets.toFixed(1)}</span>
                </div>
              ` : ''}
              
              ${puntosDetalle.multiplicador !== undefined ? `
                <div class="flex-row between text-[11px] items-center">
                  <span class="text-white/50">Multiplicador</span>
                  <span class="text-primary font-mono font-bold">x${puntosDetalle.multiplicador.toFixed(2)}</span>
                </div>
              ` : ''}
            </div>
          ` : `
            <div class="text-[10px] text-muted italic text-center py-4">
              No hay desglose disponible para este registro
            </div>
          `}
          
          <div class="mt-6 pt-4 border-t border-white/10 flex-row between items-center">
            <span class="text-[11px] font-black text-white uppercase italic">PUNTOS TOTALES:</span>
            <span class="text-3xl font-black ${isWin ? 'text-sport-green' : 'text-sport-red'} font-mono">${isWin ? '+' : ''}${diff.toFixed(1)}</span>
          </div>
        </div>

        <!-- Evolución de nivel -->
        <div class="px-2 flex-row between items-center">
          <div class="flex-col">
            <span class="text-[8px] font-black text-muted uppercase">Nivel Anterior</span>
            <span class="text-xs font-bold text-white/60">${levelBefore.toFixed(2)}</span>
          </div>
          <div class="px-4 py-2 bg-white/5 rounded-full border border-white/5 flex-row items-center gap-3">
            <span class="text-xs font-black text-white italic">${levelAfter.toFixed(2)}</span>
            ${levelArrow}
            <span class="text-[9px] font-black ${levelDiff > 0 ? "text-sport-green" : (levelDiff < 0 ? "text-sport-red" : "text-white/50")}">${levelDiff > 0 ? "SUBE" : (levelDiff < 0 ? "BAJA" : "MANTIENE")} ${Math.abs(levelChangePct).toFixed(1)}%</span>
          </div>
          <div class="flex-col items-end">
            <span class="text-[8px] font-black text-muted uppercase">Puntos Actuales</span>
            <span class="text-xs font-bold text-white/60">${total}</span>
          </div>
        </div>
      </div>
      
      <button class="btn-premium-v7 w-full py-5 uppercase text-[11px] font-black tracking-[4px] mt-6 shadow-xl" onclick="this.closest('.modal-overlay').remove()">
        ENTENDIDO
      </button>
    `;

  } catch (e) {
    console.error("Error en showMatchBreakdownV3:", e);
    content.innerHTML = `
      <div class="center py-10 opacity-40">
        <i class="fas fa-exclamation-triangle mr-2"></i> ERROR AL CARGAR
      </div>
      <button class="btn-premium-v7 w-full py-4 mt-4" onclick="this.closest('.modal-overlay').remove()">
        CERRAR
      </button>
    `;
  }
};

// --- EXPEDIENTE JUGADOR ---
window.viewProfile = (uid) => {
  if (!uid) return;
  window.openExpedient(uid);
};

window.openExpedient = async (uid) => {
  let overlay = document.getElementById("expedient-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "expedient-overlay";
    overlay.className = "expedient-overlay";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML =
    '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
  overlay.classList.add("active");

  try {
    const u = await getDocument("usuarios", uid);
    if (!u) throw new Error("Usuario no encontrado");

    const ps = u.partidosJugados || 0;
    const vs = u.victorias || 0;
    const ds = u.derrotas || 0;
    const winrate = ps > 0 ? Math.round((vs / ps) * 100) : 0;
    const photo = u.fotoPerfil || u.fotoURL || "./imagenes/Logojafs.png";
    const name = (u.nombreUsuario || u.nombre || "Jugador").toUpperCase();
    const level = (u.nivel || 2.5).toFixed(2);
    const pts = Math.round(u.puntosRanking || 1000);
    const pala = u.pala || "No disponible";
    
    const viv = u.vivienda || {};
    const addressStr = (viv.bloque || viv.piso || viv.puerta) 
      ? `Blq ${viv.bloque || '-'}, Piso ${viv.piso || '-'}, Pta ${viv.puerta || '-'}` 
      : null;

    const puntosActuales = Math.round(u.puntosRanking || 1000);
    const nivelActual = parseFloat(u.nivel || 2.5);
    const floatLvl = Math.floor(nivelActual * 100) / 100;
    const threshActual = calcularPuntosIniciales(floatLvl);
    const threshNext = calcularPuntosIniciales(floatLvl + 0.01);
    const progress = Math.max(2, Math.min(100, ((puntosActuales - threshActual) / (threshNext - threshActual)) * 100));

    overlay.innerHTML = `
            <div class="expedient-card animate-up">
                <div class="exp-header" style="background-image: linear-gradient(to bottom, transparent, rgba(0,0,0,0.9)), url('${photo}')">
                    <div class="exp-close" onclick="document.getElementById('expedient-overlay').classList.remove('active')">
                        <i class="fas fa-times"></i>
                    </div>
                    <div class="flex-row items-center w-full">
                        <div class="exp-avatar-ring">
                            <img src="${photo}">
                        </div>
                        <div class="exp-info">
                            <h2>${name}</h2>
                            <div class="flex-row items-center gap-2">
                                <div class="exp-badge">NIVEL ${level}</div>
                                <span class="text-[9px] italic text-primary font-black">#${u.posicionRanking || '--'}</span>
                            </div>
                            <div class="exp-pala"><i class="fas fa-hammer"></i> ${pala}</div>
                        </div>
                    </div>
                </div>

                <div class="px-5 py-4 bg-white/5">
                    <div class="flex-row between mb-1 px-1">
                        <span class="text-[8px] font-black text-muted uppercase">Progreso de Nivel</span>
                        <span class="text-[8px] font-black text-primary">${progress.toFixed(0)}%</span>
                    </div>
                    <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div class="h-full bg-primary" style="width: ${progress}%"></div>
                    </div>
                </div>

                <div class="exp-stats-grid">
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${pts}</span>
                        <span class="exp-stat-label">PUNTOS</span>
                    </div>
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${ps}</span>
                        <span class="exp-stat-label">PARTIDOS</span>
                    </div>
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${vs}</span>
                        <span class="exp-stat-label">WINS</span>
                    </div>
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${winrate}%</span>
                        <span class="exp-stat-label">WR</span>
                    </div>
                </div>

                ${u.telefono ? `<div class="px-5 pt-3 flex-row items-center gap-2"><i class="fas fa-phone text-[10px] text-muted"></i><span class="text-[10px] text-white/50 font-bold">${u.telefono}</span></div>` : ''}

                <div class="px-5 pt-6 pb-2 border-b border-white/5">
                    <span class="text-[9px] font-black text-primary uppercase tracking-[2px]">Hoja de Servicio</span>
                </div>

                <div class="exp-history-list custom-scroll" id="exp-history-list" style="max-height: 350px;">
                    <div class="center py-10 opacity-30"><i class="fas fa-circle-notch fa-spin"></i></div>
                </div>
            </div>
        `;

    const historyContainer = document.getElementById("exp-history-list");
    const historyHtml = await renderUserDetailedHistory(uid);
    if (historyContainer) historyContainer.innerHTML = historyHtml;
  } catch (e) {
    console.error(e);
    showToast("ERROR", "No se pudo cargar el expediente", "error");
    overlay.classList.remove("active");
  }
};

/**
 * Renders a detailed history card for the player expediente/profile
 * @param {string} uid User ID
 * @returns {Promise<string>} HTML string
 */
async function renderUserDetailedHistory(uid) {
  try {
    const snap = await window.getDocsSafe(
      query(
        collection(db, "rankingLogs"),
        where("uid", "==", uid),
        orderBy("timestamp", "desc"),
        limit(10),
      ),
    );

    if (snap.empty) {
      return '<div class="text-xs text-muted py-4 text-center">Sin historial</div>';
    }

    const entries = await Promise.all(
      snap.docs.map(async (doc) => {
        const log = doc.data();
        const isWin = log.diff > 0;
        const timestamp = log.timestamp?.toDate
          ? log.timestamp.toDate()
          : new Date();
        const dateStr = timestamp.toLocaleDateString("es-ES", {
          day: "2-digit",
          month: "short",
        });

        let rivalNames = "Desconocidos";
        let result = "No reg.";
        let pitch = "Normal";
        let palaHtml = "";
        let match = null;
        let puntosDetalle = null;

        if (log.matchId) {
          match =
            (await getDocument("partidosReto", log.matchId)) ||
            (await getDocument("partidosAmistosos", log.matchId));

          if (match) {
            result = match.resultado?.sets || match.resultado || result;
            pitch = match.courtType || match.surface || pitch;

            const players = match.jugadores || [];
            const myIdx = players.indexOf(uid);
            if (myIdx !== -1) {
              const rivalsIdx = myIdx < 2 ? [2, 3] : [0, 1];
              const rivals = await Promise.all(
                rivalsIdx.map(async (ridx) => {
                  const rUid = players[ridx];
                  if (!rUid) return "Invitado";
                  if (rUid.startsWith("GUEST_")) return rUid.split("_")[1];
                  const ru = await getDocument("usuarios", rUid);
                  return ru?.nombreUsuario || ru?.nombre || "Jugador";
                }),
              );
              rivalNames = rivals.join(" & ");

              if (match.puntosDetalle && match.puntosDetalle[uid]) {
                puntosDetalle = match.puntosDetalle[uid];
              }
            }

            const user = await getDocument("usuarios", uid);
            const pala = (match.palas && match.palas[uid]) || user?.pala;
            if (pala) {
              palaHtml = `<div class="flex-row items-center gap-1 opacity-50"><i class="fas fa-hammer text-[8px]"></i><span class="text-[8px] uppercase font-bold">${pala}</span></div>`;
            }
          }
        }
        if (window.logCache) window.logCache.set(doc.id, log);

        // ===== CORRECCIÓN IMPORTANTE =====
        // Buscar puntosDetalle en TODAS las ubicaciones posibles
        const pc = log.details?.puntosCalculados || 
                   log.details?.puntosDetalle || 
                   puntosDetalle;
        
        let detailHtml = "";
        if (pc) {
            if (pc.base !== undefined && pc.rival !== undefined && pc.companero !== undefined) {
                detailHtml = `
                    <div class="mt-2 p-3 bg-black/40 rounded-2xl border border-white/5 flex-col gap-2" style="font-size: 8px;">
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-[#00C3FF]">BASE</span>
                            <span class="font-mono text-white">${pc.base.toFixed(1)}</span>
                        </div>
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-[#FF6B35]">DIFICULTAD RIVAL</span>
                            <span class="font-mono text-white">${pc.rival >= 0 ? '+' : ''}${pc.rival.toFixed(1)}</span>
                        </div>
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-sport-gold">BONO COMPAÑERO</span>
                            <span class="font-mono text-white">${pc.companero >= 0 ? '+' : ''}${pc.companero.toFixed(1)}</span>
                        </div>
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-primary">MULTIPLICADOR</span>
                            <span class="font-mono text-white">x${(pc.multiplicador || 1).toFixed(2)}</span>
                        </div>
                        <div class="flex-row between pt-1 border-t border-white/5">
                            <span class="font-black text-primary uppercase">SUMA TOTAL PARTIDO</span>
                            <span class="font-mono text-primary font-black">${(log.diff >= 0 ? '+' : '')}${log.diff.toFixed(1)}</span>
                        </div>
                    </div>
                `;
            } 
            else if (pc.base !== undefined) {
                detailHtml = `
                    <div class="mt-2 p-3 bg-black/40 rounded-2xl border border-white/5 flex-col gap-2" style="font-size: 8px;">
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-[#00C3FF]">CALIBRACIÓN BASE</span>
                            <span class="font-mono text-white">${(pc.base || 0).toFixed(1)}</span>
                        </div>
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-[#FF6B35]">DIFICULTAD RIVAL</span>
                            <span class="font-mono text-white">${(pc.dificultad >= 0 ? '+' : '')}${(pc.dificultad || 0).toFixed(1)}</span>
                        </div>
                        <div class="flex-row between opacity-70">
                            <span class="font-bold tracking-widest text-sport-gold">RACHA / PERF</span>
                            <span class="font-mono text-white">${((pc.racha || 0) + (pc.sets || 0) >= 0 ? '+' : '')}${((pc.racha || 0) + (pc.sets || 0)).toFixed(1)}</span>
                        </div>
                        <div class="flex-row between pt-1 border-t border-white/5">
                            <span class="font-black text-primary uppercase">SUMA TOTAL PARTIDO</span>
                            <span class="font-mono text-primary font-black">${(log.diff >= 0 ? '+' : '')}${log.diff.toFixed(1)}</span>
                        </div>
                    </div>
                `;
            }
        }

        const lBefore = log.details?.levelBefore || 2.5;
        const lAfter = log.details?.levelAfter || 2.5;
        const lDiff = lAfter - lBefore;
        const lArrow = lDiff > 0 ? '<i class="fas fa-angles-up text-sport-green ml-1"></i>' : (lDiff < 0 ? '<i class="fas fa-angles-down text-sport-red ml-1"></i>' : '');

        return `
                <div class="sport-card p-4 mb-3 flex-col gap-3 border-l-4 ${isWin ? "border-l-sport-green shadow-[0_0_15px_rgba(0,255,100,0.1)]" : "border-l-sport-red shadow-[0_0_15px_rgba(255,50,50,0.1)]"} bg-white/5 rounded-3xl" 
                     onclick="window.showMatchBreakdownV3('${doc.id}')" 
                     style="cursor:pointer">
                    
                    <div class="flex-row between items-center">
                        <div class="flex-col overflow-hidden">
                            <span class="text-[7px] font-black text-muted uppercase tracking-[2px] mb-1">RIVALES</span>
                            <span class="text-[11px] font-black text-white truncate w-full italic">${rivalNames.toUpperCase()}</span>
                        </div>
                        <div class="flex-col items-end shrink-0">
                            <span class="text-xs font-black ${isWin ? "text-sport-green" : "text-sport-red"}">${isWin ? "+" : ""}${log.diff.toFixed(1)}</span>
                            <span class="text-[8px] text-muted font-bold">${dateStr}</span>
                        </div>
                    </div>
                    
                    <div class="flex-row between items-center pt-2 border-t border-white/5 gap-2">
                        <div class="flex-row gap-4 overflow-hidden">
                            <div class="flex-row items-center gap-1 shrink-0">
                                <i class="fas fa-trophy text-[9px] ${isWin ? 'text-sport-gold' : 'text-muted'}"></i>
                                <span class="text-[10px] font-black italic text-white">${result}</span>
                            </div>
                            <div class="flex-row items-center gap-2 shrink-0 px-2 py-1 bg-white/5 rounded-full border border-white/5">
                                <span class="text-[7px] font-black text-muted uppercase">Nivel</span>
                                <span class="text-[9px] font-black text-white">${lBefore.toFixed(2)}</span>
                                ${lArrow}
                                <span class="text-[9px] font-black text-white">${lAfter.toFixed(2)}</span>
                            </div>
                        </div>
                        ${palaHtml}
                    </div>
                    ${detailHtml}
                </div>
            `;
      }),
    );

    return entries.join("");
  } catch (error) {
    console.error("Error en renderUserDetailedHistory:", error);
    return '<div class="text-xs text-danger py-4 text-center">Error al cargar historial</div>';
  }
}

// Phase 3 — Auto Scroll to current user
window.scrollToMe = () => {
  const meRow = document.querySelector(".ranking-card.me");
  if (meRow) {
    meRow.scrollIntoView({ behavior: "smooth", block: "center" });
    meRow.classList.add("glow-pulse");
    setTimeout(() => meRow.classList.remove("glow-pulse"), 3000);
  }
};

// --- LEVEL PROGRESS UTILS (MATCHING USER FORMULA) ---
function calcularPuntosParaSubir(nivel) {
    const t = (nivel - 2.00) / (7.00 - 2.00);
    const factor = 0.20 + (2.0 - 0.20) * Math.pow(t, 2);
    return (30 - 13.5 * (nivel - 2.00)) * factor;
}

function calcularPuntosIniciales(nivel) {
    if (nivel <= 1.00) return 0;
    if (nivel <= 2.00) return 400;
    let puntos = 400;
    for (let n = 2.00; n < nivel; n += 0.01) {
        puntos += calcularPuntosParaSubir(n);
    }
    return puntos;
}

// --- ELO EXPLAINER CHART ---
function renderEloExplainerChart() {
  const canvas = document.getElementById('elo-explainer-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  
  const ctx = canvas.getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['1000', '1200', '1400', '1600', '1800', '2000', '2200', '2400'],
      datasets: [{
        label: 'Nivel',
        data: [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0],
        borderColor: '#c6ff00',
        backgroundColor: 'rgba(198,255,0,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: '#c6ff00',
        pointBorderColor: '#000',
        pointBorderWidth: 2,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.9)',
          titleColor: '#c6ff00',
          bodyColor: '#fff',
          borderColor: 'rgba(198,255,0,0.3)',
          borderWidth: 1,
          callbacks: {
            title: (items) => `ELO: ${items[0].label}`,
            label: (item) => `Nivel: ${item.raw}`,
            afterLabel: (item) => {
              const kFactors = ['K=40 (Rookie)', 'K=40', 'K=25', 'K=25', 'K=25', 'K=15 (Pro)', 'K=15', 'K=15'];
              return kFactors[item.dataIndex] || '';
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'PUNTOS ELO', color: 'rgba(255,255,255,0.3)', font: { size: 9, weight: 900 } },
          ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9, weight: 700 } },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          title: { display: true, text: 'NIVEL', color: 'rgba(255,255,255,0.3)', font: { size: 9, weight: 900 } },
          ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9, weight: 700 }, stepSize: 0.5 },
          grid: { color: 'rgba(255,255,255,0.03)' },
          min: 2,
          max: 6.5
        }
      }
    }
  });
}


