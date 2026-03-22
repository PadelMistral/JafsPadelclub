// ranking.js - Leaderboard & Points History V5.0 (con desglose detallado CORREGIDO)
import { db, auth, getDocument } from "./firebase-service.js";
import {
  collection,
  doc,
  getDoc,
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
import { shareMatchResult } from "./utils/share-utils.js";
import {
  aggregateCoreMonthlyImprovement,
  computeCompetitiveWinrate,
  computeRankingMetric,
  getCoreDivisionByRating,
  getCoreLevelProgressState,
  getDivisionMovement,
  observeCoreSession,
} from "./core/core-engine.js";

let currentUser = null;
let userData = null;
window.podiumData = [];
const historyUserCache = new Map();
const historyMatchCache = new Map();
let recentFormBusy = false;
let recentFormFetchedAt = 0;
let rankingCtxCacheAt = 0;
let rankingCtx = {
  logsByUid: new Map(),
  monthlyImprovement: new Map(),
};
const rankingFilters = {
  sort: "elo",
  minPlayed: 0,
  search: "",
};

function getInitials(name = "") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "JP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function renderAvatarWithFallback(photo, name, cls = "lb-avatar-img") {
  const initials = getInitials(name);
  if (photo) {
    return `<img src="${photo}" alt="${name}" class="${cls}" loading="lazy" onerror="this.outerHTML='<span class=&quot;avatar-fallback&quot;>${initials}</span>'">`;
  }
  return `<span class="avatar-fallback">${initials}</span>`;
}

async function getCachedUserName(uid) {
  if (!uid) return "Jugador";
  if (historyUserCache.has(uid)) return historyUserCache.get(uid);
  const u = await getDocument("usuarios", uid);
  const name = u?.nombreUsuario || u?.nombre || "Jugador";
  historyUserCache.set(uid, name);
  return name;
}

async function getCachedMatch(matchId) {
  if (!matchId) return null;
  if (historyMatchCache.has(matchId)) return historyMatchCache.get(matchId);
  const match = (await getDocument("partidosReto", matchId)) || (await getDocument("partidosAmistosos", matchId));
  historyMatchCache.set(matchId, match || null);
  return match || null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getPointsComponents(raw = {}) {
  const pc = raw || {};
  const used = new Set();
  const pick = (...keys) => {
    for (const k of keys) {
      if (pc[k] !== undefined) {
        used.add(k);
        return toNum(pc[k]);
      }
    }
    return 0;
  };

  const base = pick("base");
  const dificultad = pick("dificultad", "rival");
  const sets = pick("sets");
  const rendimiento = pick("rendimientoBonus", "companero", "compañero");
  const racha = pick("racha");
  const penalizacion = pick("smurfPenalty", "penalizacion", "penalty");
  const diario = pick("diarioCoach", "diarioBonus", "diario");
  const justicia = pick("ajusteJusticia", "fairnessAdjustment");

  const excluded = new Set([
    ...used,
    "multiplicador",
    "expectedScore",
    "expected",
    "K",
    "k",
    "levelBefore",
    "levelAfter",
    "newTotal",
    "oldTotal",
    "prob",
    "probability",
    "winProb",
    "notes",
  ]);

  let extras = 0;
  Object.entries(pc).forEach(([k, v]) => {
    if (excluded.has(k)) return;
    const num = Number(v);
    if (!Number.isFinite(num)) return;
    if (Math.abs(num) > 1000) return;
    extras += num;
  });

  const total = base + dificultad + sets + rendimiento + racha + penalizacion + diario + justicia + extras;
  return {
    base,
    dificultad,
    sets,
    rendimiento,
    racha,
    penalizacion,
    diario,
    justicia,
    extras,
    total,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  initAppUI("ranking");
  initBackground();
  setupModals();
  bindAdvancedRankingFilters();

  observeCoreSession({
    onSignedOut: () => {
      window.location.href = "index.html";
    },
    onReady: async ({ user, userDoc }) => {
      currentUser = user;
      userData = userDoc || {};

      await injectHeader(userData);
      injectNavbar("ranking");

      await initRankingRealTime();
      await window.loadPointsHistory('mine');
    },
  });
});

function bindAdvancedRankingFilters() {
  const sortEl = document.getElementById("rank-sort-metric");
  const minEl = document.getElementById("rank-min-played");
  const searchEl = document.getElementById("rank-search-user");
  if (sortEl) sortEl.addEventListener("change", (e) => { rankingFilters.sort = String(e.target.value || "elo"); if (window.__lastRankList) renderRanking(window.__lastRankList); });
  if (minEl) minEl.addEventListener("change", (e) => { rankingFilters.minPlayed = Number(e.target.value || 0); if (window.__lastRankList) renderRanking(window.__lastRankList); });
  if (searchEl) searchEl.addEventListener("input", (e) => { rankingFilters.search = String(e.target.value || "").trim().toLowerCase(); if (window.__lastRankList) renderRanking(window.__lastRankList); });
}

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
        window.__lastRankList = list;
        await renderRanking(list);
    }, [], [["puntosRanking", "desc"]]);
}

async function renderRanking(list) {
  await ensureRankingContext(list);
  const displayList = getFilteredAndSortedList(list);
  const myIdx = list.findIndex((u) => u.id === currentUser.uid);
  const totalPlayers = displayList.length || 1;
  const totalInfoEl = document.getElementById("lb-total-info");
  if (totalInfoEl) totalInfoEl.textContent = `${totalPlayers} jugadores clasificados`;

  if (myIdx !== -1) {
    const me = list[myIdx];
    const myPts = Number(me.puntosRanking || 1000);
    const played = Number(me.partidosJugados || 0);
    const streak = Number(me.rachaActual || 0);

    document.getElementById("my-rank").textContent = `#${me.rank}`;
    countUp(document.getElementById("my-pts"), myPts);
    document.getElementById("my-level").textContent = (me.nivel || 2.5).toFixed(2);
    const playedEl = document.getElementById("my-played");
    const levelCardEl = document.getElementById("my-level-card");
    if (playedEl) playedEl.textContent = `${played}`;
    if (levelCardEl) levelCardEl.textContent = (me.nivel || 2.5).toFixed(2);

    const levelState = getLevelProgressState(me.nivel, myPts);
    document.getElementById("level-fill").style.width = `${levelState.progressPct}%`;
    document.getElementById("level-prev").textContent = levelState.prevLevel.toFixed(2);
    document.getElementById("level-next").textContent = levelState.nextLevel.toFixed(2);
    const levelPercentEl = document.getElementById("level-percent");
    if (levelPercentEl) levelPercentEl.textContent = `${levelState.progressPct.toFixed(2)}%`;

    const levelStatePillEl = document.getElementById("level-state-pill");
    const levelStateTextEl = document.getElementById("level-state-text");
    const levelPointsDownEl = document.getElementById("level-points-down");
    const levelPointsUpEl = document.getElementById("level-points-up");
    const divisionBadgeEl = document.getElementById("my-division-badge");
    const currentDivision = getCoreDivisionByRating(myPts);
    if (divisionBadgeEl) {
      divisionBadgeEl.innerHTML = `<i class="fas ${currentDivision.icon}"></i> ${currentDivision.label}`;
      divisionBadgeEl.style.borderColor = `${currentDivision.color}66`;
      divisionBadgeEl.style.color = currentDivision.color;
    }

    const lastAnalysis = me.lastMatchAnalysis || {};
    if (divisionBadgeEl && Number.isFinite(lastAnalysis.pointsBefore)) {
      const diff = getDivisionMovement(Number(lastAnalysis.pointsBefore), myPts);
      divisionBadgeEl.classList.toggle("up", diff > 0);
    }
    if (levelStatePillEl) {
      levelStatePillEl.textContent = levelState.stateLabel;
      levelStatePillEl.className = `level-state-pill ${levelState.stateClass}`;
    }
    if (levelStateTextEl) {
      levelStateTextEl.innerHTML = `<b id="level-points-down">${levelState.pointsToDown}</b> pts (${levelState.downPct.toFixed(2)}%) para bajar · <b id="level-points-up">${levelState.pointsToUp}</b> pts (${levelState.upPct.toFixed(2)}%) para subir`;
    } else {
      if (levelPointsDownEl) levelPointsDownEl.textContent = `${levelState.pointsToDown}`;
      if (levelPointsUpEl) levelPointsUpEl.textContent = `${levelState.pointsToUp}`;
    }

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
    const formLabelEl = document.querySelector("#rank-recent-form .recent-form-label");
    if (formLabelEl) formLabelEl.textContent = `FORMA (5) · RACHA ${Math.abs(streak)}`;
  }

  void refreshRecentForm(currentUser.uid);

  window.podiumData = displayList.slice(0, 3);
  for (let i = 0; i < 3; i++) {
    if (displayList[i]) await renderPodiumSlot(i + 1, displayList[i]);
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

  renderLeaderboard(displayList.slice(3), totalPlayers, movementMap);
}

async function ensureRankingContext(users = []) {
  const now = Date.now();
  if (now - rankingCtxCacheAt < 60000 && rankingCtx.logsByUid.size > 0) return;
  rankingCtxCacheAt = now;

  const logsSnap = await window.getDocsSafe(
    query(collection(db, "rankingLogs"), orderBy("timestamp", "desc"), limit(1500)),
  );
  const logs = (logsSnap?.docs || []).map((d) => d.data());
  const byUid = new Map();
  logs.forEach((row) => {
    const uid = row?.uid;
    if (!uid) return;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(row);
  });
  rankingCtx = {
    logsByUid: byUid,
    monthlyImprovement: aggregateCoreMonthlyImprovement(logs, 30),
  };
}

function getFilteredAndSortedList(list = []) {
  const filtered = (list || []).filter((u) => {
    if (Number(u.partidosJugados || 0) < rankingFilters.minPlayed) return false;
    if (!rankingFilters.search) return true;
    const name = String(u.nombreUsuario || u.nombre || "").toLowerCase();
    return name.includes(rankingFilters.search);
  });

  const metric = rankingFilters.sort || "elo";
  const sorted = filtered.slice().sort((a, b) => {
    const va = computeRankingMetric(a, metric, rankingCtx);
    const vb = computeRankingMetric(b, metric, rankingCtx);
    if (vb !== va) return vb - va;
    return Number(b.puntosRanking || 1000) - Number(a.puntosRanking || 1000);
  });

  return sorted.map((u, idx) => ({ ...u, visualRank: idx + 1 }));
}

function buildFormChips(results = [], total = 5) {
  const chips = [];
  const normalized = Array.isArray(results) ? results.slice(0, total) : [];
  for (let i = 0; i < total; i += 1) {
    const r = normalized[i];
    if (r === "W") chips.push(`<span class="form-chip win">W</span>`);
    else if (r === "L") chips.push(`<span class="form-chip loss">L</span>`);
    else chips.push(`<span class="form-chip none">-</span>`);
  }
  return chips.join("");
}

async function refreshRecentForm(uid) {
  if (!uid || recentFormBusy) return;
  const now = Date.now();
  if (now - recentFormFetchedAt < 15000) return;
  recentFormFetchedAt = now;
  recentFormBusy = true;
  try {
    const chipsEl = document.getElementById("rank-form-chips");
    if (!chipsEl) return;
    const snap = await window.getDocsSafe(
      query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(5)),
    );
    const form = (snap?.docs || []).map((d) => (Number(d.data()?.diff || 0) >= 0 ? "W" : "L"));
    chipsEl.innerHTML = buildFormChips(form, 5);
  } catch (_) {
    const chipsEl = document.getElementById("rank-form-chips");
    if (chipsEl) chipsEl.innerHTML = buildFormChips([], 5);
  } finally {
    recentFormBusy = false;
  }
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
      const profileUid = u.id || u.uid || "";
      const isMe = currentUser && profileUid === currentUser.uid;
      const name = u.nombreUsuario || u.nombre || "Jugador";
      const photo = u.fotoPerfil || u.fotoURL || "";
      const ps = u.partidosJugados || 0;
      const level = Number(u.nivel || 2.5).toFixed(2);
      const points = Number(u.puntosRanking || 1000).toFixed(1);
      const movement = Number(movementMap.get(u.id) || 0);
      const division = getCoreDivisionByRating(points);
      const rowRank = Number(u.visualRank || u.rank || i + 1);

      let rankClass = "rank-entry";
      if (rowRank === 1) rankClass = "rank-gold";
      else if (rowRank === 2) rankClass = "rank-silver";
      else if (rowRank === 3) rankClass = "rank-bronze";
      else if (rowRank <= 10) rankClass = "rank-elite tier-10";
      else if (rowRank <= 20) rankClass = "tier-20";
      else if (rowRank <= 30) rankClass = "tier-30";
      else if (rowRank <= 50) rankClass = "tier-50";
      else rankClass = "tier-low";

      const depth = totalPlayers > 1 ? (rowRank - 1) / (totalPlayers - 1) : 0;
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
                 onclick="window.viewProfile('${profileUid}')" 
                 style="${rowStyle}">
                
                <div class="lb-rank">#${rowRank}</div>
                
                <div class="lb-avatar">
                    ${renderAvatarWithFallback(photo, name)}
                </div>

                <div class="lb-info truncate">
                    <div class="lb-name-row">
                      <span class="lb-name">${name.toUpperCase()}</span>
                      <span class="lb-division-mini" style="color:${division.color}"><i class="fas ${division.icon}"></i> ${division.label}</span>
                    </div>
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

    const docs = logs.docs || [];
    const uidSet = new Set();
    const matchSet = new Set();
    docs.forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (mode === "global" && d.uid && d.uid !== currentUser.uid) uidSet.add(d.uid);
      if (d.matchId) matchSet.add(d.matchId);
    });

    await Promise.all([
      ...Array.from(uidSet).map((uid) => getCachedUserName(uid).catch(() => "Jugador")),
      ...Array.from(matchSet).map((mid) => getCachedMatch(mid).catch(() => null)),
    ]);

    const enriched = await Promise.all(
      docs.map(async (docSnap) => {
        const log = docSnap.data() || {};
        window.logCache.set(docSnap.id, log);
        const isDiary = String(log.type || "").startsWith("DIARY_");
        const isPeerDiary = log.type === "DIARY_PEER_BONUS";

        let matchInfo = log?.details?.sets || "";
        let date = "";
        if (log.matchId) {
          const match = await getCachedMatch(log.matchId);
          if (match) {
            matchInfo = matchInfo || match.resultado?.sets || "";
            if (match.fecha) {
              const d = match.fecha.toDate ? match.fecha.toDate() : new Date(match.fecha);
              date = d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
            }
          }
        }
        if (!date && log.timestamp?.toDate) {
          const d = log.timestamp.toDate();
          date = d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
        }
        const timeMs = log.timestamp?.toDate ? log.timestamp.toDate().getTime() : 0;

        let userNameLabel = "";
        if (mode === "global" && log.uid !== currentUser.uid) {
          const cachedName = await getCachedUserName(log.uid);
          userNameLabel = `<span class="text-[9px] font-black opacity-40 uppercase block">${cachedName}</span>`;
        }

        return {
          id: docSnap.id,
          log,
          isDiary,
          isPeerDiary,
          matchInfo,
          date,
          timeMs,
          userNameLabel,
        };
      }),
    );

    const groups = [];
    const byMatch = new Map();
    enriched.forEach((item) => {
      const matchId = item.log.matchId;
      if (!matchId) {
        groups.push({ kind: "single", item });
        return;
      }
      if (!byMatch.has(matchId)) byMatch.set(matchId, []);
      byMatch.get(matchId).push(item);
    });

    byMatch.forEach((items, matchId) => {
      items.sort((a, b) => b.timeMs - a.timeMs);
      const primary = items.find((x) => !x.isDiary) || items[0];
      const totalDiff = items.reduce((acc, x) => acc + Number(x.log.diff || 0), 0);
      const hasDiary = items.some((x) => x.isDiary);
      const diaryNotes = items
        .filter((x) => x.isDiary)
        .map((x) => x.log.reason || (x.isPeerDiary ? "Impacto por Evaluación" : "Análisis Diario"));

      const aggregateId = `agg_${matchId}_${primary.id}`;
      const aggregateLog = {
        ...primary.log,
        diff: totalDiff,
        __aggregatedByMatch: true,
        __groupLogs: items.map((x) => x.log),
        __groupDocIds: items.map((x) => x.id),
        __diaryCount: items.filter((x) => x.isDiary).length,
        __diaryNotes: diaryNotes,
        __baseDiff: Number(primary.log.diff || 0),
      };
      window.logCache.set(aggregateId, aggregateLog);

      groups.push({
        kind: "aggregate",
        id: aggregateId,
        matchId,
        items,
        primary,
        totalDiff,
        hasDiary,
        diaryCount: aggregateLog.__diaryCount,
        diaryNotes,
      });
    });

    groups.sort((a, b) => {
      const tA = a.kind === "aggregate" ? (a.primary?.timeMs || 0) : (a.item?.timeMs || 0);
      const tB = b.kind === "aggregate" ? (b.primary?.timeMs || 0) : (b.item?.timeMs || 0);
      return tB - tA;
    });

    const entries = groups.map((g) => {
      if (g.kind === "single") {
        const { item } = g;
        const { log, isDiary, isPeerDiary, matchInfo, date, userNameLabel } = item;
        const isWin = Number(log.diff || 0) > 0;
        let levelIcon = "";
        if (log.details?.levelAfter && log.details?.levelBefore) {
          const lDiff = log.details.levelAfter - log.details.levelBefore;
          if (lDiff > 0) levelIcon = `<span class="text-[8px] text-sport-green ml-1"><i class="fas fa-caret-up"></i></span>`;
          else if (lDiff < 0) levelIcon = `<span class="text-[8px] text-sport-red ml-1"><i class="fas fa-caret-down"></i></span>`;
        }
        const title = isDiary ? (isPeerDiary ? "Evaluacion Diario" : "Analisis Diario") : (isWin ? "Victoria" : "Derrota");
        return `
          <div class="history-entry ${isDiary ? "bonus" : (isWin ? "win" : "loss")}" onclick="event.stopPropagation();window.showMatchBreakdownV3('${item.id}')">
            <div class="history-icon"><i class="fas ${isDiary ? "fa-book" : (isWin ? "fa-arrow-up" : "fa-arrow-down")}"></i></div>
            <div class="history-details">
              ${userNameLabel}
              <span class="history-title">${title} ${matchInfo ? `<span class="history-score">${matchInfo}</span>` : ""} ${levelIcon}</span>
              <span class="history-date">${date || "N/A"} ${isDiary ? `<span class="text-[9px] opacity-60 ml-1">(${log.reason || 'Bonus'})</span>` : ''}</span>
            </div>
            <span class="history-value">${isWin ? "+" : ""}${Number(log.diff || 0).toFixed(1)}</span>
          </div>
        `;
      }

      const isWin = g.totalDiff > 0;
      const levelIcon = g.hasDiary ? `<span class="text-[8px] text-primary ml-1"><i class="fas fa-link"></i></span>` : "";
      const title = g.hasDiary ? "Partido + Diario" : (isWin ? "Victoria" : "Derrota");
      const matchInfo = g.primary?.matchInfo || "";
      const date = g.primary?.date || "N/A";
      const userNameLabel = g.primary?.userNameLabel || "";
      const diaryHint = g.hasDiary ? `<span class="text-[9px] opacity-70 ml-1">(Incluye ${g.diaryCount} ajuste(s) de diario)</span>` : "";
      return `
        <div class="history-entry ${isWin ? "win" : "loss"}" onclick="event.stopPropagation();window.showMatchBreakdownV3('${g.id}')">
          <div class="history-icon"><i class="fas fa-layer-group"></i></div>
          <div class="history-details">
            ${userNameLabel}
            <span class="history-title">${title} ${matchInfo ? `<span class="history-score">${matchInfo}</span>` : ""} ${levelIcon}</span>
            <span class="history-date">${date} ${diaryHint}</span>
          </div>
          <span class="history-value">${g.totalDiff >= 0 ? "+" : ""}${Number(g.totalDiff).toFixed(1)}</span>
        </div>
      `;
    });

    container.innerHTML = entries.join("");
  } catch (e) {
    console.error("Error loading history:", e);
    showToast("Historial", "No se pudo cargar el desglose de puntos.", "error");
    container.innerHTML =
      '<div class="error-state">Error cargando historial</div>';
  }
}

// ============================================
// MODAL DE DESGLOSE TÁCTICO CORREGIDO
// ============================================
window.showMatchBreakdownV3 = async (logId) => {
  let log = window.logCache?.get(logId);
  if (!log) {
    try {
      const docSnap = await getDoc(doc(db, "rankingLogs", logId));
      if (docSnap.exists()) {
        log = docSnap.data();
        if (!window.logCache) window.logCache = new Map();
        window.logCache.set(logId, log);
      }
    } catch (_) {}
  }
  if (!log) return showToast("Error", "No se pudo cargar el detalle del registro.", "error");

  // Crear overlay del modal
  const previousOverlays = Array.from(document.querySelectorAll(".modal-overlay.active"))
    .filter((el) => !el.classList.contains("modal-stack-front"));
  previousOverlays.forEach((el) => {
    el.classList.add("modal-stack-back");
    el.style.zIndex = "11040";
  });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active modal-stack-front";
  overlay.style.zIndex = "12090";

  const isDiary = String(log.type || "").startsWith("DIARY_");
  const isPeerDiary = log.type === "DIARY_PEER_BONUS";
  const isGrouped = !!log.__aggregatedByMatch;
  const groupLogs = Array.isArray(log.__groupLogs) ? log.__groupLogs : [];
  const diaryLogsInGroup = groupLogs.filter((x) => String(x?.type || "").startsWith("DIARY_"));
  const diff = Number(log.diff || 0);
  const total = log.newTotal;
  const matchId = log.matchId;

  overlay.innerHTML = `
    <div class="modal-card glass-strong animate-up p-0 overflow-hidden" style="max-width:380px" onclick="event.stopPropagation()">
      <div class="modal-header ranking-breakdown-head">
        <span class="modal-title font-black italic tracking-widest">${isDiary ? 'RECOMPENSA DIARIO' : 'DESGLOSE TÁCTICO'}</span>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
      </div>
      <div id="breakdown-content" class="modal-body custom-scroll p-4">
        <div class="center py-10"><i class="fas fa-circle-notch fa-spin text-primary"></i></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const cleanupStack = () => previousOverlays.forEach((el) => {
    el.classList.remove("modal-stack-back");
    el.style.removeProperty("z-index");
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      cleanupStack();
      overlay.remove();
    }
  });
  overlay.querySelectorAll(".close-btn").forEach((btn) => {
    btn.addEventListener("click", cleanupStack, { once: true });
  });

  const content = document.getElementById("breakdown-content");

  try {
    // Caso especial: bonus diario (solo si no está agrupado por partido)
    if (isDiary && !isGrouped) {
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
    if (!match) {
      const d = log?.details || {};
      const levelBefore = Number(d.levelBefore || 2.5);
      const levelAfter = Number(d.levelAfter || levelBefore);
      const isWinFallback = Number(diff || 0) > 0;
      content.innerHTML = `
        <div class="text-center py-2">
          <div class="text-5xl font-black mb-2 ${isWinFallback ? "text-sport-green" : "text-sport-red"}">${isWinFallback ? "+" : ""}${Number(diff || 0).toFixed(1)}</div>
          <span class="text-[10px] text-muted uppercase tracking-[4px] font-black">DESGLOSE RÁPIDO</span>
        </div>
        <div class="mt-4 p-4 bg-white/5 rounded-2xl border border-white/10">
          <div class="flex-row between text-[11px] mb-2"><span class="text-white/55">Resultado</span><span class="font-black text-white">${d.sets || "No disponible"}</span></div>
          <div class="flex-row between text-[11px] mb-2"><span class="text-white/55">Nivel</span><span class="font-black text-primary">${levelBefore.toFixed(2)} -> ${levelAfter.toFixed(2)}</span></div>
          <div class="flex-row between text-[11px]"><span class="text-white/55">Puntos totales</span><span class="font-black text-white">${Math.round(Number(total || 0))}</span></div>
        </div>
        <div class="text-[10px] text-muted mt-4 text-center">Detalle avanzado no disponible en este momento.</div>
      `;
      return;
    }

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

    const myTeamLabel = [myName, partnerName].filter(Boolean).join(" / ");
    const rivalTeamLabel = [rival1Name, rival2Name].filter(Boolean).join(" / ");

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

    const pc = puntosDetalle || {};
    const comp = getPointsComponents(pc);
    const vBase = comp.base;
    const vDif = comp.dificultad;
    const vSets = comp.sets;
    const vRend = comp.rendimiento;
    const vSmurf = comp.penalizacion;
    const vDiario = comp.diario;
    const vJusticia = comp.justicia;
    const sumComputed = comp.total;
    const operationRows = [
      { k: "Base esperado", v: vBase, why: "Puntos iniciales calculados según la probabilidad (ELO)." },
      { k: "Dificultad real", v: vDif, why: "Ajuste preciso por el nivel real de los rivales frente al propio." },
      { k: "Diferencia de sets", v: vSets, why: "Premio o penalización por dominio numérico en el resultado." },
      { k: "Rendimiento/MVP", v: vRend, why: "Bonificación extra por desempeño destacado en el partido." },
      { k: "Racha", v: comp.racha, why: "Ajuste por racha competitiva activa." },
      { k: "Diario Coach", v: vDiario, why: "Impacto aplicado desde reflexiones del diario coach." },
      { k: "Penalización Abuso", v: vSmurf, why: "Deducción de puntos por abusar de rivales con nivel muy inferior." },
      { k: "Ajuste de Justicia", v: vJusticia, why: "Balance automatizado anti-farm para redondear el impacto." },
      { k: "Extras detectados", v: comp.extras, why: "Suma de otros campos numéricos válidos detectados en el registro." },
    ].filter(r => r.v !== 0);

    const math = log.details?.math || {};
    const fair = log.details?.fairPlay || {};

    // Construir HTML del modal
    const diaryRowsInline = isGrouped && diaryLogsInGroup.length > 0 ? `
      <div class="mt-3 p-3 rounded-2xl bg-primary/10 border border-primary/25">
        <span class="text-[9px] font-black text-primary uppercase tracking-[3px] block mb-2">Ajustes Diario Integrados</span>
        ${diaryLogsInGroup.map((d) => `
          <div class="flex-row between text-[10px] mb-1">
            <span class="text-white/60">${d.reason || (d.type === "DIARY_PEER_BONUS" ? "Impacto por Evaluación" : "Análisis Diario")}</span>
            <span class="font-black ${Number(d.diff || 0) >= 0 ? "text-sport-green" : "text-sport-red"}">${Number(d.diff || 0) >= 0 ? "+" : ""}${Number(d.diff || 0).toFixed(1)}</span>
          </div>
        `).join("")}
      </div>
    ` : ``;

    content.innerHTML = `
      <div class="flex-col gap-4">
        <!-- Cabecera con resultado -->
        <div class="p-5 rounded-3xl bg-gradient-to-br ${isWin ? 'from-sport-green/20 to-transparent border-sport-green/30' : 'from-sport-red/20 to-transparent border-sport-red/30'} border">
          <div class="flex-row between items-center mb-4">
            <span class="text-[10px] font-black ${isWin ? 'text-sport-green' : 'text-sport-red'} uppercase tracking-widest">${isWin ? 'VICTORIA' : 'DERROTA'}</span>
            <span class="text-[10px] text-white/40 font-bold uppercase tracking-widest">${date}</span>
          </div>
          <div class="text-center mb-3">
            <span class="text-[10px] text-white/55 font-black tracking-[2px]">${myTeamLabel} VS ${rivalTeamLabel}</span>
          </div>
          <div class="text-center mb-2">
            <span class="text-xs font-bold text-white/60 mb-2 block tracking-[4px]">RESULTADO FINAL</span>
            <span class="text-5xl font-black italic text-white tracking-widest font-mono">${result}</span>
          </div>
        </div>

        <!-- Niveles de todos los jugadores -->
        <div class="grid grid-cols-2 gap-3">
          <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col gap-2">
            <span class="text-[8px] font-black text-muted uppercase tracking-widest">${myTeamLabel}</span>
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
            <span class="text-[8px] font-black text-muted uppercase tracking-widest">${rivalTeamLabel}</span>
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
              <div class="mt-1 p-3 rounded-2xl bg-white/5 border border-white/10">
                <span class="text-[9px] font-black text-white/70 uppercase tracking-widest block mb-2">Operacion lógica exacta</span>
                ${operationRows.map(r => `
                  <div class="flex-row between text-[10px] mb-1">
                    <span class="text-white/45">${r.k}</span>
                    <span class="font-mono font-bold ${r.v >= 0 ? 'text-sport-green' : 'text-sport-red'}">${r.v >= 0 ? '+' : ''}${r.v.toFixed(1)}</span>
                  </div>
                  <div class="text-[9px] text-white/35 mb-2">${r.why}</div>
                `).join('')}
                <div class="pt-2 border-t border-white/10 flex-row between text-[11px]">
                  <span class="text-white/70 font-black">SUMA COMPONENTES</span>
                  <span class="font-mono font-black text-white">${sumComputed >= 0 ? '+' : ''}${sumComputed.toFixed(1)}</span>
                </div>
                <div class="flex-row between text-[11px] mt-1">
                  <span class="text-primary font-black">TOTAL LOG</span>
                  <span class="font-mono font-black text-primary">${diff >= 0 ? '+' : ''}${Number(diff || 0).toFixed(2)}</span>
                </div>
                ${pc.multiplicador !== undefined ? `
                  <div class="mt-2 pt-2 border-t border-white/10 text-[10px] text-white/55">
                    <div class="mb-1">Formula con multiplicador IA:</div>
                    <div class="font-mono text-white/80">(${vBase.toFixed(2)} + ${vDif.toFixed(2)} + ${vRend.toFixed(2)} + ${vSets.toFixed(2)}) x ${Number(pc.multiplicador || 1).toFixed(2)} + ${Number(pc.racha || 0).toFixed(2)} + ${vJusticia.toFixed(2)}</div>
                  </div>
                ` : ``}
              </div>

              <div class="mt-2 p-3 rounded-2xl bg-white/5 border border-white/10">
                <span class="text-[9px] font-black text-white/70 uppercase tracking-widest block mb-2">Factores IA aplicados</span>
                <div class="grid grid-cols-2 gap-2 text-[10px]">
                  <div class="flex-row between"><span class="text-white/45">K</span><b class="text-white">${Number(math.K || 0).toFixed(2)}</b></div>
                  <div class="flex-row between"><span class="text-white/45">Esperado</span><b class="text-white">${Math.round(Number(math.expected || 0) * 100)}%</b></div>
                  <div class="flex-row between"><span class="text-white/45">Streak</span><b class="text-white">x${Number(math.streak || 1).toFixed(2)}</b></div>
                  <div class="flex-row between"><span class="text-white/45">Underdog</span><b class="text-white">x${Number(math.underdog || 1).toFixed(2)}</b></div>
                  <div class="flex-row between"><span class="text-white/45">Dominio</span><b class="text-white">x${Number(math.dominance || 1).toFixed(2)}</b></div>
                  <div class="flex-row between"><span class="text-white/45">Clutch</span><b class="text-white">x${Number(math.clutch || 1).toFixed(2)}</b></div>
                </div>
                ${fair?.rule ? `<div class="text-[9px] text-cyan-300 mt-2">Regla de justicia aplicada: <b>${fair.rule}</b></div>` : ''}
              </div>
              ${diaryRowsInline}
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
      <div class="grid grid-cols-2 gap-3 mt-6">
        <button type="button" id="ranking-share-result-btn" class="btn-premium-v7 w-full py-4 uppercase text-[10px] font-black tracking-[2px] shadow-xl">
          COMPARTIR
        </button>
        <button class="btn-premium-v7 w-full py-4 uppercase text-[10px] font-black tracking-[2px] shadow-xl" onclick="this.closest('.modal-overlay').remove()">
          CERRAR
        </button>
      </div>
    `;

    const shareBtn = document.getElementById("ranking-share-result-btn");
    if (shareBtn) {
      shareBtn.onclick = async () => {
        shareBtn.disabled = true;
        shareBtn.textContent = "Generando...";
        try {
          const teamA = [myName, partnerName];
          const teamB = [rival1Name, rival2Name];
          await shareMatchResult(
            { sets: result, delta: diff },
            {
              winner: isWin ? "A" : "B",
              teamA,
              teamB,
              levelsA: [myLevel, partnerLevel],
              levelsB: [rival1Level, rival2Level],
              club: "PADELUMINATIS CLUB",
            },
          );
        } catch (shareError) {
          console.warn("Share ranking result failed:", shareError);
        } finally {
          shareBtn.disabled = false;
          shareBtn.textContent = "COMPARTIR";
        }
      };
    }

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
  const modal = document.getElementById("modal-user");
  const area = document.getElementById("user-detail-area");
  if (!modal || !area) {
    showToast("Perfil", "No se encontró el modal de usuario.", "error");
    return;
  }

  area.innerHTML = `
    <div class="user-modal-sheet">
      <div class="center py-20"><div class="spinner-galaxy"></div></div>
    </div>
  `;
  modal.classList.add("active");

  try {
    const u = await getDocument("usuarios", uid);
    if (!u) throw new Error("Usuario no encontrado");

    const ps = u.partidosJugados || 0;
    const vs = u.victorias || 0;
    const ds = u.derrotas || 0;
    const winrate = computeCompetitiveWinrate(vs, ps);
    const name = (u.nombreUsuario || u.nombre || "Jugador").toUpperCase();
    const photo = u.fotoPerfil || u.fotoURL || "";
    const level = (u.nivel || 2.5).toFixed(2);
    const pts = Math.round(u.puntosRanking || 1000);
    const division = getCoreDivisionByRating(pts);
    const pala = u.pala || "No disponible";
    
    const viv = u.vivienda || {};
    const addressStr = (viv.bloque || viv.piso || viv.puerta) 
      ? `Blq ${viv.bloque || '-'}, Piso ${viv.piso || '-'}, Pta ${viv.puerta || '-'}` 
      : null;

    const puntosActuales = Math.round(u.puntosRanking || 1000);
    const levelState = getLevelProgressState(u.nivel, puntosActuales);

    area.innerHTML = `
      <div class="user-modal-sheet animate-up">
        <div class="user-modal-head">
          <button class="close-btn" aria-label="Cerrar perfil" onclick="document.getElementById('modal-user').classList.remove('active')">
            <i class="fas fa-times"></i>
          </button>
          <div class="user-top">
            <div class="user-avatar">
              ${renderAvatarWithFallback(photo, name, "user-avatar-img")}
            </div>
            <div class="user-main">
              <h3 class="user-name">${name}</h3>
              <div class="user-tags">
                <span class="u-tag">NIVEL ${level}</span>
                <span class="u-tag rank">#${u.posicionRanking || "--"}</span>
                <span class="u-tag" style="color:${division.color};border-color:${division.color}55"><i class="fas ${division.icon}"></i> ${division.label}</span>
              </div>
              <span class="user-pala"><i class="fas fa-hammer"></i> ${pala}</span>
            </div>
          </div>
        </div>

        <div class="user-body custom-scroll">
          <div class="user-progress-box">
            <div class="flex-row between items-center mb-2">
              <span class="text-[10px] font-black text-muted uppercase tracking-widest">Progreso de Nivel</span>
              <div class="flex-row items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-sport-green animate-pulse"></span>
                <span class="text-[10px] font-bold text-sport-green">${levelState.progressPct.toFixed(2)}%</span>
              </div>
            </div>
            <div class="progress-bar-v7 large">
              <div class="fill-bar gradient-cyan" style="width:${levelState.progressPct}%"></div>
            </div>
            <div class="flex-row between mt-2 text-[9px] font-black uppercase">
              <span class="opacity-60">ANT ${levelState.prevLevel.toFixed(2)}</span>
              <span class="text-primary">ACT ${levelState.currentLevel.toFixed(2)}</span>
              <span class="opacity-60">SIG ${levelState.nextLevel.toFixed(2)}</span>
            </div>
            <div class="flex-row between mt-2 text-[9px] font-black uppercase">
              <span class="text-sport-red">- ${levelState.pointsToDown} pts</span>
              <span class="text-white/75">${levelState.stateLabel}</span>
              <span class="text-sport-green">+ ${levelState.pointsToUp} pts</span>
            </div>
          </div>

          <div class="user-stats-grid">
            <div class="u-stat"><b>${pts}</b><span>PUNTOS</span></div>
            <div class="u-stat"><b>${ps}</b><span>PARTIDOS</span></div>
            <div class="u-stat"><b>${vs}</b><span>VICTORIAS</span></div>
            <div class="u-stat"><b>${winrate}%</b><span>WINRATE</span></div>
          </div>

          ${u.telefono ? `<div class="user-contact"><i class="fas fa-phone"></i><span>${u.telefono}</span></div>` : ""}
          ${addressStr ? `<div class="user-contact"><i class="fas fa-location-dot"></i><span>${addressStr}</span></div>` : ""}

          <div class="user-history-title">DESGLOSE DE PARTIDOS</div>
          <div class="exp-history-list custom-scroll" id="exp-history-list">
            <div class="center py-10 opacity-30"><i class="fas fa-circle-notch fa-spin"></i></div>
          </div>
        </div>
      </div>
    `;

    const historyContainer = document.getElementById("exp-history-list");
    const historyHtml = await renderUserDetailedHistory(uid);
    if (historyContainer) historyContainer.innerHTML = historyHtml;
  } catch (e) {
    console.error(e);
    showToast("ERROR", "No se pudo cargar el expediente", "error");
    modal.classList.remove("active");
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

        const pc = log.details?.puntosCalculados || log.details?.puntosDetalle || puntosDetalle;
        let detailHtml = "";
        if (pc) {
          const comp = getPointsComponents(pc);
          detailHtml = `
            <div class="mt-2 p-3 bg-black/40 rounded-2xl border border-white/5 flex-col gap-2" style="font-size: 8px;">
              <div class="flex-row between opacity-70"><span class="font-bold tracking-widest text-[#00C3FF]">BASE</span><span class="font-mono text-white">${comp.base.toFixed(2)}</span></div>
              <div class="flex-row between opacity-70"><span class="font-bold tracking-widest text-[#FF6B35]">DIFICULTAD</span><span class="font-mono text-white">${comp.dificultad >= 0 ? "+" : ""}${comp.dificultad.toFixed(2)}</span></div>
              <div class="flex-row between opacity-70"><span class="font-bold tracking-widest text-sport-gold">SETS + REND + RACHA</span><span class="font-mono text-white">${(comp.sets + comp.rendimiento + comp.racha) >= 0 ? "+" : ""}${(comp.sets + comp.rendimiento + comp.racha).toFixed(2)}</span></div>
              <div class="flex-row between opacity-70"><span class="font-bold tracking-widest text-cyan">DIARIO + JUSTICIA</span><span class="font-mono text-white">${(comp.diario + comp.justicia) >= 0 ? "+" : ""}${(comp.diario + comp.justicia).toFixed(2)}</span></div>
              <div class="flex-row between opacity-70"><span class="font-bold tracking-widest text-white/70">PENALIZACIONES + EXTRAS</span><span class="font-mono text-white">${(comp.penalizacion + comp.extras) >= 0 ? "+" : ""}${(comp.penalizacion + comp.extras).toFixed(2)}</span></div>
              <div class="flex-row between opacity-70"><span class="font-bold tracking-widest text-primary">MULTIPLICADOR</span><span class="font-mono text-white">x${toNum(pc.multiplicador || 1).toFixed(2)}</span></div>
              <div class="flex-row between pt-1 border-t border-white/5">
                <span class="font-black text-primary uppercase">SUMA COMPONENTES</span>
                <span class="font-mono text-primary font-black">${comp.total >= 0 ? "+" : ""}${comp.total.toFixed(2)}</span>
              </div>
              <div class="flex-row between">
                <span class="font-black text-white/75 uppercase">TOTAL LOG</span>
                <span class="font-mono text-white font-black">${toNum(log.diff) >= 0 ? "+" : ""}${toNum(log.diff).toFixed(2)}</span>
              </div>
            </div>
          `;
        }

        const lBefore = log.details?.levelBefore || 2.5;
        const lAfter = log.details?.levelAfter || 2.5;
        const lDiff = lAfter - lBefore;
        const lArrow = lDiff > 0 ? '<i class="fas fa-angles-up text-sport-green ml-1"></i>' : (lDiff < 0 ? '<i class="fas fa-angles-down text-sport-red ml-1"></i>' : '');

        return `
                <div class="sport-card ${isWin ? "match-positive" : "match-negative"} p-4 mb-3 flex-col gap-3 border-l-4 ${isWin ? "border-l-sport-green shadow-[0_0_15px_rgba(0,255,100,0.1)]" : "border-l-sport-red shadow-[0_0_15px_rgba(255,50,50,0.1)]"} bg-white/5 rounded-3xl" 
                     onclick="event.stopPropagation();window.showMatchBreakdownV3('${doc.id}')" 
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
                            <button type="button" class="history-result-chip flex-row items-center gap-1 shrink-0" onclick="event.stopPropagation();window.showMatchBreakdownV3('${doc.id}')">
                                <i class="fas fa-trophy text-[9px] ${isWin ? 'text-sport-gold' : 'text-muted'}"></i>
                                <span class="text-[10px] font-black italic text-white">${result}</span>
                            </button>
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

function getLevelProgressState(rawNivel, rawPuntos) {
  return getCoreLevelProgressState({
    rating: Number(rawPuntos || 1000),
    levelOverride: Number(rawNivel || 2.5),
  });
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
