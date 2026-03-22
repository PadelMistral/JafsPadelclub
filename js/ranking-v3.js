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

let users = [];
let currentUser = null;
let currentUserData = null;
let currentSearch = "";
let currentFilter = "all";
const matchCache = new Map();

function getInitials(name = "") {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function renderAvatarMarkup(user, className = "lb-avatar") {
  const name = user?.nombreUsuario || user?.nombre || "Jugador";
  const initials = getInitials(name);
  const photo = user?.fotoPerfil || user?.fotoURL || user?.photoURL || "";
  if (photo) {
    return `<img src="${photo}" class="${className}" alt="${name}" onerror="this.outerHTML='<span class=&quot;${className} avatar-fallback&quot;>${initials}</span>'" />`;
  }
  return `<span class="${className} avatar-fallback">${initials}</span>`;
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
  const match = fromReto || (await getDocument("partidosAmistosos", matchId)) || null;
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
  const sat = rank > 50 ? 40 : 70;
  const light = rank > 50 ? 55 : 58 + Math.round(10 * (1 - t));
  const tintOpacity = rank > 50 ? 0.06 : 0.12;
  const hue = hueBase + Math.round(10 * (1 - t));
  return `--rank-accent:hsl(${hue} ${sat}% ${light}%); --rank-tint:hsla(${hue} ${sat}% ${light}% / ${tintOpacity});`;
}

document.addEventListener("DOMContentLoaded", async () => {
  initAppUI("ranking-v3");
  currentUser = auth.currentUser;
  if (currentUser?.uid) {
    currentUserData = (await getDocument("usuarios", currentUser.uid)) || {};
    await injectHeader(currentUserData || {});
    updateHeader(currentUserData || {});
  } else {
    auth.onAuthStateChanged(async (user) => {
      if (!user?.uid) return;
      currentUser = user;
      currentUserData = (await getDocument("usuarios", user.uid)) || {};
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
});

async function loadRanking() {
  const q = query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(200));
  const snap = await getDocsSafe(q);
  users = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  renderPodium();
  renderTable();
  const info = document.getElementById("lb-total-info");
  if (info) info.textContent = `${users.length} jugadores en el top`;
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
    if (pod) pod.onclick = () => window.openRankUserModal(u.id);
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
  });

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
      return `
        <div class="ranking-card ${rankClass} ${tierClass} ${isMe ? "me" : ""} animate-up"
             style="animation-delay: ${i * 20}ms; ${tierStyle}"
             onclick="window.openRankUserModal('${u.id}')">
          <span class="rank-number-v7 ${rank <= 3 ? "glow" : ""}">${rank}</span>
          ${renderAvatarMarkup(u, "lb-avatar")}
          <div class="lb-info">
            <span class="lb-name">${u.nombreUsuario || u.nombre || "Jugador"} ${isMe ? '<i class="fas fa-user-circle text-[8px] text-primary ml-1"></i>' : ""}</span>
            <span class="lb-level">Nivel ${lvl}</span>
          </div>
          <div class="flex-col items-end">
            <span class="lb-pts">${pts}</span>
            <span class="text-[8px] font-bold opacity-40 uppercase tracking-widest">ELO PTS</span>
          </div>
        </div>
      `;
    })
    .join("");
}

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
    const state = getCoreLevelProgressState({
      rating: points,
      levelOverride: level,
    });
    const rank = users.findIndex((x) => x.id === uid) + 1;
    const name = u.nombreUsuario || u.nombre || "Jugador";
    const centeredPct = buildCenteredProgress(state.pointsToDown, state.pointsToUp);
    if (title) title.textContent = `PERFIL COMPETITIVO · ${name.toUpperCase()}`;

    const logsSnap = await getDocsSafe(
      query(
        collection(db, "rankingLogs"),
        where("uid", "==", uid),
        orderBy("timestamp", "desc"),
        limit(12),
      ),
    );
    const logs = (logsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));

    const cards = await Promise.all(
      logs.map(async (log) => {
        const diff = Number(log.diff || 0);
        const match = log.matchId ? await getMatchById(log.matchId) : null;
        const sets = match?.resultado?.sets || log.details?.sets || "Sin sets";
        const when = fmtDate(match?.fecha || log.timestamp);
        const col = log.matchCollection || log.matchCol || "partidosAmistosos";
        return `
          <button class="rank-match-card ${diff >= 0 ? "pos" : "neg"}"
                  onclick="window.openRankMatchBreakdown('${log.id}','${log.matchId || ""}','${col}')">
            <div class="rank-match-top">
              <span class="rank-match-type">${log.type || "PARTIDO"}</span>
              <span class="rank-match-date">${when}</span>
            </div>
            <div class="rank-match-main">
              <span class="rank-match-sets">${sets}</span>
              <span class="rank-match-diff ${diff >= 0 ? "text-sport-green" : "text-sport-red"}">${diff >= 0 ? "+" : ""}${num(diff, 2)}</span>
            </div>
            <div class="rank-match-foot">Pulsa para ver desglose y progreso</div>
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
        <div class="rank-progress-wrap">
          <div class="rank-progress-info">
            <span>Progreso de nivel</span>
            <b>${centeredPct.toFixed(2)}%</b>
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
      <div class="rank-user-section-title">Partidos recientes</div>
      <div class="rank-match-list">${cards.join("") || '<div class="center py-10 opacity-40">Sin actividad reciente</div>'}</div>
    `;
  } catch (e) {
    console.error("Rank user modal error:", e);
    body.innerHTML = `<div class="center py-16 text-sport-red">No se pudo cargar el jugador.</div>`;
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
    const detail = logDoc?.details?.puntosDetalle || {};
    const factors = [
      ["Base", detail.base],
      ["Dificultad", detail.dificultad],
      ["Racha", detail.racha],
      ["Sorpresa", detail.sorpresa],
      ["Skill", detail.skill],
      ["Sets", detail.sets],
      ["Rendimiento", detail.rendimientoBonus],
      ["Diario", detail.diarioCoach],
      ["Justicia", detail.ajusteJusticia],
    ].filter(([, v]) => v !== undefined && v !== null);

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
        const teamA = getFriendlyTeamName({ teamName: match.teamAName, teamId: match.teamAId, side: "A" });
        const teamB = getFriendlyTeamName({ teamName: match.teamBName, teamId: match.teamBId, side: "B" });
        matchInfoHtml = `
            <div class="rank-break-match">
                <span class="match-teams">${teamA} <span class="text-primary mx-1">VS</span> ${teamB}</span>
                <span class="match-sub">${fmtDate(match.fecha)} · ${match.resultado?.sets || match.resultado || 'Sin resultado'}</span>
            </div>
        `;
    }

    area.innerHTML = `
      <div class="rank-breakdown-card">
        ${matchInfoHtml}
        <div class="rank-break-title">Desglose de puntuación</div>
        <div class="rank-break-grid">
          ${factors.map(([k, v]) => `<div class="rank-break-row"><span>${k}</span><b>${Number(v) >= 0 ? "+" : ""}${num(v, 2)}</b></div>`).join("")}
        </div>
        
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

        <div class="rank-break-level">Nivel ${levelBefore ? levelBefore.toFixed(2) : "--"} → ${levelAfter ? levelAfter.toFixed(2) : "--"}</div>
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
