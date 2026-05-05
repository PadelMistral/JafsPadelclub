import { db, getDocsSafe, getDocument, auth, observerAuth } from "./firebase-service.js";
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
    observerAuth(async (user) => {
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

  let searchDebounceTimer = null;
  document.getElementById("rank-search")?.addEventListener("input", (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      currentSearch = String(e.target.value || "").toLowerCase().trim();
      renderTable();
    }, 250);
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
      const played = Number(u.partidosJugados || 0);
      const won = Number(u.victorias || 0);
      const wr = played > 0 ? Math.round((won / played) * 100) : 0;
      const progress = getCoreLevelProgressState({
        rating: Number(u.puntosRanking || 1000),
        levelOverride: Number(u.nivel || levelFromRating(u.puntosRanking)),
      });
      const progressHint = progress.pointsToUp <= progress.pointsToDown
        ? `Subida ${progress.pointsToUp}`
        : `Bajada ${progress.pointsToDown}`;
      return `
        <div class="ranking-card-v8 ${rankClass} ${tierClass} ${isMe ? "me" : ""} animate-up"
             style="animation-delay: ${i * 20}ms;"
             onclick="window.openRankUserModal('${u.id}')"
             role="button"
             tabindex="0">
          <div class="rc8-left">
            <span class="rc8-rank">${rank}</span>
          </div>
          <div class="rc8-avatar-wrap">
            ${renderAvatarMarkup(u, "rc8-avatar")}
          </div>
          <div class="rc8-body">
            <div class="rc8-name-row">
              <span class="rc8-name">${u.nombreUsuario || u.nombre || "Jugador"}</span>
              <span class="rc8-level">Nivel ${lvl}</span>
              ${isMe ? '<span class="rc8-badge-me">TÚ</span>' : ''}
            </div>
            <div class="rc8-stats">
              <span><i class="fas fa-trophy"></i> ${won} / ${played}</span>
              <span class="rc8-vr"></span>
              <span>${wr}% WR</span>
              <span class="rc8-vr"></span>
              <span class="${streak > 0 ? 'text-green-400' : streak < 0 ? 'text-red-400' : ''}"><i class="fas fa-fire"></i> ${streakLabel}</span>
            </div>
            <div class="rc8-tier-row">
              <span class="rc8-tier-chip">${getTierLabel(rank)}</span>
              <span class="rc8-state-hint state-${progress.stateClass}">${progress.stateLabel} ${progressHint}</span>
            </div>
          </div>
          <div class="rc8-right">
            <span class="rc8-pts">${pts}</span>
            <span class="rc8-pts-label">PTS</span>
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
      <div class="ranking-card-v8 animate-up"
           style="animation-delay:${i * 20}ms"
           onclick="window.openRankUserModal('${u.id}')"
           role="button"
           tabindex="0">
        <div class="rc8-left">
          <span class="rc8-rank">${i + 1}</span>
        </div>
        <div class="rc8-avatar-wrap">
          ${renderAvatarMarkup(u, "rc8-avatar")}
        </div>
        <div class="rc8-body">
          <div class="rc8-name-row">
            <span class="rc8-name">${u.nombreUsuario || u.nombre || "Jugador"}</span>
            <span class="rc8-level ${isCurrentMonth ? '' : 'text-white/50'}">MES</span>
          </div>
          <div class="rc8-tier-row">
            <span class="rc8-tier-chip">${season.label}</span>
          </div>
        </div>
        <div class="rc8-right">
          <span class="rc8-pts ${u.seasonPoints > 0 ? 'text-green-400' : 'text-red-400'}">${u.seasonPoints >= 0 ? "+" : ""}${u.seasonPoints.toFixed(1)}</span>
          <span class="rc8-pts-label">PTS</span>
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
      // index not ready yet Ã¢â‚¬â€ fetch without ordering
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


// openRankUserModal definida más abajo (versión completa con H2H y desglose competitivo)

async function buildHeadToHeadSummary(uid) {
  const collections = ["partidosAmistosos", "partidosReto", "eventoPartidos"];
  const matches = [];
  for (const col of collections) {
    const snap = await getDocsSafe(query(collection(db, col), where("jugadores", "array-contains", uid), limit(80)));
    (snap?.docs || []).forEach((docSnap) => matches.push({ id: docSnap.id, col, ...docSnap.data() }));
  }
  const rivals = new Map();
  for (const match of matches) {
    const players = getNormalizedPlayers(match);
    const idx = players.findIndex((item) => item === uid);
    if (idx === -1) continue;
    const rivalIds = idx < 2 ? players.slice(2, 4) : players.slice(0, 2);
    const mySide = idx < 2 ? "A" : "B";
    const winner = String(match?.resultado?.ganador || resolveFriendlyWinner(match) || "");
    rivalIds.filter(Boolean).forEach((rivalId) => {
      if (!rivals.has(rivalId)) rivals.set(rivalId, { wins: 0, losses: 0, matches: [] });
      const row = rivals.get(rivalId);
      if (winner) {
        if (winner === mySide) row.wins += 1;
        else row.losses += 1;
      }
      row.matches.push(match);
    });
  }
  const entries = await Promise.all([...rivals.entries()].map(async ([rivalId, stats]) => {
    const identity = await resolveIdentity(rivalId, { currentUserId: currentUser?.uid, currentUserData }).catch(() => null);
    return {
      rivalId,
      name: identity?.name || "Jugador",
      wins: stats.wins,
      losses: stats.losses,
      total: stats.wins + stats.losses,
      matches: stats.matches.sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0)).slice(0, 3),
    };
  }));
  return entries.sort((a, b) => b.total - a.total).slice(0, 6);
}

function resolveFriendlyWinner(match) {
  const raw = String(match?.resultado?.sets || match?.resultado || "").trim();
  if (!raw) return "";
  let a = 0;
  let b = 0;
  raw.split(/\s+/).forEach((setScore) => {
    const parts = setScore.split("-").map(Number);
    if (parts.length !== 2) return;
    if (parts[0] > parts[1]) a += 1;
    if (parts[1] > parts[0]) b += 1;
  });
  if (a === b) return "";
  return a > b ? "A" : "B";
}

function resolveUserOutcomeAgainstMatch(match, uid) {
  const teamA = getMatchTeamPlayerIds(match, "A");
  const teamB = getMatchTeamPlayerIds(match, "B");
  const winner = String(match?.resultado?.ganador || resolveFriendlyWinner(match) || "");
  if (!winner) return "neutral";
  if (teamA.includes(uid)) return winner === "A" ? "win" : "loss";
  if (teamB.includes(uid)) return winner === "B" ? "win" : "loss";
  return "neutral";
}

function getRankingFactorRows(detail = {}) {
  if (!detail || typeof detail !== "object") return [];
  if (detail.factoresAdicionales) {
    const rows = [
      ["Elo dinámico", detail.cambioElo],
      ["Compañero", detail.factoresAdicionales?.companero],
      ["Racha", detail.factoresAdicionales?.racha],
      ["Sets", detail.factoresAdicionales?.margenSets],
      ["Balance", detail.ajusteBalance],
    ];
    if (detail.sumaTotal && detail.limiteAplicado && Math.abs(detail.sumaTotal) > Math.abs(detail.limiteAplicado)) {
      rows.push(["Tope", Number((detail.limiteAplicado - detail.sumaTotal).toFixed(2))]);
    }
    return rows.filter(([, value]) => value !== undefined && value !== null && !Number.isNaN(Number(value)));
  }
  return [
    ["Base", detail.base],
    ["Racha", detail.racha || detail.streak],
    ["Sorpresa", detail.sorpresa || detail.surprise],
    ["Sets", detail.clutch || detail.sets],
    ["Nivel", detail.habilidad || detail.skill],
    ["Balance", detail.ajusteBalance],
  ].filter(([, value]) => value !== undefined && value !== null && !Number.isNaN(Number(value)));
}

async function resolveCompetitiveMatchSummary(uid, log) {
  const diff = Number(log?.diff || 0);
  const col = log?.matchCollection || log?.matchCol || "partidosAmistosos";
  const typeLabel = log?.type || (col === "eventoPartidos" ? "TORNEO" : col === "partidosReto" ? "RETO" : "AMISTOSO");
  const detail = log?.details?.breakdown || log?.details?.puntosDetalle || {};
  const pointsBefore = Number(log?.details?.pointsBefore);
  const pointsAfter = Number(log?.details?.pointsAfter ?? log?.newTotal);
  const levelBefore = Number(log?.details?.levelBefore || 0);
  const levelAfter = Number(log?.details?.levelAfter || 0);
  const factorRows = getRankingFactorRows(detail);
  const visibleRows = factorRows.slice(0, 5);
  const subtotal = Number(detail.subtotalVariables ?? detail.totalCalculado ?? diff);
  const finalDelta = Number(detail.finalDelta ?? diff);
  const when = fmtDate(log?.timestamp || log?.details?.timestamp);
  const won = log?.won ?? diff >= 0;
  const matchId = String(log?.matchId || "");
  const match = matchId ? await getMatchById(matchId).catch(() => null) : null;

  const summary = {
    typeLabel,
    diff,
    when,
    won,
    sets: String(log?.sets || log?.details?.sets || match?.resultado?.sets || match?.resultado || "Sin marcador"),
    factorRows: visibleRows,
    subtotal,
    finalDelta,
    pointsBefore,
    pointsAfter,
    levelBefore,
    levelAfter,
    beforeProgress: Number.isFinite(pointsBefore) ? getCoreLevelProgressState({ rating: pointsBefore, levelOverride: levelBefore || undefined }) : null,
    afterProgress: Number.isFinite(pointsAfter) ? getCoreLevelProgressState({ rating: pointsAfter, levelOverride: levelAfter || undefined }) : null,
    rivalNames: [],
    partnerNames: [],
    match,
    col,
    logId: log?.id || "",
    matchId,
  };

  if (!match) return summary;

  const arr = getNormalizedPlayers(match);
  const myIdx = arr.findIndex((item) => item === uid);
  if (myIdx === -1) return summary;
  const myTeamIds = myIdx < 2 ? arr.slice(0, 2) : arr.slice(2, 4);
  const rivalIds = myIdx < 2 ? arr.slice(2, 4) : arr.slice(0, 2);
  const partnerIds = myTeamIds.filter((playerUid) => playerUid && playerUid !== uid);

  const resolveName = async (playerUid) => {
    if (!playerUid) return "Vacío";
    const identity = await resolveIdentity(playerUid, {
      currentUserId: currentUser?.uid,
      currentUserData,
      userMap: Object.fromEntries(users.map((user) => [user.id, user])),
    }).catch(() => null);
    if (identity?.name) return identity.name;
    const guest = parseGuestMeta(playerUid);
    if (guest?.name) return guest.name;
    const userDoc = users.find((item) => item.id === playerUid) || await getDocument("usuarios", playerUid).catch(() => null);
    return userDoc?.nombreUsuario || userDoc?.nombre || "Jugador";
  };

  summary.rivalNames = await Promise.all(rivalIds.filter(Boolean).map(resolveName));
  summary.partnerNames = await Promise.all(partnerIds.filter(Boolean).map(resolveName));
  return summary;
}

window.openRankUserModal = async (uid) => {
  if (!uid) return;
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
    const rank = users.findIndex((x) => x.id === uid) + 1;
    const played = Number(u.partidosJugados || 0);
    const won = Number(u.victorias || 0);
    const losses = Math.max(0, played - won);
    const streak = Number(u.computedStreak ?? u.rachaActual ?? 0);
    const winRate = played ? Math.round((won / played) * 100) : 0;
    const state = getCoreLevelProgressState({ rating: points, levelOverride: level });
    const name = u.nombreUsuario || u.nombre || "Jugador";
    const centeredPct = buildCenteredProgress(state.pointsToDown, state.pointsToUp);
    const h2h = await buildHeadToHeadSummary(uid);
    let logs = [];
    try {
      const logsSnap = await getDocsSafe(
        query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(24)),
      );
      logs = (logsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    } catch (_) {
      const logsSnap = await getDocsSafe(
        query(collection(db, "rankingLogs"), where("uid", "==", uid), limit(24)),
      );
      logs = (logsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
      logs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    }
    const recentMatches = await Promise.all(logs.map((log) => resolveCompetitiveMatchSummary(uid, log)));
    if (title) title.textContent = `PERFIL COMPETITIVO · ${name.toUpperCase()}`;

    body.innerHTML = `
      <div class="rank-user-head-card rank-user-head-card--premium">
        <div class="rank-user-topline">
          ${renderAvatarMarkup(u, "rank-user-avatar")}
          <div class="rank-user-main">
            <span class="rank-user-name">${name}</span>
            <span class="rank-user-meta">#${rank > 0 ? rank : "--"} · ${Math.round(points)} pts · Nivel ${level.toFixed(2)}</span>
          </div>
        </div>
        <div class="rank-user-pro-grid">
          <div class="rank-user-pro-card"><span>Récord</span><strong>${won}V · ${losses}D</strong></div>
          <div class="rank-user-pro-card"><span>Win rate</span><strong>${winRate}%</strong></div>
          <div class="rank-user-pro-card"><span>Racha</span><strong>${streak > 0 ? "+" : ""}${streak}</strong></div>
        </div>
        <div class="rank-progress-wrap">
          <div class="rank-progress-info">
            <span>Progreso de nivel</span>
            <b>${centeredPct.toFixed(1)}%</b>
          </div>
          <div class="level-bar"><div class="level-fill" style="width:${centeredPct}%"></div></div>
          <div class="rank-progress-foot">
            <span>Baja con ${state.pointsToDown} pts</span>
            <span class="text-primary">Nivel ${state.currentLevel.toFixed(2)} · ${Math.round(points)} pts</span>
            <span>Sube con ${state.pointsToUp} pts</span>
          </div>
        </div>
      </div>
      <div class="rank-user-section-title">Desglose vs rivales</div>
      <div class="rank-rival-list">
        ${h2h.length ? h2h.map((row) => `
          <div class="rank-rival-row">
            <div>
              <strong>${row.name}</strong>
              <div class="text-[10px] text-white/56 mt-1">Historial: ${row.total} enfrentamientos</div>
            </div>
            <div class="text-right">
              <strong class="${row.wins >= row.losses ? "text-sport-green" : "text-sport-red"}">${row.wins}V · ${row.losses}D</strong>
              <div class="text-[10px] text-white/56 mt-1">${row.total ? Math.round((row.wins / row.total) * 100) : 0}% win</div>
            </div>
          </div>
        `).join("") : `<div class="center py-10 opacity-40">Todavía no hay historial suficiente frente a rivales.</div>`}
      </div>
      <div class="rank-user-section-title">Partidos y puntos (${recentMatches.length})</div>
      <div class="rank-competitive-timeline">
        ${recentMatches.length ? recentMatches.map((entry) => `
          <article class="rank-competitive-card compact ${entry.won ? "win" : "loss"}" onclick="window.openRankMatchBreakdown('${entry.logId}','${entry.matchId}','${entry.col}')" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; margin-bottom:8px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); cursor:pointer;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="font-size:13px; font-weight:700; color:#fff; text-transform:uppercase;">
                VS ${entry.rivalNames.length ? entry.rivalNames.join(" / ") : "Rivales"}
              </div>
              <div style="font-size:10px; color:rgba(255,255,255,0.5);">
                ${entry.when} · ${entry.sets || "Sin resultado"}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:15px; font-weight:900; font-family:'Rajdhani', sans-serif; color: ${entry.diff >= 0 ? 'var(--sport-green)' : 'var(--sport-red)'};">
                ${entry.diff >= 0 ? "+" : ""}${Math.round(entry.diff)}
              </span>
              <i class="fas fa-chevron-right" style="font-size:10px; color:rgba(255,255,255,0.3);"></i>
            </div>
          </article>
        `).join("") : `<div class="center py-10 opacity-40">Todavía no hay partidos con desglose competitivo suficiente.</div>`}
      </div>
      <div class="rank-user-section-title">Últimos cara a cara</div>
      <div class="rank-rival-list">
        ${h2h.length ? h2h.flatMap((row) => (row.matches || []).map((match) => ({
            rivalName: row.name,
            match,
            outcome: resolveUserOutcomeAgainstMatch(match, uid),
          }))).sort((a, b) => (b.match?.fecha?.seconds || 0) - (a.match?.fecha?.seconds || 0)).slice(0, 4).map((entry) => `
          <div class="rank-recent-duel ${entry.outcome}">
            <div>
              <strong>${entry.rivalName}</strong>
              <div class="text-[10px] text-white/56 mt-1">${fmtDate(entry.match?.fecha)} · ${entry.match?.resultado?.sets || entry.match?.resultado || "Sin resultado"}</div>
            </div>
            <span class="rank-duel-badge ${entry.outcome}">${entry.outcome === "win" ? "Victoria" : entry.outcome === "loss" ? "Derrota" : "Pendiente"}</span>
          </div>`).join("") : `<div class="center py-10 opacity-40">Aún no hay enfrentamientos recientes para mostrar.</div>`}
      </div>
    `;
  } catch (error) {
    console.error("Enhanced rank user modal error:", error);
    body.innerHTML = `<div class="center py-16 text-sport-red">No se pudo cargar el jugador.<br><span class="text-xs opacity-60">${error.message}</span></div>`;
  }
};

// Cerrar modales con ESC
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const stackFront = document.querySelector(".modal-overlay.modal-stack-front.active");
  if (stackFront) {
    stackFront.classList.remove("active", "modal-stack-front");
    return;
  }
  const anyModal = document.querySelector(".modal-overlay.active");
  if (anyModal) anyModal.classList.remove("active");
});

window.openRankMatchBreakdown = async (logId, matchId, col) => {
  const mainModal = document.getElementById("modal-match");
  const area = document.getElementById("match-detail-area");
  const titleEl = document.getElementById("modal-titulo");
  if (!mainModal || !area) return;
  area.innerHTML = '<div class="center py-20"><i class="fas fa-spinner fa-spin opacity-30"></i></div>';
  mainModal.classList.add("active", "modal-stack-front");
  if (titleEl) titleEl.textContent = "Desglose de puntuación";
  try {
    const logDoc = logId ? await getDocument("rankingLogs", logId) : null;
    const match = matchId ? await getMatchById(matchId) : null;
    const detail = logDoc?.details?.breakdown || logDoc?.details?.puntosDetalle || {};
    const diff = Number(logDoc?.diff || 0);
    const won = logDoc?.won ?? diff >= 0;
    const pointsBefore = Number(logDoc?.details?.pointsBefore);
    const pointsAfter = Number(logDoc?.details?.pointsAfter ?? logDoc?.newTotal);
    const levelBefore = Number(logDoc?.details?.levelBefore || 0);
    const levelAfter = Number(logDoc?.details?.levelAfter || 0);
    const factorRows = getRankingFactorRows(detail);
    const transparentRows = detail.factoresAdicionales
      ? [
          ["Elo base esperado", detail.cambioElo],
          ["Puntos por compañero", detail.factoresAdicionales?.companero],
          ["Puntos por racha", detail.factoresAdicionales?.racha],
          ["Puntos por sets", detail.factoresAdicionales?.margenSets],
          ["Balance final", detail.ajusteBalance],
        ].filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(Number(v)))
      : factorRows;
    const beforeProgress = Number.isFinite(pointsBefore)
      ? getCoreLevelProgressState({ rating: pointsBefore, levelOverride: levelBefore || undefined }) : null;
    const afterProgress = Number.isFinite(pointsAfter)
      ? getCoreLevelProgressState({ rating: pointsAfter, levelOverride: levelAfter || undefined }) : null;

    let matchInfoHtml = "";
    if (match) {
      const arr = getNormalizedPlayers(match);
      const pNames = await Promise.all(arr.map(async (uid) => {
        if (!uid) return "Vacío";
        const identity = await resolveIdentity(uid, {
          currentUserId: currentUser?.uid, currentUserData,
          userMap: Object.fromEntries(users.map(u => [u.id, u])),
        }).catch(() => null);
        if (identity?.name) return identity.name;
        const guest = parseGuestMeta(uid);
        if (guest?.name) return guest.name;
        const u = users.find(x => x.id === uid) || await getDocument("usuarios", uid).catch(() => null);
        return u?.nombreUsuario || u?.nombre || "Jugador";
      }));
      const teamAIds = getMatchTeamPlayerIds(match, "A");
      const teamBIds = getMatchTeamPlayerIds(match, "B");
      const t1 = getFriendlyTeamName({ teamName: match.teamAName || match.equipoA, playerNames: teamAIds.map(uid => pNames[arr.indexOf(uid)]).filter(Boolean), fallback: "Pareja 1", side: "A" });
      const t2 = getFriendlyTeamName({ teamName: match.teamBName || match.equipoB, playerNames: teamBIds.map(uid => pNames[arr.indexOf(uid)]).filter(Boolean), fallback: "Pareja 2", side: "B" });
      const pillRow = (ids) => ids.map(uid => `<span class="rank-player-pill">${pNames[arr.indexOf(uid)] || "Jugador"}</span>`).join("");
      const sets = match?.resultado?.sets || match?.resultado || "Sin resultado";
      matchInfoHtml = `
        <div class="rank-break-match premium">
          <div class="rank-break-versus">
            <div class="rank-break-team-block">
              <span class="rank-break-team-name">${t1}</span>
              <div class="rank-player-pill-row">${pillRow(teamAIds)}</div>
            </div>
            <span class="rank-break-versus-badge">VS</span>
            <div class="rank-break-team-block">
              <span class="rank-break-team-name">${t2}</span>
              <div class="rank-player-pill-row">${pillRow(teamBIds)}</div>
            </div>
          </div>
          <div class="match-sub">${fmtDate(match.fecha)} · ${sets}</div>
        </div>`;
    }

    const rowHtml = (rows, emphasis = false) => rows.map(([k, v]) => {
      const val = Number(v);
      const cls = val > 0 ? "text-sport-green" : val < 0 ? "text-sport-red" : "";
      return `<div class="rank-break-row${emphasis ? " emphasis" : ""}"><span>${k}</span><b class="${cls}">${val > 0 ? "+" : ""}${num(v, 2)}</b></div>`;
    }).join("");

    area.innerHTML = `
      <div class="rank-breakdown-card">
        ${matchInfoHtml}
        ${transparentRows.length ? `
        <div class="rank-break-title">Desglose de puntuación</div>
        <div class="rank-break-subtitle">Suma visible del cálculo</div>
        <div class="rank-break-grid">${rowHtml(transparentRows, true)}</div>
        <div class="rank-break-level">Subtotal ${num(detail.subtotalVariables ?? detail.totalCalculado ?? diff, 2)} · Balance ${num(detail.ajusteBalance || 0, 2)} · Delta ${num(detail.finalDelta || diff, 2)}</div>
        ` : ""}
        <div class="rank-break-total">
          <div class="total-main">
            <span>Total partido</span>
            <b class="${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${diff >= 0 ? "+" : ""}${num(diff, 2)}</b>
          </div>
          <div class="total-calc">
            ${Number.isFinite(pointsBefore) ? Math.round(pointsBefore) : "??"}
            <span style="opacity:0.4;margin:0 4px">+</span>
            <span class="${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${num(diff, 2)}</span>
            <span style="opacity:0.4;margin:0 4px">=</span>
            <span style="color:#fff">${Number.isFinite(pointsAfter) ? Math.round(pointsAfter) : "??"} PTS</span>
          </div>
        </div>
        <div class="rank-break-level">Nivel ${levelBefore ? levelBefore.toFixed(2) : "--"} → ${levelAfter ? levelAfter.toFixed(2) : "--"}</div>
        ${beforeProgress && afterProgress ? `
        <div class="rank-break-prog-wrap">
          <div class="rank-break-prog-row"><span>Antes (${Number.isFinite(pointsBefore) ? Math.round(pointsBefore) : "--"} pts)</span><b>${beforeProgress.progressPct.toFixed(2)}%</b></div>
          <div class="level-bar"><div class="level-fill" style="width:${beforeProgress.progressPct}%"></div></div>
          <div class="rank-break-prog-row" style="margin-top:6px"><span>Después (${Number.isFinite(pointsAfter) ? Math.round(pointsAfter) : "--"} pts)</span><b>${afterProgress.progressPct.toFixed(2)}%</b></div>
          <div class="level-bar"><div class="level-fill" style="width:${afterProgress.progressPct}%"></div></div>
        </div>` : ""}
      </div>`;
  } catch (e) {
    console.error("openRankMatchBreakdown error:", e);
    area.innerHTML = `<div class="center py-16 text-sport-red">No se pudo abrir el desglose.<br><span style="font-size:11px;opacity:0.6">${e.message}</span></div>`;
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

window.closeRankingMatchModal = () => {
  const modal = document.getElementById("modal-match");
  if (modal) {
    modal.classList.remove("active", "modal-stack-front");
  }
};
