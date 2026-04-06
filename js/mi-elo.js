/* mi-elo.js — New ELO Page Logic */
import { db, getDocument, subscribeCol } from "./firebase-service.js";
import { collection, getDocs, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { toDateSafe } from "./utils/match-utils.js";
import { observeCoreSession } from "./core/core-engine.js";
import { ELO_CONFIG, buildLevelProgressState, getLevelBandByRating } from "./config/elo-system.js";

let currentUser = null;
let currentUserData = null;
const playerNameCache = new Map();

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
  if (String(uid).startsWith("GUEST_")) return String(uid).split("_")[1] || "Inv";
  if (playerNameCache.has(uid)) return playerNameCache.get(uid);
  try {
    const doc = await getDocument("usuarios", uid);
    const name = doc?.nombreUsuario || doc?.nombre || "Jugador";
    playerNameCache.set(uid, name);
    return name;
  } catch { return "Jugador"; }
}

function renderSummary() {
  const d = currentUserData;
  const pts = Number(d?.puntosRanking || d?.rating || ELO_CONFIG.BASE_RATING);
  const nivel = Number(d?.nivel || 2.5).toFixed(2);
  const played = Number(d?.partidosJugados || 0);
  const wins = Number(d?.victorias || 0);
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  const el = id => document.getElementById(id);
  if (el("elo-current")) el("elo-current").textContent = String(pts);
  if (el("elo-nivel")) el("elo-nivel").textContent = nivel;
  if (el("elo-played")) el("elo-played").textContent = String(played);
  if (el("elo-winrate")) el("elo-winrate").textContent = `${winrate}%`;

  // Level progress
  const progress = buildLevelProgressState(pts);
  const band = getLevelBandByRating(pts);
  if (el("elo-div-name")) el("elo-div-name").textContent = band?.name || "BRONCE";
  if (el("elo-lp-pts")) el("elo-lp-pts").textContent = `${progress.toNext} pts para subir`;
  if (el("elo-lp-fill")) el("elo-lp-fill").style.width = `${progress.pct}%`;
  if (el("elo-lp-min")) el("elo-lp-min").textContent = String(progress.bandMin);
  if (el("elo-lp-max")) el("elo-lp-max").textContent = String(progress.bandMax);

  // Rank
  refreshRank();
}

async function refreshRank() {
  const rankEl = document.getElementById("elo-rank");
  if (!rankEl || !currentUser?.uid) return;
  try {
    const q = query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(500));
    const snap = await getDocs(q);
    let pos = 0;
    snap.docs.forEach((d, i) => { if (d.id === currentUser.uid) pos = i + 1; });
    rankEl.textContent = pos ? `#${pos}` : "#--";
  } catch { rankEl.textContent = "#--"; }
}

async function loadBreakdown() {
  const listEl = document.getElementById("elo-breakdown-list");
  if (!listEl || !currentUser?.uid) return;

  try {
    // Load ranking logs for this user
    const [logsSnap, diarySnap] = await Promise.all([
      getDocs(query(collection(db, "rankingLogs"), where("uid", "==", currentUser.uid), orderBy("createdAt", "desc"), limit(30))),
      getDocs(query(collection(db, "diario"), where("uid", "==", currentUser.uid), orderBy("fecha", "desc"), limit(30)))
    ]);

    const allItems = [];
    logsSnap.forEach(d => allItems.push({ ...d.data(), id: d.id, type: "match_log" }));
    diarySnap.forEach(d => {
        const data = d.data();
        if (data.puntosGanados > 0) {
            allItems.push({ 
                ...data, 
                id: d.id, 
                type: "diary_log", 
                createdAt: data.fecha,
                delta: data.puntosGanados,
                matchType: "ENTRENAMIENTO / DIARIO"
            });
        }
    });

    // Sort all by date
    allItems.sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    if (allItems.length === 0) {
      listEl.innerHTML = `<div class="elo-empty">Sin actividad registrada aún.</div>`;
      return;
    }

    const rows = [];
    for (const item of allItems.slice(0, 40)) {
      rows.push(await renderBreakdownRow(item));
    }
    listEl.innerHTML = rows.join("");

  } catch (e) {
    console.error("Error loading ELO breakdown:", e);
    listEl.innerHTML = `<div class="elo-empty">Error al cargar el desglose. Intenta recargar.</div>`;
  }
}

async function renderBreakdownRow(data) {
  const delta = Number(data.delta || data.pointsDelta || 0);
  const after = Number(data.after || data.newRating || 0);
  const isDiary = data.type === "diary_log";
  const isWin = delta > 0;
  const isDraw = delta === 0;
  
  const resultCls = isDiary ? "diary" : (isWin ? "win" : isDraw ? "draw" : "loss");
  const resultIcon = isDiary ? "D" : (isWin ? "W" : isDraw ? "E" : "L");
  const deltaCls = isWin ? "positive" : isDraw ? "neutral" : "negative";
  const deltaStr = (delta > 0 ? "+" : "") + delta;

  const date = data.createdAt?.toDate?.() || data.date?.toDate?.() || new Date(data.createdAt || data.date);
  const dateStr = date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });

  // Try to get match info
  const matchDesc = data.matchType || data.tipo || "Partido";
  const score = data.resultado || data.score || "";

  return `
    <div class="elo-match-row" style="animation-delay:${Math.random() * 150}ms">
      <div class="elo-mr-result ${resultCls}">${resultIcon}</div>
      <div class="elo-mr-info">
        <span class="elo-mr-date">${dateStr}</span>
        <span class="elo-mr-matchup">${matchDesc}</span>
        ${score ? `<span class="elo-mr-score">${score}</span>` : ""}
      </div>
      <div>
        <span class="elo-mr-delta ${deltaCls}">${deltaStr}</span>
        ${after > 0 ? `<span class="elo-mr-after">${after} ELO</span>` : ""}
      </div>
    </div>
  `;
}
