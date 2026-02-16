// ranking.js - Leaderboard & Points History V4.0
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

    // Inject header with admin link if applicable
    await injectHeader(userData);
    injectNavbar("ranking");

    await loadRanking();
    await loadPointsHistory();
  });
});

async function loadRanking() {
  const snap = await window.getDocsSafe(
    query(
      collection(db, "usuarios"),
      orderBy("puntosRanking", "desc"),
    ),
  );
  const list = snap.docs.map((d, i) => ({
    id: d.id,
    rank: i + 1,
    ...d.data(),
  }));

  // My position
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
    document.getElementById("my-level").textContent = (me.nivel || 2.5).toFixed(
      2,
    );
    const playedEl = document.getElementById("my-played");
    const levelCardEl = document.getElementById("my-level-card");
    if (playedEl) playedEl.textContent = `${played}`;
    if (levelCardEl) levelCardEl.textContent = (me.nivel || 2.5).toFixed(2);

    // Level progress (simplified: decimal part as percentage)
    const lvl = me.nivel || 2.5;
    const progress = (lvl % 1) * 100;
    const base = Math.floor(lvl);
    document.getElementById("level-fill").style.width = `${progress}%`;
    document.getElementById("level-prev").textContent = base.toFixed(1);
    document.getElementById("level-next").textContent = (base + 1).toFixed(1);

    // Trend
    const trendEl = document.getElementById("rank-trend");
    if (trendEl) {
      trendEl.style.display = "inline-flex";
      trendEl.className = "rank-trend";
      trendEl.innerHTML = `<i class="fas fa-minus"></i> 0`;
    }

    // Extra: Meta de posición respecto al resto de jugadores
    const metaEl = document.getElementById("rank-meta-text");
    if (metaEl) {
      const percentile = Math.max(
        1,
        Math.min(100, Math.round((1 - (me.rank - 1) / totalPlayers) * 100)),
      );
      metaEl.textContent = `Estás en el TOP ${percentile}% (${me.rank}/${totalPlayers}) del circuito activo`;
    }
  }

  // Podium
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

  // Leaderboard (4th onwards)
  renderLeaderboard(list.slice(3), totalPlayers, movementMap);

  // Auto scroll to me after 1s
  setTimeout(() => window.scrollToMe(), 1000);
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

      // positive => climbed positions, negative => dropped
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

      // Dynamic rank class for colors
      let rankClass = "rank-entry";
      if (u.rank === 1) rankClass = "rank-gold";
      else if (u.rank === 2) rankClass = "rank-silver";
      else if (u.rank === 3) rankClass = "rank-bronze";
      else if (u.rank <= 10) rankClass = "rank-elite";

      const depth = totalPlayers > 1 ? (u.rank - 1) / (totalPlayers - 1) : 0;
      const hue = Math.max(6, Math.round(130 - depth * 124)); // Verde -> rojo
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

async function loadPointsHistory() {
  const container = document.getElementById("points-history");
  if (!container) return;

  try {
    const logs = await window.getDocsSafe(
      query(
        collection(db, "rankingLogs"),
        where("uid", "==", currentUser.uid),
        orderBy("timestamp", "desc"),
        limit(10),
      ),
    );

    if (logs.empty) {
      container.innerHTML =
        '<div class="empty-state"><span class="empty-text">Sin historial</span></div>';
      return;
    }

    const entries = await Promise.all(
      logs.docs.map(async (doc) => {
        const log = doc.data();
        const isWin = log.diff > 0;

        // Try to get match details
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

        return `
                <div class="history-entry ${isWin ? "win" : "loss"}" onclick="showMatchBreakdown('${log.matchId}', ${log.diff}, ${log.newTotal})">
                    <div class="history-icon">
                        <i class="fas ${isWin ? "fa-arrow-up" : "fa-arrow-down"}"></i>
                    </div>
                    <div class="history-details">
                        <span class="history-title">${isWin ? "Victoria" : "Derrota"} ${matchInfo ? `<span class="history-score">${matchInfo}</span>` : ""}</span>
                        <span class="history-date">${date || "N/A"}</span>
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

window.showMatchBreakdown = async (matchId, diff, total) => {
  const overlay = document.getElementById("modal-match-detail");
  const area = document.getElementById("match-breakdown-area");
  overlay.classList.add("active");

  if (!matchId) {
    area.innerHTML = `
            <div class="modal-header-row mb-4">
                <h3 class="modal-title">Desglose de Puntos</h3>
                <button class="btn-icon-glass sm" onclick="document.getElementById('modal-match-detail').classList.remove('active')"><i class="fas fa-times"></i></button>
            </div>
            <div class="sport-card p-4 text-center">
                <span class="font-display font-black text-3xl ${diff > 0 ? "text-sport-green" : "text-danger"}">${diff > 0 ? "+" : ""}${diff}</span>
                <span class="block text-sm text-muted mt-2">Detalles no disponibles</span>
            </div>
        `;
    return;
  }

  area.innerHTML =
    '<div class="loading-state"><div class="spinner-neon"></div></div>';

  const match =
    (await getDocument("partidosReto", matchId)) ||
    (await getDocument("partidosAmistosos", matchId));

  if (!match) {
    area.innerHTML =
      '<div class="empty-state text-danger">Partido no encontrado</div>';
    return;
  }

  const date = match.fecha?.toDate();
  const players = match.jugadores || [];
  const isComp = matchId.includes("reto") || match.tipo === "reto";

  // Get player names
  const playerNames = await Promise.all(
    players.map(async (uid) => {
      if (!uid) return "Libre";
      if (uid.startsWith("GUEST_")) return uid.split("_")[1] + " (Inv)";
      const u = await getDocument("usuarios", uid);
      return u?.nombreUsuario || u?.nombre || "Jugador";
    }),
  );

  const team1 = playerNames.slice(0, 2).join(" & ");
  const team2 = playerNames
    .slice(2, 4)
    .map((n) => n || "Libre")
    .join(" & ");
  const myTeam = players.indexOf(currentUser.uid) < 2 ? 1 : 2;
  const won = diff > 0;

  // Detailed Point Breakdown Logic
  const basePoints = 25; // Standard base
  const levelFactor = Math.round(diff * 0.4); // Points from level difference
  const streakBonus = Math.round(diff * 0.1); // Streak bonus
  const resultFactor = diff - levelFactor - streakBonus; // Remaining is result weight

  area.innerHTML = `
        <div class="modal-header-row mb-4">
            <h3 class="modal-title">Análisis de Puntuación</h3>
            <button class="btn-icon-glass sm" onclick="document.getElementById('modal-match-detail').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4 ${won ? "glow-green" : "glow-red"}">
            <div class="flex-row between mb-3">
                <span class="status-badge ${won ? "badge-green" : "badge-orange"}">${won ? "VICTORIA" : "DERROTA"}</span>
                <span class="text-xs text-muted">${date ? date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }) : ""}</span>
            </div>
            
            <div class="text-center mb-4">
                <span class="font-display font-black text-4xl text-white tracking-widest">${match.resultado?.sets || "-"}</span>
                <span class="block text-xs text-muted mt-1 uppercase tracking-widest">${isComp ? "Partido Oficial" : "Amistoso"}</span>
            </div>
            
            <div class="match-teams-display">
                <span class="team-name ${myTeam === 1 ? "chk" : ""}">${team1}</span>
                <span class="vs-label">VS</span>
                <span class="team-name ${myTeam === 2 ? "chk" : ""}">${team2}</span>
            </div>
        </div>
        
        <h4 class="section-subtitle mb-3">Desglose de Rendimiento</h4>
        
        <div class="flex-col gap-3 mb-4">
            <div class="point-factor-row">
                <div class="factor-icon bg-blue-500/20 text-blue-400"><i class="fas fa-trophy"></i></div>
                <div class="factor-info">
                    <span class="factor-name">Resultado Base</span>
                    <span class="factor-desc">Puntos por ${won ? "ganar" : "perder"} el encuentro</span>
                </div>
                <span class="factor-val text-white">${resultFactor > 0 ? "+" : ""}${resultFactor}</span>
            </div>

            <div class="point-factor-row">
                <div class="factor-icon bg-purple-500/20 text-purple-400"><i class="fas fa-layer-group"></i></div>
                <div class="factor-info">
                    <span class="factor-name">Diferencia Nivel</span>
                    <span class="factor-desc">Ajuste por nivel de rivales</span>
                </div>
                <span class="factor-val ${levelFactor >= 0 ? "text-sport-green" : "text-danger"}">${levelFactor > 0 ? "+" : ""}${levelFactor}</span>
            </div>

            <div class="point-factor-row">
                <div class="factor-icon bg-orange-500/20 text-orange-400"><i class="fas fa-fire"></i></div>
                <div class="factor-info">
                    <span class="factor-name">Racha Actual</span>
                    <span class="factor-desc">Bonus por consistencia</span>
                </div>
                <span class="factor-val text-white">${streakBonus > 0 ? "+" : ""}${streakBonus}</span>
            </div>
        </div>
        
        <div class="sport-card p-4 gradient-card flex-row between items-center">
            <div class="flex-col">
                <span class="font-bold text-white text-sm uppercase opacity-90">Impacto Total</span>
                <span class="text-xs text-white opacity-60">Nuevo ELO: ${total}</span>
            </div>
            <span class="font-display font-black text-3xl text-white">${diff > 0 ? "+" : ""}${diff}</span>
        </div>
    `;
};

window.viewProfile = async (uid) => {
  if (!uid) return;

  const overlay = document.getElementById("modal-user");
  const area = document.getElementById("user-detail-area");

  if (overlay) overlay.classList.add("active");
  if (area)
    area.innerHTML =
      '<div class="loading-state"><div class="spinner-neon"></div></div>';

  const user = await getDocument("usuarios", uid);
  if (!user) {
    if (area)
      area.innerHTML =
        '<div class="empty-state text-danger">Usuario no encontrado</div>';
    return;
  }

  const name = user.nombreUsuario || user.nombre || "Jugador";
  const photo = user.fotoPerfil || user.fotoURL;

  const logsHtml = await renderUserDetailedHistory(uid);

  area.innerHTML = `
        <div class="modal-header-row mb-6">
            <h3 class="modal-title">Expediente de Jugador</h3>
            <button class="btn-icon-glass sm" onclick="document.getElementById('modal-user').classList.remove('active')"><i class="fas fa-times"></i></button>
        </div>

        <div class="flex-row items-center gap-4 mb-8">
            <div class="profile-avatar-v7 ${user.rol === "Admin" ? "gold" : "cyan"}">
                ${photo ? `<img src="${photo}">` : `<div class="initials">${name.charAt(0)}</div>`}
            </div>
            <div class="flex-col">
                <span class="text-xl font-black italic text-white leading-none">${name}</span>
                <span class="text-[9px] font-bold text-muted uppercase tracking-[3px] mt-1">${user.rol || "Jugador"}</span>
            </div>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-8">
            <div class="stat-card-v7 sm cyan">
                <span class="text-[8px] font-black text-muted uppercase">Nivel</span>
                <span class="text-sm font-black text-white italic">${(user.nivel || 2.5).toFixed(2)}</span>
            </div>
            <div class="stat-card-v7 sm gold">
                <span class="text-[8px] font-black text-muted uppercase">Puntos</span>
                <span class="text-sm font-black text-white italic">${user.puntosRanking || 1000}</span>
            </div>
            <div class="stat-card-v7 sm lime">
                <span class="text-[8px] font-black text-muted uppercase">Racha</span>
                <span class="text-sm font-black text-white italic">${user.rachaActual || 0}</span>
            </div>
        </div>

        <div class="history-container-v7">
            <h4 class="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Últimos Partidos</h4>
            <div class="flex-col gap-3">
                ${logsHtml}
            </div>
        </div>

        <div class="mt-8 pt-6 border-t border-white/5">
            <button class="btn-premium-v7 w-full py-4 text-xs font-black uppercase tracking-widest" onclick="document.getElementById('modal-user').classList.remove('active')">Cerrar Expediente</button>
        </div>
    `;
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

        if (log.matchId) {
          const match =
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
                  if (!rUid) return "Libre";
                  if (rUid.startsWith("GUEST_")) return rUid.split("_")[1];
                  const ru = await getDocument("usuarios", rUid);
                  return ru?.nombreUsuario || ru?.nombre || "Jugador";
                }),
              );
              rivalNames = rivals.join(" & ");
            }

            // Check for paddle in match or user profile
            const user = await getDocument("usuarios", uid);
            const pala = (match.palas && match.palas[uid]) || user?.pala;
            if (pala) {
              palaHtml = `<div class="flex-row items-center gap-1 opacity-50"><i class="fas fa-hammer text-[8px]"></i><span class="text-[8px] uppercase font-bold">${pala}</span></div>`;
            }
          }
        }

        return `
                <div class="sport-card p-3 mb-2 flex-col gap-2 border-l-4 ${isWin ? "border-l-sport-green" : "border-l-sport-red"} bg-white/5" 
                     onclick="window.showMatchBreakdown('${log.matchId}', ${log.diff}, ${log.newTotal})" 
                     style="cursor:pointer">
                    <div class="flex-row between items-start">
                        <div class="flex-col overflow-hidden mr-2">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">Contrincantes</span>
                            <span class="text-[10px] font-bold text-white truncate w-full">${rivalNames}</span>
                        </div>
                        <div class="flex-col items-end shrink-0">
                            <span class="text-[10px] font-black ${isWin ? "text-sport-green" : "text-sport-red"}">${isWin ? "+" : ""}${log.diff} PTS</span>
                            <span class="text-[8px] text-muted font-bold">${dateStr}</span>
                        </div>
                    </div>
                    
                    <div class="flex-row between items-center pt-2 border-t border-white/5 gap-2">
                        <div class="flex-row gap-3 overflow-hidden">
                            <div class="flex-row items-center gap-1 shrink-0">
                                <i class="fas fa-table-tennis text-[9px] text-primary"></i>
                                <span class="text-[10px] font-black italic text-white">${result}</span>
                            </div>
                            <div class="flex-row items-center gap-1 truncate">
                                <i class="fas fa-th text-[8px] text-muted"></i>
                                <span class="text-[8px] text-muted uppercase font-bold truncate">${pitch}</span>
                            </div>
                        </div>
                        ${palaHtml}
                    </div>
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

// --- EXPEDIENTE JUGADOR (PHASE 2) ---
window.viewProfile = (uid) => {
  if (!uid) return;
  window.openExpedient(uid);
};

window.openExpedient = async (uid) => {
  // Create overlay if not exists
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
    
    // Address
    const viv = u.vivienda || {};
    const addressStr = (viv.bloque || viv.piso || viv.puerta) 
      ? `Blq ${viv.bloque || '-'}, Piso ${viv.piso || '-'}, Pta ${viv.puerta || '-'}` 
      : null;

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
                            <div class="exp-badge">NIVEL ${level}</div>
                            <div class="exp-pala"><i class="fas fa-hammer"></i> ${pala}</div>
                            ${addressStr ? `<div class="exp-pala" style="margin-top:4px;"><i class="fas fa-map-pin"></i> ${addressStr}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div class="exp-stats-grid">
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${pts}</span>
                        <span class="exp-stat-label">ELO</span>
                    </div>
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${ps}</span>
                        <span class="exp-stat-label">PJ</span>
                    </div>
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${vs}</span>
                        <span class="exp-stat-label">V</span>
                    </div>
                    <div class="exp-stat-item">
                        <span class="exp-stat-val">${winrate}%</span>
                        <span class="exp-stat-label">WR</span>
                    </div>
                </div>

                ${u.telefono ? `<div class="px-4 pt-3 flex-row items-center gap-2"><i class="fas fa-phone text-[10px] text-muted"></i><span class="text-[10px] text-white/50 font-bold">${u.telefono}</span></div>` : ''}

                <div class="px-4 pt-4 pb-2 border-b border-white/5">
                    <span class="text-[9px] font-black text-primary uppercase tracking-[2px]">Historial de Operaciones</span>
                </div>

                <div class="exp-history-list custom-scroll" id="exp-history-list">
                    <div class="center py-10 opacity-30"><i class="fas fa-circle-notch fa-spin"></i></div>
                </div>
            </div>
        `;

    // Load History
    const historyContainer = document.getElementById("exp-history-list");
    const historyHtml = await renderUserDetailedHistory(uid);
    if (historyContainer) historyContainer.innerHTML = historyHtml;
  } catch (e) {
    console.error(e);
    showToast("ERROR", "No se pudo cargar el expediente", "error");
    overlay.classList.remove("active");
  }
};

window.showMatchBreakdown = async (matchId, diff, total) => {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = "11000";

  overlay.innerHTML = `
        <div class="modal-card glass-strong animate-up p-0 overflow-hidden" style="max-width:380px">
            <div class="modal-header">
                <span class="modal-title">DESGLOSE TÁCTICO</span>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div id="breakdown-content" class="modal-body custom-scroll">
                <div class="center py-10"><i class="fas fa-circle-notch fa-spin text-primary"></i></div>
            </div>
        </div>
    `;
  document.body.appendChild(overlay);

  try {
    if (!matchId || matchId === "undefined") {
      document.getElementById("breakdown-content").innerHTML = `
                <div class="text-center py-6">
                    <div class="text-4xl font-black mb-2 ${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${diff >= 0 ? "+" : ""}${diff}</div>
                    <span class="text-[10px] text-muted uppercase tracking-[3px]">Impacto en ELO</span>
                    <div class="mt-8 p-4 bg-white/5 rounded-2xl border border-white/5 mx-4">
                        <p class="text-[10px] text-muted italic">Este ajuste fue realizado por un administrador o es una corrección manual de sistema.</p>
                    </div>
                </div>
            `;
      return;
    }

    const m = (await getDocument("partidosReto", matchId)) || (await getDocument("partidosAmistosos", matchId));
    if (!m) throw new Error("Partido no encontrado");

    const date = m.fecha?.toDate ? m.fecha.toDate().toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "N/A";
    const res = m.resultado?.sets || "0-0";
    const won = diff > 0;
    
    // --- REAL BREAKDOWN from matchPointDetails ---
    let detailData = null;
    try {
      const detailSnap = await getDocs(query(collection(db, "matchPointDetails"), where("matchId", "==", matchId), limit(1)));
      if (!detailSnap.empty) detailData = detailSnap.docs[0].data();
    } catch(e) {}
    
    // Calculate real factors from detail or estimate
    const factorBase = detailData?.basePoints || (won ? 20 : -15);
    const factorLevel = detailData?.levelAdjust || Math.round(diff * 0.35);
    const factorStreak = detailData?.streakBonus || (Math.abs(diff) > 30 ? (won ? 5 : -5) : 0);
    const factorKFactor = detailData?.kFactor || 25;
    const factorCleanSheet = detailData?.cleanSheetBonus || 0;
    const factorVanquisher = detailData?.vanquisherBonus || 0;
    const netPoints = diff;

    document.getElementById("breakdown-content").innerHTML = `
            <div class="flex-col gap-5">
                <!-- Result Card -->
                <div class="p-5 rounded-3xl bg-gradient-to-br ${won ? 'from-sport-green/20 to-transparent border-sport-green/30' : 'from-sport-red/20 to-transparent border-sport-red/30'} border">
                    <div class="flex-row between items-center mb-4">
                        <span class="text-[10px] font-black ${won ? 'text-sport-green' : 'text-sport-red'} uppercase tracking-widest">${won ? 'Victoria Magistral' : 'Derrota Táctica'}</span>
                        <span class="text-[10px] text-white/40 font-bold">${date}</span>
                    </div>
                    <div class="text-center">
                        <span class="text-5xl font-black italic text-white tracking-widest">${res}</span>
                    </div>
                </div>

                <!-- Factors Breakdown -->
                <div class="flex-col gap-3">
                    <h4 class="text-[10px] font-black text-muted uppercase tracking-[2px] px-1">Factores de Puntuación</h4>
                    
                    <div class="flex-row between items-center p-3 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-row items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-blue-500/20 flex center text-blue-400"><i class="fas fa-trophy text-xs"></i></div>
                            <div class="flex-col">
                                <span class="text-[10px] font-bold text-white uppercase">Resultado</span>
                                <span class="text-[8px] text-muted font-bold">Base por el encuentro</span>
                            </div>
                        </div>
                        <span class="font-black ${factorBase > 0 ? 'text-sport-green' : 'text-sport-red'}">${factorBase > 0 ? '+' : ''}${factorBase}</span>
                    </div>

                    <div class="flex-row between items-center p-3 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-row items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-orange-500/20 flex center text-orange-400"><i class="fas fa-fire text-xs"></i></div>
                            <div class="flex-col">
                                <span class="text-[10px] font-bold text-white uppercase">Racha / Bonus</span>
                                <span class="text-[8px] text-muted font-bold">Multiplicador de consistencia</span>
                            </div>
                        </div>
                        <span class="font-black ${factorStreak >= 0 ? 'text-sport-green' : 'text-sport-red'}">${factorStreak > 0 ? '+' : ''}${factorStreak}</span>
                    </div>

                    <div class="flex-row between items-center p-3 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-row items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-purple-500/20 flex center text-purple-400"><i class="fas fa-balance-scale text-xs"></i></div>
                            <div class="flex-col">
                                <span class="text-[10px] font-bold text-white uppercase">Nivel Rival</span>
                                <span class="text-[8px] text-muted font-bold">Ajuste por dificultad ELO</span>
                            </div>
                        </div>
                        <span class="font-black ${factorLevel >= 0 ? 'text-sport-green' : 'text-sport-red'}">${factorLevel > 0 ? '+' : ''}${factorLevel}</span>
                    </div>
                </div>

                <!-- Additional Factors -->
                ${factorCleanSheet !== 0 ? `
                    <div class="flex-row between items-center p-3 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-row items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-cyan-500/20 flex center text-cyan-400"><i class="fas fa-broom text-xs"></i></div>
                            <div class="flex-col">
                                <span class="text-[10px] font-bold text-white uppercase">Clean Sheet</span>
                                <span class="text-[8px] text-muted font-bold">Sin juegos perdidos</span>
                            </div>
                        </div>
                        <span class="font-black text-sport-green">+${factorCleanSheet}</span>
                    </div>
                ` : ''}
                ${factorVanquisher !== 0 ? `
                    <div class="flex-row between items-center p-3 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-row items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-yellow-500/20 flex center text-yellow-400"><i class="fas fa-dragon text-xs"></i></div>
                            <div class="flex-col">
                                <span class="text-[10px] font-bold text-white uppercase">Matagigantes</span>
                                <span class="text-[8px] text-muted font-bold">Victoria contra superior</span>
                            </div>
                        </div>
                        <span class="font-black text-sport-green">+${factorVanquisher}</span>
                    </div>
                ` : ''}
                
                <!-- K-Factor Info -->
                <div class="flex-row between items-center p-3 bg-white/3 rounded-2xl border border-white/5 opacity-60">
                    <div class="flex-row items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-white/5 flex center text-white/40"><i class="fas fa-sliders text-xs"></i></div>
                        <div class="flex-col">
                            <span class="text-[10px] font-bold text-white/60 uppercase">K-Factor</span>
                            <span class="text-[8px] text-muted font-bold">Sensibilidad ELO V2</span>
                        </div>
                    </div>
                    <span class="font-black text-white/40">${factorKFactor}</span>
                </div>

                <!-- Total Impact -->
                <div class="mt-2 p-5 bg-primary/10 rounded-3xl border border-primary/20 flex-row between items-center">
                    <div class="flex-col">
                        <span class="text-[10px] font-black text-primary uppercase tracking-widest">Balance Final</span>
                        <span class="text-[8px] text-primary/60 font-black">NUEVO ELO: ${total}</span>
                    </div>
                    <span class="text-4xl font-black italic text-white">${diff > 0 ? '+' : ''}${diff}</span>
                </div>

                <button class="btn-premium-v7 w-full py-4 uppercase text-[10px] font-black tracking-widest" onclick="this.closest('.modal-overlay').remove()">
                    Cerrar Análisis
                </button>
            </div>
        `;
  } catch (e) {
    console.error(e);
    document.getElementById("breakdown-content").innerHTML = `
            <div class="center py-10 flex-col gap-2">
                <i class="fas fa-exclamation-triangle text-sport-red text-xl"></i>
                <span class="text-xs text-muted">Error al vincular con la red</span>
            </div>
        `;
  }
};

// Phase 3 — Auto Scroll to current user
window.scrollToMe = () => {
  const meRow = document.querySelector(".ranking-card.me");
  if (meRow) {
    meRow.scrollIntoView({ behavior: "smooth", block: "center" });
    meRow.classList.add("glow-pulse");
    setTimeout(() => meRow.classList.remove("glow-pulse"), 3000);
  }
};

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
