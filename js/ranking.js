import { db, getDocsSafe, getDocument, auth } from "./firebase-service.js";
import {
  collection,
  query,
  orderBy,
  limit,
  where,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI } from "./ui-core.js";
import { injectHeader, injectNavbar, updateHeader } from "./modules/ui-loader.js";
import { levelFromRating } from "./config/elo-system.js";
import { renderMatchDetail } from "./match-service.js";
import { getCoreLevelProgressState } from "./core/core-engine.js";
import { getFriendlyTeamName } from "./utils/team-utils.js";
import { parseGuestMeta, getNormalizedPlayers, getMatchTeamPlayerIds } from "./utils/match-utils.js";
import { resolveIdentity, renderIdentityAvatar, seedIdentityCache } from "./services/identity-service.js";
import { enrichUsersWithComputedStreak, syncComputedStreakForUser } from "./services/streak-service.js";
import { installScreenErrorMonitoring } from "./services/error-monitor.js";

let users = [];
let currentUser = null;
let currentUserData = null;
let currentSearch = "";
let currentFilter = "all";
let currentViewMode = "general";
const matchCache = new Map();
installScreenErrorMonitoring("ranking", () => ({
  currentFilter,
  currentSearch,
  totalUsers: Array.isArray(users) ? users.length : 0,
}));

function renderAvatarMarkup(user, className = "lb-avatar") {
  return renderIdentityAvatar({
    name: user?.nombreUsuario || user?.nombre || "Jugador",
    photo: user?.fotoPerfil || user?.fotoURL || user?.photoURL || "",
  }, className);
}

function fmtDate(input) {
  const d = input?.toDate ? input.toDate() : new Date(input || 0);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function num(v, digits = 2) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(digits) : "0.00";
}

function buildCenteredProgress(pointsToDown, pointsToUp) {
  const down = Math.max(0, Number(pointsToDown || 0));
  const up = Math.max(0, Number(pointsToUp || 0));
  const total = down + up;
  if (total <= 0) return 50;
  return (down / total) * 100;
}

async function getMatchById(matchId) {
  if (!matchId) return null;
  if (matchCache.has(matchId)) return matchCache.get(matchId);
  const fromReto = await getDocument("partidosReto", matchId);
  const match = 
    fromReto || 
    (await getDocument("partidosAmistosos", matchId)) || 
    (await getDocument("eventoPartidos", matchId)) || 
    null;
  matchCache.set(matchId, match);
  return match;
}

function getTierClass(rank) {
  if (rank <= 3) return "";
  if (rank <= 10) return "tier-10";
  if (rank <= 20) return "tier-20";
  if (rank <= 30) return "tier-30";
  if (rank <= 50) return "tier-50";
  return "tier-low";
}

function getTierLabel(rank) {
  if (rank <= 10) return "TOP 10";
  if (rank <= 20) return "TOP 20";
  if (rank <= 30) return "TOP 30";
  if (rank <= 50) return "TOP 50";
  return "CLUB";
}

function getTierStyle(rank, total) {
  if (!Number.isFinite(rank) || rank <= 3) return "";
  let tierSize = 10;
  let tierIndex = rank - 1;
  let hueBase = 120;
  if (rank <= 10) {
    tierSize = 10;
    tierIndex = rank - 1;
    hueBase = 120;
  } else if (rank <= 20) {
    tierSize = 10;
    tierIndex = rank - 11;
    hueBase = 200;
  } else if (rank <= 30) {
    tierSize = 10;
    tierIndex = rank - 21;
    hueBase = 270;
  } else if (rank <= 50) {
    tierSize = 20;
    tierIndex = rank - 31;
    hueBase = 35;
  } else {
    tierSize = Math.max(10, total - 50);
    tierIndex = rank - 51;
    hueBase = 210;
  }
  const t = Math.max(0, Math.min(1, tierIndex / Math.max(1, tierSize - 1)));
  const sat = rank > 50 ? 28 : Math.round(74 - (t * 26));
  const light = rank > 50 ? 55 : Math.round(62 - (t * 15));
  const tintOpacity = rank > 50 ? 0.035 : Number((0.16 - (t * 0.08)).toFixed(3));
  const accentOpacity = rank > 50 ? 0.4 : Number((0.95 - (t * 0.45)).toFixed(3));
  const hue = hueBase + Math.round(14 * (1 - t));
  return `--rank-accent:hsla(${hue} ${sat}% ${light}% / ${accentOpacity}); --rank-tint:hsla(${hue} ${sat}% ${light}% / ${tintOpacity});`;
}

document.addEventListener("DOMContentLoaded", async () => {
  initAppUI("ranking-v3");
  currentUser = auth.currentUser;
  if (currentUser?.uid) {
    currentUserData = (await getDocument("usuarios", currentUser.uid)) || {};
    currentUserData.computedStreak = await syncComputedStreakForUser(currentUser.uid, currentUserData, { maxLogs: 60 });
    seedIdentityCache([{ uid: currentUser.uid, ...currentUserData }]);
    await injectHeader(currentUserData || {});
    updateHeader(currentUserData || {});
  } else {
    auth.onAuthStateChanged(async (user) => {
      if (!user?.uid) return;
      currentUser = user;
      currentUserData = (await getDocument("usuarios", user.uid)) || {};
      currentUserData.computedStreak = await syncComputedStreakForUser(user.uid, currentUserData, { maxLogs: 60 });
      seedIdentityCache([{ uid: user.uid, ...currentUserData }]);
      await injectHeader(currentUserData || {});
      updateHeader(currentUserData || {});
      renderTable();
    });
  }
  injectNavbar("ranking");
  await loadRanking();

  document.getElementById("rank-search")?.addEventListener("input", (e) => {
    currentSearch = String(e.target.value || "").toLowerCase().trim();
    renderTable();
  });
  document.getElementById("rank-filter")?.addEventListener("change", (e) => {
    currentFilter = String(e.target.value || "all");
    renderTable();
  });
  document.getElementById("rank-view-mode")?.addEventListener("change", (e) => {
    currentViewMode = String(e.target.value || "general");
    syncRankingView();
  });
});

async function loadRanking() {
  const q = query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(200));
  const snap = await getDocsSafe(q);
  users = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  seedIdentityCache(users.map((u) => ({ uid: u.id, ...u })));
  await enrichUsersWithComputedStreak(users, 24);
  renderPodium();
  renderTable();
  syncRankingView();
  const info = document.getElementById("lb-total-info");
  if (info) info.textContent = `${Math.max(0, users.length - 3)} puestos desde el top 4`;
}

function syncRankingView() {
  const general = document.getElementById("general-ranking-section");
  const season = document.getElementById("season-ranking-section");
  if (general) general.classList.toggle("hidden", currentViewMode !== "general");
  if (season) season.classList.toggle("hidden", currentViewMode !== "season");
}

function renderPodium() {
  for (let i = 0; i < 3; i += 1) {
    const u = users[i];
    const idx = i + 1;
    const nameEl = document.getElementById(`p-name-${idx}`);
    const ptsEl = document.getElementById(`p-pts-${idx}`);
    const avEl = document.getElementById(`p-av-${idx}`);
    const pod = document.getElementById(`pod-${idx}`);
    if (!u) continue;
    if (nameEl) nameEl.textContent = (u.nombreUsuario || u.nombre || "Jugador").toUpperCase();
    if (ptsEl) ptsEl.textContent = Math.round(u.puntosRanking || 1000);
    if (avEl) avEl.innerHTML = renderAvatarMarkup(u, "rank-avatar");
    if (pod) {
      pod.onclick = () => window.openRankUserModal(u.id);
      pod.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          window.openRankUserModal(u.id);
        }
      };
    }
  }
}

function passesFilter(u) {
  if (currentFilter === "all") return true;
  if (currentFilter === "pro") return Number(u.nivel || levelFromRating(u.puntosRanking)) > 4;
  if (currentFilter === "friends") {
    const friendIds = currentUserData?.friends || currentUserData?.amigos || [];
    return Array.isArray(friendIds) && friendIds.includes(u.id);
  }
  return true;
}

function renderTable() {
  const list = document.getElementById("lb-list");
  if (!list) return;

  const filtered = users.filter((u) => {
    const n = (u.nombreUsuario || u.nombre || "").toLowerCase();
    return n.includes(currentSearch) && passesFilter(u);
  }).filter((u) => (users.findIndex((x) => x.id === u.id) + 1) > 3);

  if (!filtered.length) {
    list.innerHTML = `<div class="p-10 text-center opacity-40 uppercase text-[10px] font-black">No se encontraron jugadores</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((u, i) => {
      const isMe = u.id === currentUser?.uid;
      const rank = users.findIndex((x) => x.id === u.id) + 1;
      const pts = Math.round(u.puntosRanking || 1000);
      const lvl = Number(u.nivel || levelFromRating(u.puntosRanking)).toFixed(2);
      let rankClass = "";
      if (rank === 1) rankClass = "rank-gold";
      else if (rank === 2) rankClass = "rank-silver";
      else if (rank === 3) rankClass = "rank-bronze";
      else if (rank <= 10) rankClass = "rank-elite";
      const tierClass = getTierClass(rank);
      const tierStyle = getTierStyle(rank, users.length);
      const tierLabel = getTierLabel(rank);
      const streak = Number(u.computedStreak ?? u.rachaActual ?? 0);
      const streakLabel = streak > 0 ? `+${streak}` : `${streak}`;
      const progress = getCoreLevelProgressState({
        rating: Number(u.puntosRanking || 1000),
        levelOverride: Number(u.nivel || levelFromRating(u.puntosRanking)),
      });
      const visibleProgressPct = buildCenteredProgress(progress.pointsToDown, progress.pointsToUp);
      const progressHint = progress.pointsToUp <= progress.pointsToDown
        ? `Subida ${progress.pointsToUp}`
        : `Bajada ${progress.pointsToDown}`;
      return `
        <div class="ranking-card ${rankClass} ${tierClass} ${isMe ? "me" : ""} animate-up"
             style="animation-delay: ${i * 20}ms; ${tierStyle}"
             onclick="window.openRankUserModal('${u.id}')"
             role="button"
             tabindex="0"
             aria-label="Abrir perfil competitivo de ${u.nombreUsuario || u.nombre || "Jugador"}"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.openRankUserModal('${u.id}');}">
          <div class="lb-rank-wrap">
            <span class="rank-number-v7">${rank}</span>
            <span class="lb-tier-chip">${tierLabel}</span>
          </div>
          ${renderAvatarMarkup(u, "lb-avatar")}
          <div class="lb-info">
            <div class="lb-name-row">
              <span class="lb-name">${u.nombreUsuario || u.nombre || "Jugador"} ${isMe ? '<i class="fas fa-user-circle text-[8px] text-primary ml-1"></i>' : ""}</span>
              <span class="lb-level-chip">N ${lvl}</span>
            </div>
            <div class="lb-meta-row lb-meta-row-tight">
              <span class="lb-meta-pill">PJ ${Number(u.partidosJugados || 0)}</span>
              <span class="lb-meta-pill">W ${Number(u.victorias || 0)}</span>
              <span class="lb-meta-pill ${streak > 0 ? "is-positive" : streak < 0 ? "is-negative" : ""}">Racha ${streakLabel}</span>
              <span class="lb-meta-pill">${progressHint}</span>
            </div>
          </div>
          <div class="lb-score-col">
            <span class="lb-pts">${pts}</span>
            <span class="lb-pts-sub">${visibleProgressPct.toFixed(0)}%</span>
            <span class="lb-state-chip state-${progress.stateClass}">${progress.stateLabel}</span>
          </div>
        </div>
      `;
    })
    .join("");

  if (currentViewMode === "general" && currentUser?.uid) {
    requestAnimationFrame(() => {
      const myCard = list.querySelector(`[onclick*="${currentUser.uid}"]`);
      if (myCard) {
        myCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
    });
  }

  void renderSeasonTable();
}

let currentMonthOffset = 0;

function getCurrentSeasonInfo(offset = 0) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset);
  const month = date.getMonth() + 1;
  return {
    key: `${date.getFullYear()}-${String(month).padStart(2, "0")}`,
    label: date.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
  };
}

async function renderSeasonTable() {
  const list = document.getElementById("season-lb-list");
  const info = document.getElementById("season-total-info");
  if (!list) return;

  try {
    const season = getCurrentSeasonInfo(currentMonthOffset);
    if (info) info.textContent = season.label;
    
    list.innerHTML = `<div class="p-10 text-center opacity-40 uppercase text-[10px] font-black"><i class="fas fa-spinner fa-spin mr-2"></i> Cargando mes...</div>`;

    const logsSnap = await getDocsSafe(
      query(collection(db, "rankingLogs"), orderBy("timestamp", "desc"), limit(2500)),
    );
    const totals = new Map();

    (logsSnap?.docs || []).forEach((docSnap) => {
      const log = docSnap.data() || {};
      const seasonKey = log.seasonKey || season.key;
      if (seasonKey !== season.key || !log.uid) return;
      totals.set(log.uid, Number(totals.get(log.uid) || 0) + Number(log.diff || 0));
    });

    const rows = [...users]
      .map((u) => ({ ...u, seasonPoints: Number(totals.get(u.id) || 0) }))
      .filter((u) => u.seasonPoints !== 0)
      .sort((a, b) => b.seasonPoints - a.seasonPoints)
      .slice(0, 50);

    const isCurrentMonth = currentMonthOffset === 0;

    if (!rows.length) {
      list.innerHTML = `<div class="p-10 text-center opacity-40 uppercase text-[10px] font-black">Sin actividad en ${season.label}</div>`;
      return;
    }

    list.innerHTML = rows.map((u, i) => `
      <div class="ranking-card animate-up"
           style="animation-delay:${i * 20}ms"
           onclick="window.openRankUserModal('${u.id}')">
        <span class="rank-number-v7">${i + 1}</span>
        ${renderAvatarMarkup(u, "lb-avatar")}
        <div class="lb-info">
          <div class="lb-name-row">
            <span class="lb-name">${u.nombreUsuario || u.nombre || "Jugador"}</span>
            <span class="lb-level-chip ${isCurrentMonth ? '' : 'bg-white/10 text-white/50'}">MES</span>
          </div>
          <div class="lb-meta-row lb-meta-row-tight">
            <span class="lb-meta-pill">${season.label}</span>
          </div>
        </div>
        <div class="lb-score-col">
          <span class="lb-pts ${u.seasonPoints > 0 ? 'text-sport-green' : 'text-sport-red'}">${u.seasonPoints >= 0 ? "+" : ""}${u.seasonPoints.toFixed(1)}</span>
          <span class="lb-pts-sub uppercase">PUNTOS</span>
        </div>
      </div>
    `).join("");
  } catch (e) {
    console.warn("Season ranking render failed:", e);
    list.innerHTML = `<div class="p-10 text-center opacity-40 uppercase text-[10px] font-black">No se pudo cargar la temporada</div>`;
  }
}

// Attach event listeners to the buttons when DOM loads
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prev-month-btn")?.addEventListener("click", () => {
    currentMonthOffset--;
    renderSeasonTable();
  });
  document.getElementById("next-month-btn")?.addEventListener("click", () => {
    if (currentMonthOffset < 0) {
      currentMonthOffset++;
      renderSeasonTable();
    }
  });
});

async function renderRankUserModal(uid) {
  const modal = document.getElementById("modal-rank-user");
  const body = document.getElementById("rank-user-body");
  const title = document.getElementById("rank-user-title");
  if (!modal || !body) return;

  modal.classList.add("active");
  body.innerHTML = '<div class="center py-16"><i class="fas fa-spinner fa-spin opacity-30"></i></div>';

  try {
    const u = users.find((it) => it.id === uid) || (await getDocument("usuarios", uid));
    if (!u) throw new Error("Usuario no encontrado");

    const points = Number(u.puntosRanking || 1000);
    const level = Number(u.nivel || levelFromRating(points));
    const state = getCoreLevelProgressState({ rating: points, levelOverride: level });
    const rank = users.findIndex((x) => x.id === uid) + 1;
    const name = u.nombreUsuario || u.nombre || "Jugador";
    const centeredPct = buildCenteredProgress(state.pointsToDown, state.pointsToUp);
    if (title) title.textContent = `PERFIL COMPETITIVO · ${name.toUpperCase()}`;

    // Try ordered query, fallback to unordered if index is missing
    let logs = [];
    try {
      const logsSnap = await getDocsSafe(
        query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(20)),
      );
      logs = (logsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    } catch (_) {
      // index not ready yet â€” fetch without ordering
      const logsSnap2 = await getDocsSafe(
        query(collection(db, "rankingLogs"), where("uid", "==", uid), limit(20)),
      );
      logs = (logsSnap2?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
      logs.sort((a, b) => {
        const ta = a.timestamp?.seconds || 0;
        const tb = b.timestamp?.seconds || 0;
        return tb - ta;
      });
    }

    const cards = await Promise.all(
      logs.map(async (log) => {
        const diff = Number(log.diff || 0);
        const col = log.matchCollection || log.matchCol || "partidosAmistosos";
        const sets = log.sets || log.details?.sets || "Sin marcador";
        const when = fmtDate(log.timestamp || log.details?.timestamp);
        const tipo = log.type || (col === "eventoPartidos" ? "TORNEO" : col === "partidosReto" ? "RETO" : "AMISTOSO");
        const newTotal = Number(log.newTotal || 0);

        let rivalesTexto = "Buscando rivales...";
        try {
          const matchId = log.matchId || "";
          const matchCol = log.matchCollection || col || "partidosAmistosos";
          const match = matchId ? await getMatchById(matchId).catch(() => null) : null;
          
          if (match) {
            const arr = match.jugadores || match.playerUids || [];
            const myIdx = arr.findIndex(x => x === uid);
            
            if (myIdx !== -1 && arr.length >= 4) {
              const rivalUids = myIdx < 2 ? arr.slice(2, 4) : arr.slice(0, 2);
              const rivalNames = await Promise.all(rivalUids.map(async r => {
                if (!r) return "Vacío";
                const identity = await resolveIdentity(r, {
                  currentUserId: currentUser?.uid,
                  currentUserData,
                });
                return identity?.name || "Jugador";
              }));
              rivalesTexto = `vs <span class="font-bold text-white">${rivalNames.join(" &amp; ")}</span>`;
            } else if (match.teamAName || match.teamBName) {
              const myTeam = myIdx < 2 ? "A" : "B";
              rivalesTexto = `vs <span class="font-bold text-white text-[10px] uppercase">${myTeam === "A" ? (match.teamBName || "Pareja B") : (match.teamAName || "Pareja A")}</span>`;
            } else {
               rivalesTexto = "Partido sin rivales registrados";
            }
          }
        } catch (_) { rivalesTexto = "Error cargando rivales"; }

        const won = log.won ?? diff >= 0;
        return `
          <button class="rank-match-card flex-col gap-2 ${won ? "border-l-sport-green" : "border-l-sport-red"} bg-white/5 border border-white/5 hover:bg-white/10 transition-all rounded-xl p-3 text-left w-full"
                  onclick="window.openRankMatchBreakdown('${log.id}','${log.matchId || ""}','${col}')">
            <div class="flex-row between items-center w-full">
              <span class="text-[9px] font-black text-white/50 bg-black/40 px-2 py-0.5 rounded-md uppercase tracking-widest">${tipo}</span>
              <span class="text-[10px] text-white/40">${when}</span>
            </div>
            <div class="flex-row between items-center w-full mt-1">
              <div class="flex-col gap-0.5">
                <span class="text-xs text-white/80">${rivalesTexto}</span>
                <span class="text-[11px] font-mono text-white/50"><i class="fas fa-table-tennis text-primary/50 mr-1"></i>${sets}</span>
              </div>
              <div class="flex-col items-end gap-0.5">
                <span class="text-lg font-black ${won ? "text-sport-green" : "text-sport-red"}">${won ? "+" : ""}${num(diff, 1)}</span>
                <span class="text-[10px] font-black text-primary/70 uppercase tracking-widest">${Math.round(newTotal)} pts</span>
              </div>
            </div>
            <div class="w-full text-center text-[8px] font-bold text-primary/50 uppercase tracking-[2px] mt-1 opacity-50">Pulsa para ver desglose completo</div>
          </button>
        `;
      }),
    );

    body.innerHTML = `
      <div class="rank-user-head-card">
        <div class="rank-user-topline">
          ${renderAvatarMarkup(u, "rank-user-avatar")}
          <div class="rank-user-main">
            <span class="rank-user-name">${name}</span>
            <span class="rank-user-meta">#${rank > 0 ? rank : "--"} · ${Math.round(points)} pts · Nivel ${level.toFixed(2)}</span>
          </div>
        </div>
        <div class="rank-break-grid" style="margin-top:14px;">
          <div class="rank-break-row"><span>Puntos actuales</span><b class="text-white">${Math.round(points)}</b></div>
          <div class="rank-break-row"><span>Para subir</span><b class="text-sport-green">+${state.pointsToUp}</b></div>
          <div class="rank-break-row"><span>Para bajar</span><b class="text-sport-red">-${state.pointsToDown}</b></div>
          <div class="rank-break-row"><span>Ventana de nivel</span><b class="text-primary">${state.prevLevel.toFixed(2)} - ${state.nextLevel.toFixed(2)}</b></div>
        </div>
        <div class="rank-progress-wrap">
          <div class="rank-progress-info">
            <span>Progreso de nivel</span>
            <b>${centeredPct.toFixed(1)}%</b>
          </div>
          <div class="level-bar">
            <div class="level-fill" style="width:${centeredPct}%"></div>
          </div>
          <div class="rank-progress-foot">
            <span>-${state.pointsToDown} pts</span>
            <span class="text-primary">Nivel ${state.currentLevel.toFixed(2)} · ${Math.round(points)} pts</span>
            <span>+${state.pointsToUp} pts</span>
          </div>
        </div>
      </div>
      <div class="rank-user-section-title">Partidos recientes (${logs.length})</div>
      <div class="rank-match-list">${cards.join("") || '<div class="center py-10 opacity-40">Sin actividad registrada.<br><span class="text-xs">Usa "Recalcular todo" en Admin para actualizar.</span></div>'}</div>
    `;
  } catch (e) {
    console.error("Rank user modal error:", e);
    body.innerHTML = `<div class="center py-16 text-sport-red">No se pudo cargar el jugador.<br><span class="text-xs opacity-60">${e.message}</span></div>`;
  }
}


window.openRankUserModal = (uid) => {
  if (!uid) return;
  renderRankUserModal(uid);
};

window.openRankMatchBreakdown = async (logId, matchId, col) => {
  const mainModal = document.getElementById("modal-match");
  const area = document.getElementById("match-detail-area");
  const titleEl = document.getElementById("modal-titulo");
  if (!mainModal || !area) return;
  area.innerHTML = '<div class="center py-20"><i class="fas fa-spinner fa-spin opacity-20"></i></div>';
  mainModal.classList.add("active");
  mainModal.classList.add("modal-stack-front");
  if (titleEl) titleEl.textContent = "Desglose de puntuación";

  try {
    const logDoc = logId ? await getDocument("rankingLogs", logId) : null;
    const match = matchId ? await getMatchById(matchId) : null;
    const detail = logDoc?.details?.breakdown || logDoc?.details?.puntosDetalle || {};
    const systemVersion = String(logDoc?.details?.systemVersion || "");
    const real = detail?.desgloseReal || {};
    let factors = [];
    let diagnostics = [];
    let transparentRows = [];
    if (detail.factoresAdicionales) {
        // v8 Advanced Scoring
        factors = [
            ["Elo Dinámico", detail.cambioElo],
            ["Ajuste Equipo", detail.factoresAdicionales?.companero],
            ["Racha / Bonus", detail.factoresAdicionales?.racha],
            ["Set Margin", detail.factoresAdicionales?.margenSets],
            ["Equilibrio final", detail.ajusteBalance]
        ].filter(([, v]) => v !== undefined && v !== null && v !== 0);
        
        if (detail.sumaTotal && detail.limiteAplicado && Math.abs(detail.sumaTotal) > Math.abs(detail.limiteAplicado)) {
            factors.push(["Ajuste Tope Rígido", Number((detail.limiteAplicado - detail.sumaTotal).toFixed(2))]);
        }
        transparentRows = [
            ["Elo base esperado", detail.cambioElo],
            ["Puntos por compañero", detail.factoresAdicionales?.companero],
            ["Puntos por racha", detail.factoresAdicionales?.racha],
            ["Puntos por sets", detail.factoresAdicionales?.margenSets],
            ["Balance final del sistema", detail.ajusteBalance],
        ].filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(Number(v)));
    } else {
        // Legacy
        factors = [
        ["Puntos Base", detail.base],
        ["Bonificación Racha", detail.racha || detail.streak],
        ["Factor Sorpresa", detail.sorpresa || detail.surprise],
        ["Por Sets/Juegos", detail.clutch || detail.sets],
        ["Ajuste Nivel", detail.habilidad || detail.skill],
        ["Equilibrio final", detail.ajusteBalance],
        ].filter(([, v]) => v !== undefined && v !== null && v !== 0);
        transparentRows = [
          ["Base del partido", detail.base],
          ["Racha", detail.racha || detail.streak],
          ["Sorpresa", detail.sorpresa || detail.surprise],
          ["Sets / clutch", detail.clutch || detail.sets],
          ["Habilidad / skill", detail.habilidad || detail.skill],
          ["Balance final del sistema", detail.ajusteBalance]
        ].filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(Number(v)));
    }

    if (systemVersion.includes("atp")) {
      diagnostics = [
        ["Expectativa", real.esperado],
        ["K Factor", real.K],
        ["Seed Individual", real.seedIndividual],
        ["Gap Compa", real.diferenciaConCompanero],
        ["Reparto", real.repartoPareja],
        ["Dominancia", real.dominance],
        ["Rating Pareja", real.teamRating],
        ["Rating Rival", real.rivalRating],
      ].filter(([, v]) => v !== undefined && v !== null && v !== 0);
    }

    const diff = Number(logDoc?.diff || 0);
    const levelBefore = Number(logDoc?.details?.levelBefore || 0);
    const levelAfter = Number(logDoc?.details?.levelAfter || 0);
    const pointsBefore = Number(logDoc?.details?.pointsBefore);
    const pointsAfter = Number(logDoc?.details?.pointsAfter);
    
    const beforeProgress = Number.isFinite(pointsBefore)
      ? getCoreLevelProgressState({
          rating: pointsBefore,
          levelOverride: levelBefore || undefined,
        })
      : null;
    const afterProgress = Number.isFinite(pointsAfter)
      ? getCoreLevelProgressState({
          rating: pointsAfter,
          levelOverride: levelAfter || undefined,
        })
      : null;

    let matchInfoHtml = "";
    if (match) {
        const matchPlayers = Array.isArray(match.jugadores) ? match.jugadores : (Array.isArray(match.playerUids) ? match.playerUids : []);
        
        async function getFriendlyName(uid) {
            if (!uid) return "Vacío";
            const identity = await resolveIdentity(uid, {
              userMap: Object.fromEntries(users.map((user) => [user.id, user])),
            }).catch(() => null);
            if (identity?.name) return identity.name;
            const guest = parseGuestMeta(uid);
            if (guest?.name) return guest.name;
            const u = users.find(x => x.id === uid) || await getDocument("usuarios", uid);
            return u?.nombreUsuario || u?.nombre || "Jugador";
        }

        const pNames = await Promise.all(matchPlayers.map(getFriendlyName));
        const teamAIds = getMatchTeamPlayerIds(match, "A");
        const teamBIds = getMatchTeamPlayerIds(match, "B");
        const t1Names = getFriendlyTeamName({
            teamName: match.teamAName || match.equipoA,
            playerNames: teamAIds.map((uid) => pNames[matchPlayers.indexOf(uid)]).filter(Boolean),
            fallback: "Pareja 1",
            side: "A"
        });
        const t2Names = getFriendlyTeamName({
            teamName: match.teamBName || match.equipoB,
            playerNames: teamBIds.map((uid) => pNames[matchPlayers.indexOf(uid)]).filter(Boolean),
            fallback: "Pareja 2",
            side: "B"
        });
        const renderRosterPills = (ids = []) => ids.map((uid) => {
            const idx = matchPlayers.indexOf(uid);
            const label = pNames[idx] || "Jugador";
            return `<span class="rank-player-pill">${label}</span>`;
        }).join("");

        matchInfoHtml = `
            <div class="rank-break-match premium">
                <div class="rank-break-versus">
                    <div class="rank-break-team-block">
                    <span class="text-[10px] font-black text-white/90 uppercase tracking-widest">${t1Names}</span>
                    <div class="rank-player-pill-row">${renderRosterPills(teamAIds)}</div>
                    </div>
                    <span class="text-[8px] font-bold text-primary opacity-60">VERSUS</span>
                    <div class="rank-break-team-block">
                    <span class="text-[10px] font-black text-white/90 uppercase tracking-widest">${t2Names}</span>
                    <div class="rank-player-pill-row">${renderRosterPills(teamBIds)}</div>
                    </div>
                </div>
                <span class="match-sub">${fmtDate(match.fecha)} Â· ${match.resultado?.sets || match.resultado || 'Sin resultado'}</span>
            </div>
        `;
    }

    area.innerHTML = `
      <div class="rank-breakdown-card">
        ${matchInfoHtml}
        <div class="rank-break-title">Desglose de puntuación</div>
        ${transparentRows.length ? `
        <div class="rank-break-subtitle">Suma visible del cálculo</div>
        <div class="rank-break-grid rank-break-grid-strong">
          ${transparentRows.map(([k, v]) => {
            const val = Number(v);
            const colorCls = val > 0 ? "text-sport-green" : val < 0 ? "text-sport-red" : "text-white/40";
            return `<div class="rank-break-row emphasis"><span>${k}</span><b class="${colorCls}">${val > 0 ? "+" : ""}${num(v, 2)}</b></div>`;
          }).join("")}
        </div>` : ""}
        <div class="rank-break-level">Subtotal visible ${num(detail.subtotalVariables ?? detail.totalCalculado ?? diff, 2)} Â· Ajuste final ${num(detail.ajusteBalance || 0, 2)} Â· Delta ${num(detail.finalDelta || diff, 2)}</div>
        <div class="rank-break-subtitle">Variables complementarias</div>
        <div class="rank-break-grid">
          ${factors.map(([k, v]) => {
            const val = Number(v);
            const colorCls = val > 0 ? "text-sport-green" : val < 0 ? "text-sport-red" : "text-white/40";
            return `<div class="rank-break-row"><span>${k}</span><b class="${colorCls}">${val > 0 ? "+" : ""}${num(v, 2)}</b></div>`;
          }).join("")}
        </div>
        ${diagnostics.length ? `
        <div class="rank-break-title" style="margin-top:14px;">Métricas del cálculo</div>
        <div class="rank-break-grid">
          ${diagnostics.map(([k, v]) => `<div class="rank-break-row"><span>${k}</span><b class="text-primary">${num(v, 2)}</b></div>`).join("")}
        </div>` : ""}
        
        <div class="rank-break-total">
          <div class="total-main">
             <span>Total partido</span>
             <b class="${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${diff >= 0 ? "+" : ""}${num(diff, 2)}</b>
          </div>
          <div class="total-calc">
             ${Math.round(pointsBefore)} <span class="mx-1 opacity-40">+</span> 
             <span class="${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${num(diff, 2)}</span>
             <span class="mx-1 opacity-40">=</span> 
             <span class="text-white">${Math.round(pointsAfter)} PTS</span>
          </div>
        </div>

        <div class="rank-break-level">Nivel ${levelBefore ? levelBefore.toFixed(2) : "--"} â†’ ${levelAfter ? levelAfter.toFixed(2) : "--"}</div>
        <div class="rank-break-level">Variables ${num(detail.totalCalculado || diff, 2)} = Delta final ${num(detail.finalDelta || diff, 2)}</div>
        ${
          beforeProgress && afterProgress
            ? `
        <div class="rank-break-prog-wrap">
          <div class="rank-break-prog-row">
            <span>Antes (${Math.round(pointsBefore)} pts)</span>
            <b>${beforeProgress.progressPct.toFixed(2)}%</b>
          </div>
          <div class="level-bar"><div class="level-fill" style="width:${beforeProgress.progressPct}%"></div></div>
          <div class="rank-break-prog-row mt-1">
            <span>Después (${Math.round(pointsAfter)} pts)</span>
            <b>${afterProgress.progressPct.toFixed(2)}%</b>
          </div>
          <div class="level-bar"><div class="level-fill" style="width:${afterProgress.progressPct}%"></div></div>
        </div>
        `
            : ""
        }
      </div>
    `;
  } catch (e) {
    console.error("openRankMatchBreakdown error:", e);
    area.innerHTML = `<div class="center py-16 text-sport-red">No se pudo abrir el desglose.</div>`;
  }
};

window.openRankMatch = async (id, col) => {
  if (!id) return;
  const modal = document.getElementById("modal-match");
  const area = document.getElementById("match-detail-area");
  if (!modal || !area) return;
  modal.classList.add("active");
  area.innerHTML = '<div class="center py-20"><i class="fas fa-spinner fa-spin opacity-20"></i></div>';
  const sessionUser = currentUser || auth.currentUser || null;
  const userDoc = sessionUser?.uid ? await getDocument("usuarios", sessionUser.uid) : {};
  await renderMatchDetail(area, id, col, sessionUser, userDoc);
};

