/* mi-elo.js - ELO detail page */
import { db, getDocument } from "./firebase-service.js";
import { collection, getDocs, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { getResultSetsString, getMatchTeamPlayerIds, toDateSafe } from "./utils/match-utils.js";
import { getFriendlyTeamName } from "./utils/team-utils.js";
import { observeCoreSession } from "./core/core-engine.js";
import {
  ELO_CONFIG,
  buildLevelProgressState,
  getLevelBandByRating,
  ratingFromLevel,
} from "./config/elo-system.js";

let currentUser = null;
let currentUserData = null;
const playerNameCache = new Map();
const matchCache = new Map();

document.addEventListener("DOMContentLoaded", () => {
  initAppUI("mi-elo");
  observeCoreSession({
    onSignedOut: () => window.location.replace("index.html"),
    onReady: async ({ user, userDoc }) => {
      currentUser = user;
      currentUserData = userDoc || {};
      await injectHeader(currentUserData);
      injectNavbar("home");
      renderSummary();
      await loadBreakdown();
    },
  });
});

async function resolvePlayerName(uid) {
  if (!uid) return "Jugador";
  if (String(uid).startsWith("GUEST_")) return String(uid).split("_")[1] || "Invitado";
  if (playerNameCache.has(uid)) return playerNameCache.get(uid);
  try {
    const doc = await getDocument("usuarios", uid);
    const name = doc?.nombreUsuario || doc?.nombre || "Jugador";
    playerNameCache.set(uid, name);
    return name;
  } catch {
    return "Jugador";
  }
}

function renderSummary() {
  const pts = Number(currentUserData?.puntosRanking || currentUserData?.rating || ELO_CONFIG.BASE_RATING);
  const nivel = Number(currentUserData?.nivel || 2.5);
  const played = Number(currentUserData?.partidosJugados || 0);
  const wins = Number(currentUserData?.victorias || 0);
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  const progress = buildLevelProgressState({
    rating: pts,
    levelOverride: nivel,
  });
  const band = getLevelBandByRating(pts);
  const bandMin = ratingFromLevel(progress.prevLevel);
  const bandMax = ratingFromLevel(progress.nextLevel);

  setText("elo-current", String(Math.round(pts)));
  setText("elo-nivel", nivel.toFixed(2));
  setText("elo-played", String(played));
  setText("elo-winrate", `${winrate}%`);
  setText("elo-div-name", band?.name || band?.label || "Bronce");
  setText("elo-lp-pts", `${progress.pointsToUp} pts para subir`);
  setText("elo-lp-min", String(bandMin));
  setText("elo-lp-max", String(bandMax));

  const fill = document.getElementById("elo-lp-fill");
  if (fill) fill.style.width = `${progress.progressPct}%`;

  refreshRank();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function refreshRank() {
  const rankEl = document.getElementById("elo-rank");
  if (!rankEl || !currentUser?.uid) return;
  try {
    const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(500)));
    let pos = 0;
    snap.docs.forEach((d, i) => {
      if (d.id === currentUser.uid) pos = i + 1;
    });
    rankEl.textContent = pos ? `#${pos}` : "#--";
  } catch {
    rankEl.textContent = "#--";
  }
}

async function loadBreakdown() {
  const listEl = document.getElementById("elo-breakdown-list");
  if (!listEl || !currentUser?.uid) return;

  try {
    const [logsSnap, diarySnap] = await Promise.all([
      getDocs(query(collection(db, "rankingLogs"), where("uid", "==", currentUser.uid), orderBy("timestamp", "desc"), limit(60))),
      getDocs(query(collection(db, "diario"), where("uid", "==", currentUser.uid), orderBy("fecha", "desc"), limit(30))),
    ]);

    const items = [];
    logsSnap.forEach((d) => items.push({ ...d.data(), id: d.id, type: "match_log" }));
    diarySnap.forEach((d) => {
      const data = d.data() || {};
      if (Number(data.puntosGanados || 0) > 0) {
        items.push({
          ...data,
          id: d.id,
          type: "diary_log",
          createdAt: data.fecha,
          delta: data.puntosGanados,
          matchType: "Entrenamiento / diario",
        });
      }
    });

    items.sort((a, b) => getItemTime(b) - getItemTime(a));

    if (!items.length) {
      listEl.innerHTML = `<div class="elo-empty">Sin actividad registrada aún.</div>`;
      return;
    }

    const rows = [];
    for (const item of items.slice(0, 50)) {
      rows.push(await renderBreakdownRow(item));
    }
    listEl.innerHTML = rows.join("");
  } catch (e) {
    console.error("Error loading ELO breakdown:", e);
    listEl.innerHTML = `<div class="elo-empty">Error al cargar el desglose. Intenta recargar.</div>`;
  }
}

function getItemTime(item) {
  const ts =
    item?.timestamp?.toMillis?.() ||
    item?.createdAt?.toMillis?.() ||
    item?.date?.toMillis?.() ||
    toDateSafe(item?.timestamp || item?.createdAt || item?.date)?.getTime?.() ||
    0;
  return Number(ts || 0);
}

async function renderBreakdownRow(data) {
  const delta = Number(data.delta || data.pointsDelta || data.diff || 0);
  const after = Number(data.after || data.newRating || data.afterRating || 0);
  const isDiary = data.type === "diary_log";
  const isWin = delta > 0;
  const isDraw = delta === 0;

  const resultCls = isDiary ? "diary" : (isWin ? "win" : isDraw ? "draw" : "loss");
  const resultIcon = isDiary ? "D" : (isWin ? "W" : isDraw ? "E" : "L");
  const deltaCls = isWin ? "positive" : isDraw ? "neutral" : "negative";
  const deltaStr = `${delta > 0 ? "+" : ""}${Math.round(delta)}`;

  const date = toDateSafe(data?.timestamp || data?.createdAt || data?.date) || new Date();
  const dateStr = date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });

  let matchDesc = data.matchType || data.tipo || "Partido";
  let score = data.resultado || data.score || "";

  if (!isDiary && data.matchId) {
    const match = await loadMatchContext(data.matchId, data.matchCollection);
    if (match) {
      matchDesc = await buildMatchupLabel(match);
      score = getResultSetsString(match) || score;
    }
  }

  return `
    <div class="elo-match-row">
      <div class="elo-mr-result ${resultCls}">${resultIcon}</div>
      <div class="elo-mr-info">
        <span class="elo-mr-date">${dateStr}</span>
        <span class="elo-mr-matchup">${escapeHtml(matchDesc)}</span>
        ${score ? `<span class="elo-mr-score">${escapeHtml(score)}</span>` : ""}
      </div>
      <div>
        <span class="elo-mr-delta ${deltaCls}">${deltaStr}</span>
        ${after > 0 ? `<span class="elo-mr-after">${Math.round(after)} ELO</span>` : ""}
      </div>
    </div>
  `;
}

async function loadMatchContext(matchId, preferredCollection) {
  if (!matchId) return null;
  const cacheKey = `${preferredCollection || "auto"}:${matchId}`;
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);

  const cols = preferredCollection
    ? [preferredCollection, "partidosAmistosos", "partidosReto", "eventoPartidos"]
    : ["partidosAmistosos", "partidosReto", "eventoPartidos"];

  for (const col of [...new Set(cols)]) {
    try {
      const doc = await getDocument(col, matchId);
      if (doc) {
        const payload = { ...doc, id: matchId, col };
        matchCache.set(cacheKey, payload);
        return payload;
      }
    } catch (_) {}
  }
  return null;
}

async function buildMatchupLabel(match) {
  const teamAIds = getMatchTeamPlayerIds(match, "A");
  const teamBIds = getMatchTeamPlayerIds(match, "B");
  const teamAPlayers = await Promise.all(teamAIds.map(resolvePlayerName));
  const teamBPlayers = await Promise.all(teamBIds.map(resolvePlayerName));

  const teamA = getFriendlyTeamName({
    teamName: match.teamAName || match.equipoA,
    playerNames: teamAPlayers,
    side: "A",
    fallback: "Pareja A",
  });
  const teamB = getFriendlyTeamName({
    teamName: match.teamBName || match.equipoB,
    playerNames: teamBPlayers,
    side: "B",
    fallback: "Pareja B",
  });
  return `${teamA} vs ${teamB}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
