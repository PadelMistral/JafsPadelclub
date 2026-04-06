/**
 * @file match-service.js
 * @version 19.5 (Final V7 Refactor)
 * @description Premium Match Management Service for Padeluminatis.
 * Handles match details rendering, creation, actions (join/leave/delete), and real-time chat.
 * Fully aligned with Premium V7 "Ultra Vibrant" aesthetics.
 */

import { db, getDocument, subscribeDoc, auth } from './firebase-service.js';
import { 
    doc, getDoc, getDocs, collection, deleteDoc, onSnapshot, runTransaction,
    query, orderBy, where, limit, addDoc, updateDoc, serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { triggerFeedback, handleOperationError, FEEDBACK } from './modules/feedback-system.js';
import { showToast } from './ui-core.js'; // Keep for legacy/direct use if needed
import { processMatchResults, parseMatchResult } from './ranking-service.js';
import { createNotification, suggestDiaryEntry } from './services/notification-service.js';
import { MAX_PLAYERS, RESULT_LOCK_MS } from "./config/match-constants.js";
import { getMatchAdvice } from "./ai/ai-core.js";
import { logError } from "./core/app-logger.js";
import { analyticsCount, analyticsTiming } from "./core/analytics.js";
import { rateLimitCheck } from "./core/rate-limit.js";
import { getDivisionByRating } from "./config/elo-system.js";

/*
  PROD_AUDIT_NEXT_PHASE (analysis only):
  - Potential file merges:
    - Notification health orchestration can be unified in a single service module consumed by notificaciones.js and home.
    - Match UI blocks (creation/detail/result) should move to split render modules to reduce this file size.
  - Admin redesign hotspots:
    - admin.js mixes auth guard, fetching, rendering, mutations and stats in one file; needs dashboard-domain separation.
*/

let apoingStyleInjected = false;
function ensureApoingStyles() {
    if (apoingStyleInjected || document.getElementById('apoing-link-style')) return;
    const style = document.createElement('style');
    style.id = 'apoing-link-style';
    style.textContent = `
      .apoing-link-pro{
        display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:14px;
        border:1px solid rgba(0,212,255,.38);background:linear-gradient(120deg,rgba(0,212,255,.14),rgba(198,255,0,.1));
        color:#dff8ff;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1.2px;
        box-shadow:0 0 0 rgba(0,212,255,0);animation:apoingPulse 1.8s ease-in-out infinite;
      }
      .apoing-link-pro i{color:#67e8f9}
      .apoing-link-wrap{display:flex;justify-content:center}
      .modal-overlay .modal-card{border-radius:18px}
      .modal-overlay .modal-header{padding:12px 14px}
      .modal-overlay .modal-body{padding:12px}
      .md-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 16px}
      .md-tab-btn{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#cbd5e1;font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase}
      .md-tab-btn.active{border-color:rgba(34,211,238,.6);background:rgba(34,211,238,.12);color:#e0fbff}
      .md-tab-panel{display:flex;flex-direction:column;gap:14px}
      .md-tab-panel.hidden{display:none}
      .ai-coach-btn-v1{
        border:1px solid rgba(198,255,0,.35);background:rgba(198,255,0,.1);color:#dfff8a;
        border-radius:10px;padding:7px 10px;font-size:10px;font-weight:900;letter-spacing:1px;
      }
      @keyframes apoingPulse{
        0%{box-shadow:0 0 0 0 rgba(0,212,255,.28)}
        70%{box-shadow:0 0 0 12px rgba(0,212,255,0)}
        100%{box-shadow:0 0 0 0 rgba(0,212,255,0)}
      }
    `;
    document.head.appendChild(style);
    apoingStyleInjected = true;
}

function renderApoingLink(cta = "Comprobar reserva en Apoing", extraClass = "") {
    return `
        <a href="https://www.apoing.com" target="_blank" rel="noopener noreferrer" class="apoing-link-v7 ${extraClass}">
            <i class="fas fa-external-link-alt"></i>
            <span>${cta}</span>
        </a>
    `;
}

let postMatchSummaryStyleInjected = false;
function ensurePostMatchSummaryStyles() {
    if (postMatchSummaryStyleInjected || document.getElementById("post-match-summary-style")) return;
    const style = document.createElement("style");
    style.id = "post-match-summary-style";
    style.textContent = `
      .post-match-sheet{
        width:min(520px,92vw);max-height:84vh;overflow:auto;border-radius:18px;
        border:1px solid rgba(255,255,255,.14);background:linear-gradient(160deg,rgba(2,6,23,.95),rgba(10,14,26,.95));
        padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.55)
      }
      .post-match-title{font-size:12px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;color:#d1fae5}
      .post-match-main{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
      .pm-cell{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;background:rgba(255,255,255,.03)}
      .pm-cell span{font-size:9px;font-weight:900;opacity:.65;letter-spacing:.8px;text-transform:uppercase}
      .pm-cell b{display:block;margin-top:4px;font-size:16px;font-weight:900}
      .pm-delta-pos{color:#86efac}
      .pm-delta-neg{color:#fca5a5}
      .pm-progress-wrap{margin-top:12px}
      .pm-bar{height:10px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden;border:1px solid rgba(255,255,255,.1)}
      .pm-bar-fill{height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#a3e635);transition:width .95s ease}
      .pm-foot{margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px}
      .pm-chip{padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.18);font-size:10px;font-weight:900;text-transform:uppercase}
      .pm-btn{padding:10px 12px;border-radius:10px;border:1px solid rgba(198,255,0,.32);background:rgba(198,255,0,.12);color:#e7ffc1;font-size:10px;font-weight:900;letter-spacing:1px}
      @media (max-width:560px){.post-match-main{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    postMatchSummaryStyleInjected = true;
}

async function showPostMatchSummaryModal(rankingSync = {}, matchId = null) {
    const meUid = auth.currentUser?.uid;
    const meChange = (rankingSync?.changes || []).find((c) => c?.uid === meUid);
    const analysis = meChange?.analysis;
    if (!analysis) return;

    ensurePostMatchSummaryStyles();
    const oldPts = Math.round(Number(analysis.pointsBefore || 0));
    const newPts = Math.round(Number(analysis.pointsAfter || oldPts));
    const delta = Number(analysis.delta || 0);
    const bonus = Number(analysis.bonusDelta || analysis.puntosCalculados?.rendimientoBonus || 0);
    const prog = Math.max(0, Math.min(100, Number(analysis.levelProgressAfter || 0)));
    const division = getDivisionByRating(newPts);

    await new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active";
        overlay.style.zIndex = "10050";
        overlay.innerHTML = `
          <div class="post-match-sheet animate-up">
            <div class="post-match-title">Resumen Post-Partido</div>
            <div class="post-match-main">
              <div class="pm-cell"><span>Rating anterior</span><b>${oldPts}</b></div>
              <div class="pm-cell"><span>Rating nuevo</span><b>${newPts}</b></div>
              <div class="pm-cell"><span>Delta</span><b class="${delta >= 0 ? "pm-delta-pos" : "pm-delta-neg"}">${delta >= 0 ? "+" : ""}${delta.toFixed(0)}</b></div>
              <div class="pm-cell"><span>Bonus</span><b>${bonus >= 0 ? "+" : ""}${bonus.toFixed(0)}</b></div>
            </div>
            <div class="pm-progress-wrap">
              <div class="flex-row between mb-2 text-[10px] font-black uppercase opacity-70">
                <span>Progreso nivel</span>
                <span id="pm-prog-txt">${prog.toFixed(0)}%</span>
              </div>
              <div class="pm-bar"><div id="pm-prog-bar" class="pm-bar-fill"></div></div>
            </div>
            <div class="pm-foot">
              <span class="pm-chip" style="color:${division.color};border-color:${division.color}66"><i class="fas ${division.icon}"></i> ${division.label}</span>
              <button class="pm-btn" id="pm-continue-btn">CONTINUAR</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        const bar = overlay.querySelector("#pm-prog-bar");
        setTimeout(() => { if (bar) bar.style.width = `${prog}%`; }, 60);
        overlay.querySelector("#pm-continue-btn")?.addEventListener("click", () => {
            overlay.remove();
            resolve();
        });
        overlay.addEventListener("click", (ev) => {
            if (ev.target === overlay) {
                overlay.remove();
                resolve();
            }
        });
    });
    if (matchId) {
        try { window.location.href = `diario.html?matchId=${matchId}`; } catch (_) {}
    }
}

const MATCH_DURATION_MS = RESULT_LOCK_MS;
let matchDetailUnsub = null;

function getMatchDate(match) {
    if (!match) return null;
    const raw = match.fecha;
    const d = raw?.toDate ? raw.toDate() : new Date(raw);
    return Number.isFinite(d?.getTime?.()) ? d : null;
}

function getFilledPlayers(match) {
    return (match?.jugadores || []).filter((id) => id).length;
}

function canReportResultNow(match) {
    const date = getMatchDate(match);
    if (!date) return false;
    if (getFilledPlayers(match) < MAX_PLAYERS) return false;
    return Date.now() >= (date.getTime() + MATCH_DURATION_MS);
}

function autoMarkPlayedIfNeeded(matchData) {
    if (!matchData) return matchData;
    const state = String(matchData.estado || "").toLowerCase();
    const blocked = state === "cancelado" || state === "anulado" || state === "jugado" || state === "jugada";
    if (blocked || matchData.resultado?.sets) return matchData;
    if (!canReportResultNow(matchData)) return matchData;
    // Server-side scheduler is the source of truth for estado="jugada".
    // We only mirror the expected state in UI to avoid client-driven writes.
    return { ...matchData, estado: "jugada" };
}



async function safeOnSnapshot(q, onNext) {
    if (window.getDocsSafe) {
        const warm = await window.getDocsSafe(q, "match-service");
        if (warm?._errorCode === "failed-precondition") return () => {};
    }
    return onSnapshot(q, onNext, () => {});
}

function getEventLinkValue() {
    const sel = document.getElementById('inp-event-link');
    const val = String(sel?.value || '');
    if (!val) return null;
    const parts = val.split('|');
    if (parts.length < 2) return null;
    return { eventoId: parts[0], eventMatchId: parts[1], phase: parts[2] || '' };
}

async function loadEventLinkOptions(dateStr, hour, uid) {
    const sel = document.getElementById('inp-event-link');
    if (!sel || !uid) return;
    sel.innerHTML = `<option value="">Sin vincular (partido normal)</option>`;
    try {
        const snap = await getDocs(query(collection(db, 'eventoPartidos'), where('playerUids', 'array-contains', uid), limit(300)));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const pending = rows
            .filter((m) => String(m.estado || '') !== 'jugado')
            .filter((m) => !m.fecha || !Number.isFinite(new Date(m.fecha?.toDate ? m.fecha.toDate() : m.fecha).getTime()))
            .sort((a, b) => String(a.phase || '').localeCompare(String(b.phase || '')));

        const options = pending.map((m) => {
            const phase = String(m.phase || 'evento').toUpperCase();
            const label = `${phase} · ${m.teamAName || '?'} VS ${m.teamBName || '?'}`;
            return `<option value="${m.eventoId}|${m.id}|${m.phase || ''}">${label}</option>`;
        });

        sel.innerHTML = `<option value="">Sin vincular (partido normal)</option>${options.join('')}`;
        if (options.length > 0) {
            sel.selectedIndex = 1;
        }
        const info = document.getElementById('event-link-help');
        if (info) {
            info.textContent = options.length
                ? `Partidos de evento pendientes: ${options.length}. Se selecciona automaticamente el siguiente rival.`
                : 'No tienes partidos de evento pendientes sin fecha.';
        }
    } catch (_) {
        const info = document.getElementById('event-link-help');
        if (info) info.textContent = 'No se pudieron cargar partidos de evento.';
    }
}

async function syncLinkedEventMatchFromRegularMatch(matchId, col, resultStr) {
    try {
        const mSnap = await getDoc(doc(db, col, matchId));
        if (!mSnap.exists()) return;
        const m = mSnap.data() || {};
        const eventMatchId = m.eventMatchId || m?.eventLink?.eventMatchId;
        if (!eventMatchId) return;
        const parsed = parseMatchResult(resultStr);
        const winnerTeamId = parsed.winnerTeam === 'A' ? m.eventTeamAId : m.eventTeamBId;
        if (!winnerTeamId) return;
        await updateDoc(doc(db, 'eventoPartidos', eventMatchId), {
            resultado: resultStr,
            ganadorTeamId: winnerTeamId,
            estado: 'jugado',
            linkedMatchId: matchId,
            linkedMatchCollection: col,
            updatedAt: serverTimestamp(),
        });
    } catch (_) {}
}

/**
 * Creates match in Firestore.
 */
window.executeCreateMatch = async (dateStr, hour) => {
    if (!auth.currentUser) return triggerFeedback({ title: "ERROR", msg: "Debes iniciar sesión", type: "error" });
    const createRl = rateLimitCheck(`match_create:${auth.currentUser.uid}`, { windowMs: 60 * 60 * 1000, max: 10, minIntervalMs: 12000 });
    if (!createRl.ok) return triggerFeedback({ title: "BLOQUEADO", msg: "Demasiadas creaciones en poco tiempo", type: "warning" });
    const minInput = document.getElementById('inp-min-lvl');
    const maxInput = document.getElementById('inp-max-lvl');
    const min = minInput ? parseFloat(minInput.value) : 2.0;
    const max = maxInput ? parseFloat(maxInput.value) : 6.0;
    
    const type = window._creationType || 'amistoso';
    const betInput = document.getElementById('inp-bet');
    const bet = (type === 'reto' && betInput) ? parseInt(betInput.value || 0) : 0;
    const col = type === 'reto' ? 'partidosReto' : 'partidosAmistosos';
    
    // Ensure we have exactly MAX_PLAYERS slots
    const jugs = window._initialJugadores || [auth.currentUser.uid, null, null, null];
    while (jugs.length < MAX_PLAYERS) jugs.push(null);
    if (jugs.length > MAX_PLAYERS) jugs.length = MAX_PLAYERS;
    
    const matchDate = new Date(`${dateStr}T${hour}`);
    const linkedEvent = getEventLinkValue();
    
    const createT0 = performance.now();
    try {
        const { showLoading, hideLoading } = await import('./modules/ui-loader.js?v=6.5');
        showLoading("Creando partido en la Matrix...");

        const creatorDoc = await getDocument('usuarios', auth.currentUser.uid);
        const creatorName = creatorDoc?.nombreUsuario || creatorDoc?.nombre || 'Un jugador';
        const visibility = window._creationVisibility || 'public';
        const invitedUsers = jugs.filter(id => id && id !== auth.currentUser.uid && !id.startsWith('GUEST_'));

        let linkedEventMatch = null;
        if (linkedEvent?.eventMatchId) {
            const emRef = doc(db, 'eventoPartidos', linkedEvent.eventMatchId);
            const emSnap = await getDoc(emRef);
            if (emSnap.exists()) {
                const em = emSnap.data() || {};
                const isPlayable = String(em.estado || '') !== 'jugado';
                const canLink = Array.isArray(em.playerUids) ? em.playerUids.includes(auth.currentUser.uid) : false;
                if (isPlayable && canLink) linkedEventMatch = { id: emSnap.id, ...em };
            }
            if (!linkedEventMatch) {
                hideLoading();
                return showToast("Evento", "El partido de evento seleccionado ya no está disponible.", "warning");
            }
        }

        const matchData = {
            creador: auth.currentUser.uid,
            organizerId: auth.currentUser.uid,
            fecha: matchDate,
            jugadores: jugs,
            restriccionNivel: { min, max },
            familyPointsBet: bet,
            estado: 'abierto',
            visibility: visibility,
            invitedUsers: visibility === 'private' ? invitedUsers : [],
            timestamp: serverTimestamp(),
            equipoA: [jugs[0], jugs[1]],
            equipoB: [jugs[2], jugs[3]],
            surface: document.getElementById('inp-surface')?.value || 'indoor',
            courtType: document.getElementById('inp-court')?.value || 'normal',
            eventLink: linkedEventMatch ? {
                eventoId: linkedEventMatch.eventoId,
                eventMatchId: linkedEventMatch.id,
                phase: linkedEventMatch.phase || '',
            } : null,
            eventoId: linkedEventMatch?.eventoId || null,
            eventMatchId: linkedEventMatch?.id || null,
            eventTeamAId: linkedEventMatch?.teamAId || null,
            eventTeamBId: linkedEventMatch?.teamBId || null,
        };

        // Pre-Match Prediction (if filled)
        const validPlayers = jugs.filter(id => id);
        if (validPlayers.length === MAX_PLAYERS) {
            try {
                const profiles = await Promise.all(jugs.map(async uid => {
                    if (uid.startsWith('GUEST_')) {
                        const parts = uid.split('_');
                        return { id: uid, puntosRanking: 1000, nivel: parseFloat(parts[2]) || 2.5 }; 
                    }
                    const d = await getDoc(doc(db, 'usuarios', uid));
                    return d.exists() ? d.data() : { puntosRanking: 1000, nivel: 2.5 };
                }));

                const { PredictiveEngine } = await import('./predictive-engine.js');
                const prediction = PredictiveEngine.calculateMatchProbability(
                    profiles[0], profiles[1], profiles[2], profiles[3], 
                    { surface: matchData.surface }
                );
                
                matchData.preMatchPrediction = prediction;
                if (prediction.volatility.includes('Alta')) matchData.tags = ['high_volatility'];
            } catch (err) { }
        }

        const matchRef = await addDoc(collection(db, col), matchData);
        const createdMatchId = matchRef.id;
        if (linkedEventMatch?.id) {
            await updateDoc(doc(db, 'eventoPartidos', linkedEventMatch.id), {
                fecha: matchDate,
                estado: 'programado',
                linkedMatchId: createdMatchId,
                linkedMatchCollection: col,
                updatedAt: serverTimestamp(),
            });
        }
        analyticsCount("matches.created", 1);
        analyticsTiming("match.create_ms", performance.now() - createT0);

        let targets = jugs.filter(id => id && id !== auth.currentUser.uid && !id.startsWith('GUEST_'));

        // Public match broadcast: notify approved users (except creator) if there are no explicit invitees
        if (visibility !== 'private' && targets.length === 0) {
            try {
                const usersSnap = await window.getDocsSafe(
                    query(collection(db, "usuarios"), where("status", "==", "approved"), limit(150))
                );
                if (!usersSnap?._errorCode) {
                    targets = usersSnap.docs
                        .map((d) => d.id)
                        .filter((uid) => uid && uid !== auth.currentUser.uid);
                }
            } catch (e) {
                logError("public_broadcast_target_resolution_failed", { reason: e?.message || "unknown" });
            }
        }

        if (targets.length > 0) {
            const notifType = visibility === 'private' ? 'private_invite' : 'match_opened';
            const day = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
            const time = matchDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            const notifMsg = visibility === 'private'
                ? `${creatorName} te invitó a una partida privada el ${day} a las ${time}.`
                : `${creatorName} creó una partida para el ${day} a las ${time}.`;
            await createNotification(
                targets,
                "¡Padeluminatis!",
                notifMsg,
                notifType,
                'calendario.html',
                { type: notifType, matchId: createdMatchId, matchCollection: col, dedupId: `${notifType}_${createdMatchId}` }
            );
        }

        hideLoading();
        triggerFeedback(FEEDBACK.MATCH.CREATED);
        if (window.closeMatchModal) window.closeMatchModal();
        else document.getElementById('modal-match')?.classList.remove('active');
    } catch(e) {
        const { hideLoading } = await import('./modules/ui-loader.js?v=6.5');
        hideLoading();
        handleOperationError(e);
    }
};

/**
 * Renders the detailed view of a match in a modal or container.
 * Uses Premium V7 classes (court-schema-v7, etc).
 */
export async function renderMatchDetail(container, matchId, type, currentUser, userData) {
    if (!container) return;
    if (typeof matchDetailUnsub === "function") {
        try { matchDetailUnsub(); } catch (_) {}
        matchDetailUnsub = null;
    }
    ensureApoingStyles();
    const isReto = type ? type.toLowerCase().includes('reto') : false;
    const col = isReto ? 'partidosReto' : 'partidosAmistosos';
    
    window._currentMatchId = matchId;
    window._currentMatchCol = col;
    const viewerUid = currentUser?.uid || auth.currentUser?.uid || null;
    const viewerData = userData || {};

    const render = async (m) => {
        if (!m) { 
            container.innerHTML = '<div class="center p-10 opacity-50">Partido no encontrado o cancelado.</div>'; 
            return; 
        }
        m = autoMarkPlayedIfNeeded(m);

        const isParticipant = !!viewerUid && m.jugadores?.includes(viewerUid);
        const isAdmin = viewerData?.rol === 'Admin' || auth.currentUser?.email === 'Juanan221091@gmail.com';
        const isOrganizer = !!viewerUid && (m.organizerId === viewerUid || m.creador === viewerUid || isAdmin);
        const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const players = await Promise.all([0, 1, 2, 3].map(i => getPlayerData(m.jugadores?.[i])));

        const renderSlimPlayer = (p, rev = false) => {
            const name = p?.name || 'LIBRE';
            const photo = p?.photo || 'https://ui-avatars.com/api/?name=?&background=333&color=fff';
            const lvl = p?.level ? p.level.toFixed(1) : '--';
            return `
                <div class="p-slim-v7 ${rev ? 'reverse' : ''}">
                    <img src="${photo}" class="p-slim-img">
                    <div class="flex-col ${rev ? 'items-end' : ''}">
                        <span class="p-slim-name">${name}</span>
                        <span class="p-slim-lvl">${lvl} LVL</span>
                    </div>
                </div>
            `;
        };

        // Weather Forecast 
        let weatherHtml = '<i class="fas fa-clock opacity-30"></i> <span class="text-[10px]">...</span>';
        try {
            const { getDetailedWeather } = await import('./external-data.js');
            const w = await getDetailedWeather();
            if (w && w.current) {
                const rain = w.current.rain || 0;
                weatherHtml = `
                    <div class="weather-pill-v7 flex-row items-center gap-2">
                        <i class="fas fa-wind text-cyan-400 text-[10px]"></i>
                        <span class="text-[10px] font-black">${Math.round(w.current.wind_speed_10m)}</span>
                        <span class="opacity-30">|</span>
                        <i class="fas fa-droplet ${rain > 0 ? 'text-blue-400' : 'text-gray-500'} text-[10px]"></i>
                        <span class="text-[10px] font-black">${rain}</span>
                        <span class="opacity-30">|</span>
                        <span class="text-[10px] font-black text-white">${Math.round(w.current.temperature_2m)}°C</span>
                    </div>
                `;
            }
        } catch(e) {}

        const isFullView = isParticipant || isAdmin;

        // --- READ MODE (NON-PARTICIPANTS) ---
        if (!isFullView) {
            const setsStr = (m.resultado?.sets || "").trim();
            const hasResult = setsStr.length > 0;
            const resultText = hasResult ? setsStr : "FALTA AÑADIR RESULTADO";
            const resultColor = hasResult ? "text-sport-green shadow-glow-green" : "text-sport-red opacity-60";

            container.innerHTML = `
                <div class="match-read-mode animate-up p-4 flex-col gap-5">
                    <!-- MINI HERO -->
                    <div class="flex-row between items-center mb-1">
                        <div class="flex-col">
                            <span class="text-[34px] font-black leading-none tracking-tight">${date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</span>
                            <span class="text-[9px] font-black uppercase text-secondary tracking-widest mt-1">${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'short'}).toUpperCase()}</span>
                        </div>
                        <div class="scale-90">${weatherHtml}</div>
                    </div>

                    <!-- ALINEACIÓN -->
                    <div class="read-court-v7 p-4 bg-white/5 rounded-2xl border border-white/10 relative overflow-hidden">
                        <div class="flex-row between items-center mb-5 px-1 relative z-10">
                             <div class="flex-row items-center gap-2">
                                <div class="w-1 h-3 bg-primary rounded-full"></div>
                                <span class="text-[10px] font-black uppercase tracking-widest opacity-80">Alineación</span>
                             </div>
                             ${isReto ? '<span class="text-[8px] font-black text-sport-gold border border-sport-gold/30 px-2 py-0.5 rounded-full">⚡ RANKED</span>' : '<span class="text-[8px] font-black opacity-30">AMISTOSO</span>'}
                        </div>
                        
                        <div class="players-grid-read relative z-10">
                            <div class="team-read flex-col gap-4">
                                ${renderSlimPlayer(players[0])}
                                ${renderSlimPlayer(players[1])}
                            </div>
                            <div class="vs-read">VS</div>
                            <div class="team-read flex-col gap-4 text-right">
                                ${renderSlimPlayer(players[2], true)}
                                ${renderSlimPlayer(players[3], true)}
                            </div>
                        </div>
                        
                        <!-- Visual Deco -->
                        <div class="absolute inset-0 opacity-5 pointer-events-none" style="background-image: radial-gradient(circle at center, var(--primary) 0%, transparent 70%);"></div>
                    </div>

                    <!-- RESULTADO -->
                    <div class="result-read-v7 p-4 bg-white/5 rounded-2xl border border-white/10 text-center flex-col center gap-1">
                         <span class="text-[8px] font-black uppercase tracking-widest opacity-40">Marcador Final</span>
                         <span class="text-[16px] font-black tracking-widest ${resultColor}">${resultText}</span>
                    </div>

                    <div class="spectator-badge-v7 p-2 bg-white/5 rounded-xl border border-white/5 mx-auto opacity-50 flex-row center gap-2">
                        <i class="fas fa-eye text-[10px]"></i>
                        <span class="text-[9px] font-black uppercase tracking-widest">Modo Lectura</span>
                    </div>

                    <div class="actions-grid-v7">
                        ${renderMatchActions(m, isParticipant, isOrganizer, isAdmin, viewerUid || '', matchId, col)}
                    </div>
                </div>
            `;
            return;
        }

        // --- FULL VIEW (PARTICIPANTS & ADMINS) ---

        // Win Forecast Logic
        const team1Avg = ( (players[0]?.level || 2.5) + (players[1]?.level || 2.5) ) / 2;
        const team2Avg = ( (players[2]?.level || 2.5) + (players[3]?.level || 2.5) ) / 2;
        const diff = team1Avg - team2Avg;
        const p1 = Math.min(Math.max(50 + (diff * 20), 10), 90);
        const p2 = 100 - p1;

        const creatorSnap = await getDoc(doc(db, "usuarios", m.creador));
        const cName = creatorSnap.exists() ? (creatorSnap.data().nombreUsuario || creatorSnap.data().nombre) : 'Jugador';

        let eloBreakdownHtml = '';
        if (m.resultado?.sets) {
            const pointsSnap = await window.getDocsSafe(query(collection(db, "matchPointDetails"), where("matchId", "==", matchId), limit(1)));
            const detail = pointsSnap.docs?.[0]?.data?.() || null;
            
            let winnerHtml = '';
            if (m.resultado.ganador === 'A') {
                winnerHtml = `<span class="text-[10px] font-black uppercase text-primary">GANADOR: EQUIPO A</span>`;
            } else if (m.resultado.ganador === 'B') {
                winnerHtml = `<span class="text-[10px] font-black uppercase text-secondary">GANADOR: EQUIPO B</span>`;
            }

            if (detail) {
                const myAlloc = detail.playerAllocations?.find(a => a.uid === viewerUid);
                
                const rows = (detail.pointsPerSet || []).map(s => `
                    <div class="bd-item-v7">
                        <span class="bd-label">SET ${s.set}</span>
                        <span class="bd-val">${s.gamesA}-${s.gamesB}</span>
                    </div>
                `).sort((a,b) => a.set - b.set).join('');

                const ptsDeltaHtml = myAlloc ? `
                    <div class="pts-delta-v7 ${myAlloc.delta >= 0 ? 'pos' : 'neg'} mt-4">
                        <div class="flex-row between items-center">
                            <span class="text-[10px] font-black opacity-60">CAMBIO RATING</span>
                            <span class="delta-val">${myAlloc.delta >= 0 ? '+' : ''}${myAlloc.delta}</span>
                        </div>
                    </div>
                ` : '';

                eloBreakdownHtml = `
                    <div class="elo-breakdown-v7 mb-6 animate-fade-in">
                        <div class="flex-row between items-center mb-3">
                             <span class="text-[9px] font-black text-primary uppercase tracking-widest">RESUMEN OFICIAL</span>
                             <span class="text-[9px] font-bold text-muted">${detail.totalPoints || 0} PTS JUEGO</span>
                        </div>
                        <div class="bd-grid-v7 mb-4">${rows}</div>
                        ${ptsDeltaHtml}
                        ${winnerHtml ? `<div class="mt-4 text-center">${winnerHtml}</div>` : ''}
                    </div>
                `;
            } else if (m.resultado?.sets) {
                // Fallback simplest sets view
                eloBreakdownHtml = `<div class="p-4 bg-white/5 rounded-2xl border border-white/10 text-center mb-4"><span class="text-xs font-black uppercase text-primary">MARCADOR: ${m.resultado.sets}</span>${winnerHtml ? `<div class="mt-2">${winnerHtml}</div>` : ''}</div>`;
            }
        }

        container.innerHTML = `
            <div class="match-detail-v7 animate-up">
                <div class="detail-hero-v7 flex-col center">
                    <div class="type-badge-v7 ${isReto ? 'reto' : 'amistoso'} mb-4">
                        <i class="fas ${isReto ? 'fa-bolt' : 'fa-handshake'}"></i>
                        <span>${isReto ? 'RETO POR PUNTOS' : 'JUEGO AMISTOSO'}</span>
                    </div>
                    
                    <span class="hero-time-v7">${date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</span>
                    <div class="hero-date-v7">
                        ${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric'}).toUpperCase()}
                        <span class="dash">—</span>
                        ${date.toLocaleDateString('es-ES', {month:'long'}).toUpperCase()}
                    </div>
                    <div class="mt-4 opacity-80 scale-90">${weatherHtml}</div>
                </div>

                <div class="md-tabs">
                    <button id="md-tab-btn-lineup" class="md-tab-btn active" onclick="window.switchMatchDetailTab('lineup')">Alineacion</button>
                    ${m.resultado?.sets ? `<button id="md-tab-btn-breakdown" class="md-tab-btn" onclick="window.switchMatchDetailTab('breakdown')">Desglose</button>` : ''}
                    <button id="md-tab-btn-chat" class="md-tab-btn" onclick="window.switchMatchDetailTab('chat')">Chat partido</button>
                </div>

                <div id="md-tab-lineup" class="md-tab-panel">
                    <!-- Probability Simulation Board -->
                    <div class="prediction-card-v7 mb-1">
                        <div class="flex-row between items-end mb-2">
                             <div class="team-prob-box">
                                 <span class="team-label text-left">EQUIPO A</span>
                                 <span class="prob-val" style="color:var(--primary)">${Math.round(p1)}%</span>
                             </div>
                             <div class="ia-node">
                                 <i class="fas fa-brain"></i>
                                 <span>IA PREDICTION</span>
                             </div>
                             <div class="team-prob-box text-right">
                                 <span class="team-label text-right">EQUIPO B</span>
                                 <span class="prob-val" style="color:var(--secondary)">${Math.round(p2)}%</span>
                             </div>
                        </div>
                        <div class="prob-track-v7">
                            <div class="prob-fill t1" style="width: ${p1}%"></div>
                            <div class="prob-fill t2" style="width: ${p2}%"></div>
                        </div>
                    </div>

                    <div class="apoing-link-wrap mb-4">
                        ${renderApoingLink("Gestionar partida en Apoing", "text-orange-300 border-orange-400/40 bg-orange-500/10")}
                    </div>
                    ${eloBreakdownHtml}

                    <div class="court-container-v7 mb-3">
                        <div class="court-schema-v7">
                            <div class="court-net"></div>
                            
                            <div class="players-row-v7 top mb-8">
                                ${renderPlayerSlot(players[0], 0, { canEdit: isOrganizer, canSelfJoin: !isOrganizer && !isParticipant, mid: matchId, col })}
                                ${renderPlayerSlot(players[1], 1, { canEdit: isOrganizer, canSelfJoin: !isOrganizer && !isParticipant, mid: matchId, col })}
                            </div>
                            
                            <div class="vs-divider-v7">
                               <div class="vs-line"></div>
                               <div class="vs-circle">VS</div>
                               <div class="vs-line"></div>
                            </div>
                            
                            <div class="players-row-v7 bottom mt-8">
                                ${renderPlayerSlot(players[2], 2, { canEdit: isOrganizer, canSelfJoin: !isOrganizer && !isParticipant, mid: matchId, col })}
                                ${renderPlayerSlot(players[3], 3, { canEdit: isOrganizer, canSelfJoin: !isOrganizer && !isParticipant, mid: matchId, col })}
                            </div>
                        </div>
                    </div>

                    <div class="flex-row center gap-2 mb-4 opacity-60">
                        <i class="fas fa-crown text-yellow-500 text-[10px]"></i>
                        <span class="text-[9px] font-black uppercase tracking-widest">HOST: ${cName}</span>
                    </div>

                    ${isOrganizer ? `
                        <div class="px-2 mb-2">
                            <span class="text-[8px] font-black text-primary uppercase tracking-widest opacity-60">ACTION CENTER · ${viewerData?.rol === 'Admin' ? 'ADMIN ACCESS' : 'ORGANIZADOR'}</span>
                        </div>
                    ` : ''}

                    <div class="actions-grid-v7 flex-col gap-3">
                        ${renderMatchActions(m, isParticipant, isOrganizer, isAdmin, viewerUid || '', matchId, col)}
                    </div>
                    <div class="mt-3 p-2 rounded-xl border border-white/10 bg-white/5">
                        <div class="flex-row between items-center gap-2">
                            <span class="text-[9px] font-black uppercase tracking-widest text-primary">Consejo IA</span>
                            <button id="btn-ai-coach-match" class="ai-coach-btn-v1" type="button">Generar</button>
                        </div>
                        <p id="ai-coach-match-output" class="text-[10px] text-white/75 mt-2">Pulsa generar para obtener consejo pre/post partido.</p>
                    </div>
                </div>

                <div id="md-tab-breakdown" class="md-tab-panel hidden">
                    <div id="extended-breakdown-area" class="animate-fade-in">
                        <div class="center p-10 opacity-50">Cargando desglose de puntos...</div>
                    </div>
                </div>

                <div id="md-tab-chat" class="md-tab-panel hidden">
                    <div class="comms-panel-v7 mb-1">
                        <div class="comms-header">
                             <div class="flex-row items-center gap-2">
                                 <div class="live-dot"></div>
                                 <span class="text-[10px] font-black uppercase tracking-widest text-white">Radio Tactica</span>
                             </div>
                             <i class="fas fa-signal text-xs text-muted"></i>
                        </div>
                        <div class="comms-body custom-scroll" id="match-chat-msgs">
                             <!-- Chat limited to participants -->
                        </div>
                        <div class="comms-footer">
                            <input type="text" id="match-chat-in" class="comms-input" placeholder="Transmitir datos...">
                            <button class="comms-send" onclick="sendMatchChat('${matchId}', '${col}')"><i class="fas fa-paper-plane"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const aiBtn = document.getElementById("btn-ai-coach-match");
        const aiOut = document.getElementById("ai-coach-match-output");
        if (aiBtn && aiOut) {
            aiBtn.onclick = async () => {
                aiBtn.disabled = true;
                aiOut.textContent = "Analizando historial reciente y rival...";
                try {
                    const phase = m?.resultado?.sets ? "post" : "pre";
                    const result = await getMatchAdvice({
                        uid: viewerUid || auth.currentUser?.uid || "",
                        match: { id: m.id || matchId, col, ...m },
                        phase,
                    });
                    aiOut.textContent = result?.text || "No se pudo generar consejo IA en este momento.";
                } catch (_) {
                    logError("match_ai_advice_failed", { matchId: matchId || m?.id || "unknown" });
                    aiOut.textContent = "No se pudo generar consejo IA en este momento.";
                } finally {
                    aiBtn.disabled = false;
                }
            };
        }
        if (isParticipant) initMatchChat(matchId, col);
    };

    const data = await getDocument(col, matchId);
    render(data);
    matchDetailUnsub = subscribeDoc(col, matchId, render);
}

window.switchMatchDetailTab = (tab = 'lineup') => {
    document.querySelectorAll('.md-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.md-tab-panel').forEach(p => p.classList.add('hidden'));
    
    document.getElementById(`md-tab-btn-${tab}`)?.classList.add('active');
    document.getElementById(`md-tab-${tab}`)?.classList.remove('hidden');

    if (tab === 'breakdown') {
        renderExtendedBreakdown(document.getElementById('extended-breakdown-area'), window._currentMatchId);
    }
};

/**
 * Renders the match creation form for a specific date and time.
 * V7 Styled.
 */
export async function renderCreationForm(container, dateStr, hour, currentUser, userData) {
    if (!container) return;
    ensureApoingStyles();
    
    container.innerHTML = `
        <div class="booking-hub-v7 animate-up p-4">
            <div class="flex-col center mb-6 text-center">
                <div class="type-badge-v7 amistoso mb-2 mx-auto">
                    <i class="fas fa-calendar-plus"></i>
                    <span>ALTA DE MISIÓN</span>
                </div>
                <span class="hero-time-v7" style="font-size: 3.8rem; display: block; margin: 4px 0;">${hour}</span>
                <div class="hero-date-v7" style="margin-bottom: 2px;">
                    ${dateStr.toUpperCase()}
                </div>
                <div id="creation-weather" class="scale-90 opacity-80 mt-1"></div>
            </div>

            <div class="booking-config">
                <!-- Tipo de Partido -->
                <span class="cfg-label-v7">PROTOCOLO DE JUEGO</span>
                <div class="mode-selector-v7 mb-5">
                    <div id="opt-am" class="mode-card-v7 active" onclick="setMatchType('amistoso')">
                        <div class="mode-icon"><i class="fas fa-handshake"></i></div>
                        <div>
                            <span class="m-name">Amistoso</span>
                            <span class="m-desc text-[9px] opacity-60">Fogueo sin puntos</span>
                        </div>
                    </div>
                    <div id="opt-re" class="mode-card-v7" onclick="setMatchType('reto')">
                        <div class="mode-icon"><i class="fas fa-trophy"></i></div>
                        <div>
                            <span class="m-name">Reto Pro</span>
                            <span class="m-desc text-[9px] opacity-60">Ranked Match</span>
                        </div>
                    </div>
                </div>

                <div class="apoing-link-wrap mb-4">
                    ${renderApoingLink("Gestionar partida en Apoing", "text-orange-300 border-orange-400/40 bg-orange-500/10")}
                </div>

                <!-- Alineación Táctica -->
                <span class="cfg-label-v7">ALINEACIÓN TÁCTICA</span>
                <div class="court-container-v7 mb-5">
                    <div class="court-schema-v7" style="padding: 24px 12px; min-height: 240px;">
                        <div class="court-net"></div>
                        
                        <div class="players-row-v7 top mb-10">
                            <div class="p-slot-v7 active" id="slot-0-wrap">
                                <div class="p-img-box" style="border-color:var(--primary)">
                                    <img src="${userData.fotoPerfil || userData.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.nombreUsuario || userData.nombre || 'TÚ')}&background=random&color=fff`}">
                                </div>
                                <span class="p-badge" style="color:var(--primary); border-color:currentColor">${(userData.nivel || 2.5).toFixed(1)}</span>
                                <span class="text-[9px] font-black uppercase tracking-widest mt-1 truncate w-16 text-center" style="color:var(--primary)">${userData.nombreUsuario || 'TÚ'}</span>
                            </div>
                            <div class="p-slot-v7 pointer" id="slot-1-wrap" onclick="window.handleCreationSlotClick(1)">
                                <div class="p-img-box empty" style="border-color:var(--primary); opacity: 0.4"><i class="fas fa-plus text-muted"></i></div>
                                <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-2" style="color:var(--primary); opacity:0.5">COMPAÑERO</span>
                            </div>
                        </div>
                        
                        <div class="vs-divider-v7">
                           <div class="vs-line" style="background:rgba(255,255,255,0.1)"></div>
                           <div class="vs-circle" style="background:#0a0e19; border-color:rgba(255,255,255,0.2)">VS</div>
                           <div class="vs-line" style="background:rgba(255,255,255,0.1)"></div>
                        </div>
                        
                        <div class="players-row-v7 bottom mt-10">
                            <div class="p-slot-v7 pointer" id="slot-2-wrap" onclick="window.handleCreationSlotClick(2)">
                                <div class="p-img-box empty" style="border-color:var(--secondary); opacity: 0.4"><i class="fas fa-plus text-muted"></i></div>
                                <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-2" style="color:var(--secondary); opacity:0.5">RIVAL 1</span>
                            </div>
                            <div class="p-slot-v7 pointer" id="slot-3-wrap" onclick="window.handleCreationSlotClick(3)">
                                <div class="p-img-box empty" style="border-color:var(--secondary); opacity: 0.4"><i class="fas fa-plus text-muted"></i></div>
                                <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-2" style="color:var(--secondary); opacity:0.5">RIVAL 2</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Configuración Técnica -->
                <span class="cfg-label-v7">PARÁMETROS TÁCTICOS</span>
                <div class="flex-row gap-3 mb-5">
                    <div class="l-input-box flex-1 p-3 bg-white/5 rounded-xl border border-white/5">
                        <label class="text-[6px] font-black text-muted uppercase block mb-1">SUPERFICIE</label>
                        <select id="inp-surface" class="bg-transparent border-none text-white font-black text-[10px] text-center w-full outline-none">
                            <option value="indoor">INDOOR</option>
                            <option value="outdoor">OUTDOOR</option>
                        </select>
                    </div>
                    <div class="l-input-box flex-1 p-3 bg-white/5 rounded-xl border border-white/5">
                        <label class="text-[6px] font-black text-muted uppercase block mb-1">PISTA</label>
                        <select id="sel-court" class="bg-transparent border-none text-white font-black text-[10px] text-center w-full outline-none" onchange="window.toggleCourtInput(this)">
                            <option value="Mistral-Homes">MISTRAL</option>
                            <option value="custom">OTRA...</option>
                        </select>
                        <input type="text" id="inp-court-custom" class="hidden mt-1 bg-white/10 border-none w-full text-[9px] p-1 rounded text-white font-bold uppercase" placeholder="..." oninput="document.getElementById('inp-court').value = this.value">
                        <input type="hidden" id="inp-court" value="Mistral-Homes">
                    </div>
                </div>
                
                <div class="range-box-v7 mb-5" style="padding: 12px 6px;">
                    <div class="val-input">
                        <span style="font-size: 7px; margin-bottom: 2px;">LVL MIN</span>
                        <input type="number" id="inp-min-lvl" value="2.0" step="0.1" max="7" style="font-size: 1.1rem; height: 24px;">
                    </div>
                    <div class="range-sep"></div>
                     <div class="val-input">
                        <span style="font-size: 7px; margin-bottom: 2px;">LVL MAX</span>
                        <input type="number" id="inp-max-lvl" value="6.0" step="0.1" max="7" style="font-size: 1.1rem; height: 24px;">
                    </div>
                </div>

                <div id="reto-options" class="hidden-v5 mb-5">
                    <div class="bet-input-wrap-v7" style="padding: 10px 15px;">
                        <i class="fas fa-coins text-sport-gold text-lg"></i>
                        <input type="number" id="inp-bet" value="50" placeholder="Apuesta" style="font-size: 1rem;">
                        <span class="suffix text-[8px] font-black">PUNTOS</span>
                    </div>
                </div>

                <div class="flex-row items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 mb-6">
                    <div class="flex-col">
                        <span class="text-white font-black text-[10px] tracking-widest">PARTIDA PRIVADA</span>
                        <span class="text-[7px] text-muted uppercase">SOLO CON INVITACIÓN</span>
                    </div>
                    <label class="toggle-v7">
                        <input type="checkbox" id="inp-private" onchange="window._creationVisibility = this.checked ? 'private' : 'public'">
                        <span class="t-slider"></span>
                    </label>
                </div>

                <div class="l-input-box mb-5 p-3 bg-white/5 rounded-xl border border-white/5">
                    <label class="text-[7px] font-black text-muted uppercase block mb-1">VINCULAR A EVENTO</label>
                    <select id="inp-event-link" class="bg-transparent border-none text-white font-black text-[10px] w-full outline-none">
                        <option value="">Sin vincular (partido normal)</option>
                    </select>
                    <p id="event-link-help" class="text-[9px] text-muted mt-2">Cargando partidos de evento...</p>
                </div>

                <div class="flex-col gap-2">
                    <button class="btn-confirm-v7" onclick="executeCreateMatch('${dateStr}', '${hour}')">
                        <span class="t-main">DESPLEGAR MISIÓN</span>
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Weather widget
    setTimeout(async () => {
        try {
            const { getDetailedWeather } = await import('./external-data.js');
            const w = await getDetailedWeather();
            if (w && w.current) {
                const box = document.getElementById('creation-weather');
                if (box) {
                    box.className = 'meta-pill';
                    box.innerHTML = `<i class="fas fa-cloud-sun text-primary mr-1"></i><span>${Math.round(w.current.temperature_2m)}°C</span>`;
                }
            }
        } catch(e) {}
    }, 100);

    // Temp state
    window._creationType = 'amistoso';
    window._creationVisibility = 'public';
    window._initialJugadores = [currentUser.uid, null, null, null];

    window.setMatchType = (t) => {
        window._creationType = t;
        const optAm = document.getElementById('opt-am');
        const optRe = document.getElementById('opt-re');
        const retoOpts = document.getElementById('reto-options');
        if (optAm) optAm.classList.toggle('active', t === 'amistoso');
        if (optRe) optRe.classList.toggle('active', t === 'reto');
        if (retoOpts) retoOpts.classList.toggle('hidden-v5', t !== 'reto');
    };

    window.setMatchVisibility = (v) => {
        window._creationVisibility = v;
        const optPub = document.getElementById('opt-public');
        const optPriv = document.getElementById('opt-private');
        if (optPub) optPub.classList.toggle('active', v === 'public');
        if (optPriv) optPriv.classList.toggle('active', v === 'private');
    };

    loadEventLinkOptions(dateStr, hour, currentUser?.uid).catch(() => {});
}

/**
 * Fetches refined player data.
 * @private
 */
async function getPlayerData(uid) {
    if (!uid) return null;
    if (uid.startsWith('GUEST_')) {
        const parts = uid.split('_');
        return { name: parts[1], level: parseFloat(parts[2]), id: uid, isGuest: true, pala: parts[3] || 'Desconocida' };
    }
    const d = await getDocument('usuarios', uid);
    const name = d.nombreUsuario || d.nombre;
    const photo = d.fotoPerfil || d.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;
    return d ? { name, photo, level: d.nivel || 2.5, id: uid } : null;
}

/**
 * Renders a single player slot for the detailed view.
 * Compatible with V7.
 */
function renderPlayerSlot(p, idx, options = {}) {
    const { canEdit = false, canSelfJoin = false, mid = "", col = "" } = options;
    const isTeamA = idx < 2;
    const teamColor = isTeamA ? 'var(--primary)' : 'var(--secondary)';
    
    if (p) {
        const photo = p.photo || p.fotoPerfil || p.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=random&color=fff`;
        return `
            <div class="p-slot-v7 pointer" 
                 onclick="${mid && !p.id.startsWith('GUEST_') ? `window.viewProfile('${p.id}')` : ''}">
                <div class="p-img-box" style="border-color:${teamColor}">
                    <img src="${photo}">
                </div>
                <span class="p-badge" style="color:${teamColor}; border-color:currentColor">${p.level.toFixed(1)}</span>
                <span class="text-[9px] font-black uppercase tracking-widest mt-1 truncate w-16 text-center" style="color:${teamColor}">${p.name}</span>
                ${canEdit ? `<button class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex center text-white text-[8px] shadow-lg z-20 hover:scale-110 transition-transform" onclick="event.stopPropagation(); executeMatchAction('remove', '${mid}', '${col}', {idx:${idx}})"><i class="fas fa-times"></i></button>` : ''}
            </div>
        `;
    }

    return `
        <div class="p-slot-v7" 
             onclick="${canEdit
                ? `window.openPlayerSelector('${mid}', '${col}', {idx:${idx}})`
                : (canSelfJoin ? `window.executeMatchAction('join', '${mid}', '${col}')` : '')}">
            <div class="p-img-box empty" style="border:1.5px dashed ${teamColor}; opacity:0.3">
                <i class="fas fa-plus text-white opacity-50"></i>
            </div>
            <span class="text-[8px] font-black uppercase tracking-widest mt-2" style="color:${teamColor}; opacity:0.4">${canSelfJoin ? 'UNIRME' : 'VACÍO'}</span>
        </div>
    `;
}

/**
 * Determines available actions for a match.
 */
function renderMatchActions(m, isParticipant, isOrganizer, isAdmin, uid, id, col) {
    const realPlayerCount = (m.jugadores || []).filter(v => v).length;
    const hasResult = !!m.resultado?.sets;
    const matchState = String(m.estado || '').toLowerCase();
    const isPlayed = hasResult || matchState === 'cancelado' || matchState === 'anulado';
    const canReportNow = canReportResultNow(m);
    if (isPlayed) return `<button class="btn-confirm-v7 opacity-80" onclick="openResultForm('${id}', '${col}')"><span class="t-main">SOLO LECTURA</span><i class="fas fa-eye"></i></button>`;

    let actionsHtml = '';
    
    // Admin/Organizer Force View
    if (isOrganizer && !isParticipant) {
        actionsHtml = `
            <div class="flex-row gap-2 w-full mb-3">
                <button class="flex-1 py-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-black text-cyan-400" onclick="window.startSwapMode('${id}', '${col}')">POSICIÓN</button>
                <button class="flex-1 py-4 rounded-xl bg-red-500/10 border border-red-500/30 text-[10px] font-black text-red-500" onclick="executeMatchAction('delete', '${id}', '${col}')">BORRAR</button>
            </div>
            ${realPlayerCount === MAX_PLAYERS ? `
                ${isAdmin ? `
                  <button class="btn-confirm-v7" onclick="openResultForm('${id}', '${col}')">
                      <span class="t-main">EDITAR RESULTADO</span>
                      <i class="fas fa-flag-checkered"></i>
                  </button>
                ` : `
                  <button class="btn-confirm-v7 opacity-60" onclick="openResultForm('${id}', '${col}')" title="Solo lectura (no participante)">
                      <span class="t-main">SOLO LECTURA</span>
                      <i class="fas fa-eye"></i>
                  </button>
                `}
            ` : `<div class="px-6 py-4 rounded-xl bg-white/5 border border-white/5 text-center w-full">
                    <span class="text-[10px] font-black text-muted uppercase tracking-widest">ORGANIZANDO (${realPlayerCount}/${MAX_PLAYERS})</span>
                 </div>`}
        `;
        return actionsHtml;
    }

    if (!isParticipant) {
        if (realPlayerCount >= MAX_PLAYERS) {
            actionsHtml = `<div class="px-6 py-4 rounded-xl bg-white/5 border border-white/5 text-center w-full">
                <span class="text-[10px] font-black text-muted uppercase tracking-widest">PROTOCOLO COMPLETO (${MAX_PLAYERS}/${MAX_PLAYERS})</span>
            </div>`;
        } else {
            actionsHtml = `<button class="btn-confirm-v7" onclick="executeMatchAction('join', '${id}', '${col}')">
                <span class="t-main">UNIRSE AL SQUAD</span>
                <i class="fas fa-fingerprint"></i>
            </button>`;
        }
    } else {
        actionsHtml = `
            <div class="flex-row gap-2 w-full">
                <button class="flex-1 py-4 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black text-white hover:bg-white/10" onclick="executeMatchAction('leave', '${id}', '${col}')">
                    ABANDONAR
                </button>
                <button class="flex-1 py-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-black text-cyan-400 hover:bg-cyan-500/20" onclick="window.startSwapMode('${id}', '${col}')">
                    POSICIÓN
                </button>
                ${isOrganizer ? 
                    `<button class="flex-1 py-4 rounded-xl bg-red-500/10 border border-red-500/30 text-[10px] font-black text-red-500 hover:bg-red-500/20" onclick="executeMatchAction('delete', '${id}', '${col}')">CANCELAR</button>` : 
                    `<button class="flex-1 py-4 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black text-muted opacity-40 cursor-not-allowed" disabled>CANCELAR</button>`
                }
            </div>
            ${realPlayerCount === MAX_PLAYERS ? `
                ${canReportNow || isAdmin ? `
                    <button class="btn-confirm-v7 mt-2" onclick="openResultForm('${id}', '${col}')">
                        <span class="t-main">REPORTAR RESULTADO</span>
                        <i class="fas fa-flag-checkered"></i>
                    </button>
                ` : `
                    <button class="btn-confirm-v7 mt-2 opacity-60 cursor-not-allowed" disabled>
                        <span class="t-main">RESULTADO BLOQUEADO (1H30)</span>
                        <i class="fas fa-hourglass-half"></i>
                    </button>
                `}
            ` : ''}
        `;
    }
    return actionsHtml;
}

window.startSwapMode = async (mid, col) => {
    const slots = document.querySelectorAll('.p-slot-v7');
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;
    const me = await getDocument('usuarios', myUid);
    const isAdmin = me?.rol === 'Admin' || auth.currentUser?.email === 'Juanan221091@gmail.com';
    const match = await getDocument(col, mid);
    if (!match) return;
    const isOrganizer = match.organizerId === myUid || match.creador === myUid || isAdmin;
    const isParticipant = (match.jugadores || []).includes(myUid);
    const isPlayed = !!match.resultado?.sets || String(match.estado || '').toLowerCase() === 'cancelado' || String(match.estado || '').toLowerCase() === 'anulado';
    if (isPlayed || canReportResultNow(match)) {
        showToast("BLOQUEADO", "No se puede cambiar posición en un partido finalizado.", "warning");
        return;
    }
    if (!isOrganizer && !isParticipant) {
        showToast("SIN PERMISOS", "Solo organizador/admin o participantes pueden cambiar posición.", "error");
        return;
    }
    
    // Remove existing overlays first
    document.querySelectorAll('.swap-overlay').forEach(el => el.remove());

    if (isOrganizer && !isParticipant) {
        let firstPick = null;
        showToast("MODO POSICIÓN", "Selecciona dos plazas para intercambiar.", "info");
        slots.forEach((s, idx) => {
            const overlay = document.createElement('div');
            overlay.className = 'swap-overlay absolute inset-0 bg-cyan-400/20 backdrop-blur-sm rounded-2xl flex center z-20 cursor-pointer';
            overlay.innerHTML = `<span class="text-[8px] font-black text-black bg-cyan-300 px-2 py-1 rounded">ELEGIR</span>`;
            overlay.onclick = async (e) => {
                e.stopPropagation();
                if (firstPick === null) {
                    firstPick = idx;
                    overlay.innerHTML = `<span class="text-[8px] font-black text-black bg-primary px-2 py-1 rounded">1ª PLAZA</span>`;
                    return;
                }
                if (firstPick === idx) return;
                await window.executeMatchAction('swap', mid, col, { from: firstPick, to: idx });
                document.querySelectorAll('.swap-overlay').forEach(el => el.remove());
            };
            s.style.position = 'relative';
            s.appendChild(overlay);
        });
        return;
    }

    showToast("MODO POSICIÓN", "Selecciona una nueva plaza para intercambiarte", "info");
    
    slots.forEach((s, idx) => {
        // Check if this slot contains me
        const isMe = s.innerHTML.includes(myUid) || s.querySelector(`img[src*="${encodeURIComponent(myUid)}"]`);
        if (isMe) {
            s.classList.add('ring-2', 'ring-primary');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'swap-overlay absolute inset-0 bg-primary/20 backdrop-blur-sm rounded-2xl flex center z-20 cursor-pointer animate-pulse';
        overlay.innerHTML = `<span class="text-[8px] font-black text-black bg-primary px-2 py-1 rounded">MOVER AQUÍ</span>`;
        overlay.onclick = (e) => {
            e.stopPropagation();
            window.executeMatchAction('swap', mid, col, {to: idx});
            document.querySelectorAll('.swap-overlay').forEach(el => el.remove());
        };
        s.style.position = 'relative';
        s.appendChild(overlay);
    });
};



/**
 * Universal action handler.
 */
window.executeMatchAction = async (action, id, col, extra = {}) => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, col, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const m = snap.data();
    let jugs = [...(m.jugadores || [])];
    const matchDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);

    try {
        if (action === 'join' || action === 'leave') {
            const rl = rateLimitCheck(`match_${action}:${user.uid}:${id}`, { windowMs: 5 * 60 * 1000, max: 12, minIntervalMs: 1800 });
            if (!rl.ok) return showToast("BLOQUEADO", "Demasiadas acciones repetidas. Espera unos segundos.", "warning");
        }
        const { showLoading, hideLoading } = await import('./modules/ui-loader.js?v=6.5');
        const labels = { 'join': 'Uniéndose...', 'leave': 'Abandonando...', 'delete': 'Cancelando...', 'remove': 'Procesando...', 'add': 'Añadiendo...' };
        showLoading(labels[action] || "Sincronizando...", true);

        const isAdmin = (await getDocument('usuarios', user.uid))?.rol === 'Admin' || user.email === 'Juanan221091@gmail.com';
        const isOrganizer = m.organizerId === user.uid || m.creador === user.uid || isAdmin;
        const mState = String(m.estado || '').toLowerCase();
        const isPlayed = !!m.resultado?.sets || mState === 'cancelado' || mState === 'anulado';
        const isPastKickoff = Number.isFinite(matchDate?.getTime?.()) && Date.now() > matchDate.getTime();
        const timeLockedActions = ['join', 'add', 'swap'];
        if (isPastKickoff && !isPlayed && timeLockedActions.includes(action)) {
            hideLoading();
            return showToast("BLOQUEADO", "La franja ya pasó. Solo se permite consulta o reporte de resultado.", "warning");
        }
        
        if (action === 'join') {
            const joinT0 = performance.now();
            const d = await getDoc(doc(db, "usuarios", user.uid));
            const uLvl = d.data()?.nivel || 2.5;

            const joinResult = await runTransaction(db, async (tx) => {
                const snapTx = await tx.get(ref);
                if (!snapTx.exists()) return { ok: false, reason: "not_found" };
                const mTx = snapTx.data();
                const jugsTx = [...(mTx.jugadores || [])];
                while (jugsTx.length < MAX_PLAYERS) jugsTx.push(null);
                if (jugsTx.includes(user.uid)) return { ok: false, reason: "already_in" };

                const mDate = getMatchDate(mTx);
                if (mDate && Date.now() > mDate.getTime()) return { ok: false, reason: "time_locked" };
                if (mTx.restriccionNivel && (uLvl < mTx.restriccionNivel.min || uLvl > mTx.restriccionNivel.max)) {
                    return { ok: false, reason: "level_restricted" };
                }
                if (mTx.visibility === 'private') {
                    const isInvited = (mTx.invitedUsers || []).includes(user.uid);
                    const isOwnerTx = mTx.organizerId === user.uid || mTx.creador === user.uid;
                    if (!isInvited && !isOwnerTx) return { ok: false, reason: "private_denied" };
                }

                const emptyIdx = jugsTx.findIndex((id) => !id);
                if (emptyIdx === -1) return { ok: false, reason: "full" };
                jugsTx[emptyIdx] = user.uid;
                tx.update(ref, {
                    jugadores: jugsTx,
                    equipoA: [jugsTx[0], jugsTx[1]],
                    equipoB: [jugsTx[2], jugsTx[3]],
                });
                return { ok: true, players: jugsTx };
            });

            if (!joinResult?.ok) {
                hideLoading();
                const reason = joinResult?.reason || "unknown";
                if (reason === "already_in") return showToast("INFO", "Ya formas parte de este partido", "info");
                if (reason === "full") return showToast("COMPLETO", "Sin huecos en este nodo", "warning");
                if (reason === "level_restricted") return showToast("ACCESO DENEGADO", "Nivel incompatible con el protocolo", "warning");
                if (reason === "private_denied") return showToast("ACCESO DENEGADO", "Requiere invitación oficial", "error");
                if (reason === "time_locked") return showToast("BLOQUEADO", "La franja ya pasó. Solo consulta/resultado.", "warning");
                return showToast("ERROR", "No se pudo unir por conflicto de sincronización.", "error");
            }
            jugs = joinResult.players || jugs;
            analyticsTiming("match.join_ms", performance.now() - joinT0);
            
            if (jugs.filter(id => id).length === MAX_PLAYERS) {
                try {
                    const { AIOrchestrator } = await import('./ai-orchestrator.js');
                    AIOrchestrator.dispatch('MATCH_READY', { uid: user.uid, matchId: id });
                } catch(err) {}
                
                // Match Filled Notification
                const others = jugs.filter(uid => uid !== user.uid && !uid.startsWith('GUEST_'));
                const day = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                const time = matchDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                await createNotification(
                    others,
                    "Partido completo",
                    `La partida del ${day} a las ${time} está cerrada: ya sois ${MAX_PLAYERS} jugadores.`,
                    'match_full',
                    'home.html',
                    { type: 'match_full', matchId: id, dedupId: `match_full_${id}` }
                );
            }
            
            const myName = d.data()?.nombreUsuario || 'Un jugador';
            const joinDay = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
            await createNotification(
                m.creador,
                "Nuevos Datos",
                `${myName} se ha unido a tu partida del ${joinDay}.`,
                'match_join',
                'calendario.html',
                { type: 'match_join', matchId: id, matchCollection: col, dedupId: `match_join_${id}_${user.uid}` }
            );
            
            hideLoading();
            triggerFeedback(FEEDBACK.MATCH.JOINED);
            if(window.closeMatchModal) window.closeMatchModal();
        } 
        else if (action === 'leave') {
            const wasFull = jugs.filter(id => id).length === MAX_PLAYERS;
            const idx = jugs.indexOf(user.uid);
            if (idx !== -1) {
                const now = new Date();
                const elapsedMs = now - matchDate;
                if (elapsedMs > MATCH_DURATION_MS) {
                    hideLoading();
                    return showToast("BLOQUEADO", "No puedes abandonar un partido que ya ha comenzado (Lock 1.30h)", "error");
                }

                jugs[idx] = null;
                const activeJugs = jugs.filter(id => id && !id.startsWith('GUEST_'));
                
                if (activeJugs.length === 0 && jugs.filter(id => id).length === 0) {
                    await deleteDoc(ref);
                    hideLoading();
                    triggerFeedback({title: "NODO COLAPSADO", msg: "Partido eliminado por vacío", type: "info"});
                } else {
                    await updateDoc(ref, { 
                        jugadores: jugs,
                        creador: activeJugs[0] || m.creador,
                        equipoA: [jugs[0], jugs[1]],
                        equipoB: [jugs[2], jugs[3]]
                    });

                    if (wasFull) {
                        try {
                            const { AIOrchestrator } = await import('./ai-orchestrator.js');
                            AIOrchestrator.dispatch('MATCH_UNREADY', { uid: user.uid, matchId: id });
                        } catch(err) {}
                    }
                    
                    const meDoc = await getDocument('usuarios', user.uid);
                    const leaveName = meDoc?.nombreUsuario || meDoc?.nombre || 'Un jugador';
                    const stillInMatch = jugs.filter(id => id && id !== user.uid && !id.startsWith('GUEST_'));
                    if (stillInMatch.length > 0) {
                        const leaveDay = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                        await createNotification(
                            stillInMatch,
                            "Jugador fuera de la partida",
                            `${leaveName} ha abandonado la partida del ${leaveDay}.`,
                            'match_leave',
                            'calendario.html',
                            { matchId: id, type: 'match_leave', dedupId: `match_leave_${id}_${user.uid}` }
                        );
                    }
                    hideLoading();
                    triggerFeedback(FEEDBACK.MATCH.LEFT);
                    if(window.closeMatchModal) window.closeMatchModal();
                }
            } else { hideLoading(); }
        }
        else if (action === 'delete') {
            if (!isOrganizer) { hideLoading(); return triggerFeedback(FEEDBACK.MATCH.PERMISSION_DENIED); }
            
            if (confirm("¿Abortar misión?")) {
                const others = jugs.filter(uid => uid !== user.uid && !uid.startsWith('GUEST_'));
                const adminDoc = await getDocument('usuarios', user.uid);
                const adminName = adminDoc?.nombreUsuario || adminDoc?.nombre || 'El organizador';
                const day = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                await createNotification(
                    others,
                    "Partido cancelado",
                    `La partida de ${adminName} del ${day} fue cancelada.`,
                    'match_cancelled',
                    'calendario.html',
                    { type: 'match_cancelled', matchId: id, dedupId: `match_cancelled_${id}` }
                );
                await deleteDoc(ref); 
                hideLoading();
                triggerFeedback(FEEDBACK.MATCH.CANCELLED); 
            } else { hideLoading(); }
        }
        else if (action === 'remove') {
            if (!isOrganizer) { hideLoading(); return triggerFeedback(FEEDBACK.MATCH.PERMISSION_DENIED); }
            
            const removedUid = jugs[extra.idx];
            if (removedUid && !removedUid.startsWith('GUEST_')) {
                const day = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                await createNotification(
                    removedUid,
                    "Baja del Squad",
                    `Se te ha retirado de la partida del ${day}.`,
                    'warning',
                    'calendario.html',
                    { type: 'match_removed', matchId: id, matchCollection: col, dedupId: `match_removed_${id}_${removedUid}` }
                );
            }
            
            jugs[extra.idx] = null;
            const updates = { 
                jugadores: jugs,
                equipoA: [jugs[0], jugs[1]],
                equipoB: [jugs[2], jugs[3]]
            };

            // If we removed the creator, reassign or handle it
            if (extra.idx === 0) {
                 const newCreator = jugs.find(j => j && !j.startsWith('GUEST_'));
                 if (newCreator) {
                     updates.creador = newCreator;
                     updates.organizerId = newCreator;
                     await createNotification(newCreator, "Nuevo Host", "Has sido designado como el nuevo organizador del partido.", "info", "calendario.html");
                 }
            }

            await updateDoc(ref, updates);
            hideLoading();
            triggerFeedback({title: "ELIMINADO", msg: "Jugador expulsado", type: "info"});
        }
        else if (action === 'add') {
             if (!isOrganizer) { hideLoading(); return triggerFeedback(FEEDBACK.MATCH.PERMISSION_DENIED); }

             const addResult = await runTransaction(db, async (tx) => {
                const snapTx = await tx.get(ref);
                if (!snapTx.exists()) return { ok: false, reason: "not_found" };
                const mTx = snapTx.data();
                const jugsTx = [...(mTx.jugadores || [])];
                while (jugsTx.length < MAX_PLAYERS) jugsTx.push(null);

                if (jugsTx.includes(extra.uid)) return { ok: false, reason: "already_in" };
                const targetIdx = extra.idx !== undefined ? Number(extra.idx) : jugsTx.findIndex((id) => !id);
                if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx >= MAX_PLAYERS) return { ok: false, reason: "invalid_slot" };
                if (jugsTx[targetIdx]) return { ok: false, reason: "slot_busy" };
                if (jugsTx.filter((id) => id).length >= MAX_PLAYERS) return { ok: false, reason: "full" };

                jugsTx[targetIdx] = extra.uid;
                tx.update(ref, {
                    jugadores: jugsTx,
                    equipoA: [jugsTx[0], jugsTx[1]],
                    equipoB: [jugsTx[2], jugsTx[3]],
                });
                return { ok: true, players: jugsTx };
             });

             if (!addResult?.ok) {
                hideLoading();
                const reason = addResult?.reason || "unknown";
                if (reason === "already_in") return showToast("INFO", "Ese jugador ya está en el partido", "info");
                if (reason === "full") return triggerFeedback(FEEDBACK.MATCH.FULL);
                if (reason === "slot_busy") return showToast("BLOQUEADO", "Ese hueco ya está ocupado", "warning");
                return showToast("ERROR", "No se pudo añadir por conflicto de sincronización.", "error");
             }
             jugs = addResult.players || jugs;
             
             if (!extra.uid.startsWith('GUEST_')) {
                const day = matchDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                const currentPlayers = jugs.filter(id => id).length;
                await createNotification(
                    extra.uid,
                    "¡Convocado!",
                    `Te han unido a una partida para el ${day}. Ya sois ${currentPlayers}/${MAX_PLAYERS} jugadores.`,
                    'match_join',
                    'calendario.html',
                    { type: 'match_join', matchId: id, matchCollection: col, dedupId: `match_add_${id}_${extra.uid}` }
                );
             }
             hideLoading();
             triggerFeedback({title: "AÑADIDO", msg: "Agente reclutado", type: "success"});
        }
        else if (action === 'swap') {
            const state = String(m.estado || '').toLowerCase();
            const played = !!m.resultado?.sets || state === 'cancelado' || state === 'anulado';
            if (played) {
                hideLoading();
                return showToast("BLOQUEADO", "No se puede cambiar posición tras finalizar.", "warning");
            }
            const fromIdx = extra.from !== undefined ? Number(extra.from) : jugs.indexOf(user.uid);
            const toIdx = extra.to;
            if (fromIdx === -1 || toIdx === undefined) { hideLoading(); return; }
            
            const temp = jugs[toIdx];
            jugs[toIdx] = jugs[fromIdx];
            jugs[fromIdx] = temp;
            
            await updateDoc(ref, { 
                jugadores: jugs,
                equipoA: [jugs[0], jugs[1]],
                equipoB: [jugs[2], jugs[3]]
            });
            hideLoading();
            triggerFeedback({title: "POSICIÓN ACTUALIZADA", msg: "Alineación reconfigurada", type: "success"});
            if(window.closeMatchModal) window.closeMatchModal();
        }
    } catch(e) { 
        const { hideLoading } = await import('./modules/ui-loader.js?v=6.5');
        hideLoading();
        handleOperationError(e); 
    }
};

/**
 * Initializes real-time chat.
 */
async function initMatchChat(id, col) {
    const box = document.getElementById('match-chat-msgs');
    if (!box) return;
    const q = query(collection(db, col, id, 'chat'), orderBy('timestamp', 'asc'), limit(30));
    safeOnSnapshot(q, async (snap) => {
        const msgs = await Promise.all(snap.docs.map(async d => {
            const data = d.data();
            const sender = await getPlayerName(data.uid);
            const isMe = data.uid === auth.currentUser?.uid;
            // Use simple chat styling since comms-panel handles container
            return `
                <div class="flex-row items-end gap-2 mb-2 ${isMe ? 'justify-end' : ''}">
                    <div class="px-3 py-2 rounded-xl text-[10px] ${isMe ? 'bg-primary text-black' : 'bg-white/10 text-white'}" style="max-width:80%">
                        <div class="font-black opacity-50 text-[7px] mb-1 uppercase">${sender}</div>
                        ${data.text}
                    </div>
                </div>
            `;
        }));
        box.innerHTML = msgs.length > 0 ? msgs.join('') : '<div class="center opacity-20 text-[8px] py-10">CANAL LIMPIO</div>';
        box.scrollTop = box.scrollHeight;
    });
}

window.sendMatchChat = async (id, col) => {
    const inp = document.getElementById('match-chat-in');
    const text = inp.value.trim();
    if (!text || !auth.currentUser) return;
    if (text.length > 500) {
        return showToast("MENSAJE LARGO", "Máximo 500 caracteres por mensaje.", "warning");
    }
    const msgRef = await addDoc(collection(db, col, id, 'chat'), {
        uid: auth.currentUser.uid,
        authorId: auth.currentUser.uid,
        text,
        timestamp: serverTimestamp()
    });
    inp.value = '';

    try {
        const targets = await resolveMentionTargets(id, col, text, auth.currentUser.uid);
        if (targets.length > 0) {
            const me = await getDocument('usuarios', auth.currentUser.uid);
            const senderName = me?.nombreUsuario || me?.nombre || 'Un jugador';
            await createNotification(
                targets,
                "Te han mencionado en el chat",
                `${senderName} te ha mencionado en el chat del partido.`,
                "chat_mention",
                "calendario.html",
                { matchId: id, type: "chat_mention", dedupId: `chat_mention_${msgRef.id}` }
            );
        }
    } catch (e) {
        logError("mention_notification_skipped", { reason: e?.message || "unknown" });
    }
};

function normalizeMentionToken(v) {
    return String(v || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._-]/g, '');
}

function extractMentionTokens(text) {
    const tokens = [];
    const regex = /@([a-zA-Z0-9._-]{2,40})/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
        const token = normalizeMentionToken(m[1]);
        if (token) tokens.push(token);
    }
    return Array.from(new Set(tokens));
}

async function resolveMentionTargets(matchId, col, text, senderUid) {
    const mentions = extractMentionTokens(text);
    if (mentions.length === 0) return [];

    const mSnap = await getDoc(doc(db, col, matchId));
    if (!mSnap.exists()) return [];
    const players = (mSnap.data()?.jugadores || [])
        .filter(uid => uid && !uid.startsWith('GUEST_') && uid !== senderUid);
    if (players.length === 0) return [];

    const profiles = await Promise.all(players.map(async uid => {
        const p = await getDocument('usuarios', uid);
        return {
            uid,
            userToken: normalizeMentionToken(p?.nombreUsuario || ''),
            nameToken: normalizeMentionToken(p?.nombre || '')
        };
    }));

    return profiles
        .filter(p =>
            mentions.includes(p.userToken) ||
            mentions.includes(p.nameToken) ||
            mentions.some(t => p.userToken.startsWith(t) || p.nameToken.startsWith(t))
        )
        .map(p => p.uid);
}

async function getPlayerName(uid) {
    if (!uid) return 'Anónimo';
    if (uid.startsWith('GUEST_')) return uid.split('_')[1];
    const d = await getDocument('usuarios', uid);
    return d?.nombreUsuario || d?.nombre || 'Jugador';
}

window.closeMatchModal = () => {
    document.getElementById('modal-match')?.classList.remove('active');
    if (typeof matchDetailUnsub === "function") {
        try { matchDetailUnsub(); } catch (_) {}
        matchDetailUnsub = null;
    }
};

window.openResultForm = async (id, col) => {
    const area = document.getElementById('match-detail-area');
    if (!area) return;
    ensureApoingStyles();
    const meUid = auth.currentUser?.uid;
    const matchDoc = await getDocument(col, id);
    if (!matchDoc) {
        showToast("ERROR", "No se pudo cargar el partido.", "error");
        return;
    }
    const players = Array.isArray(matchDoc?.jugadores) ? matchDoc.jugadores : [];
    const meData = meUid ? await getDocument("usuarios", meUid) : null;
    const isAdmin = meData?.rol === "Admin" || auth.currentUser?.email === "Juanan221091@gmail.com";
    const isParticipant = !!meUid && players.includes(meUid);
    const hasResult = !!matchDoc?.resultado?.sets;
    const state = String(matchDoc?.estado || "").toLowerCase();
    const isPlayed = hasResult || state === "cancelado" || state === "anulado";

    if (isPlayed) {
        const resultRead = matchDoc?.resultado?.sets || 'Sin resultado';
        const parsed = parseMatchResult(resultRead);
        const winA = parsed.winnerTeam === 'A';
        
        area.innerHTML = `
            <div class="booking-hub-v7 animate-up p-3 max-w-sm mx-auto">
                <div class="flex-col items-center mb-6">
                    <span class="text-[9px] uppercase tracking-[3px] font-black text-muted mb-2">Match Protocol</span>
                    <h3 class="hub-title-v7 text-center">PARTIDO COMPLETADO</h3>
                </div>

                <div class="flex-row items-stretch gap-2 mb-6">
                     <div class="flex-1 flex-col items-center p-4 rounded-2xl border ${winA ? 'border-primary bg-primary/5' : 'border-white/5 bg-white/3 opacity-60'}">
                        <span class="text-[8px] font-black text-muted uppercase mb-2">Equipo A</span>
                        ${winA ? '<span class="text-[10px] font-bold text-primary mb-2"><i class="fas fa-trophy mr-1"></i> GANADOR</span>' : ''}
                        <div class="flex-row gap-1">
                            <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10 overflow-hidden"><img src="https://ui-avatars.com/api/?name=A1&background=random" class="w-full h-full object-cover"></div>
                            <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10 overflow-hidden"><img src="https://ui-avatars.com/api/?name=A2&background=random" class="w-full h-full object-cover"></div>
                        </div>
                     </div>

                     <div class="flex center px-2">
                        <span class="text-xl font-black italic text-muted">VS</span>
                     </div>

                     <div class="flex-1 flex-col items-center p-4 rounded-2xl border ${!winA ? 'border-primary bg-primary/5' : 'border-white/5 bg-white/3 opacity-60'}">
                        <span class="text-[8px] font-black text-muted uppercase mb-2">Equipo B</span>
                        ${!winA ? '<span class="text-[10px] font-bold text-primary mb-2"><i class="fas fa-trophy mr-1"></i> GANADOR</span>' : ''}
                        <div class="flex-row gap-1">
                            <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10 overflow-hidden"><img src="https://ui-avatars.com/api/?name=B1&background=random" class="w-full h-full object-cover"></div>
                            <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10 overflow-hidden"><img src="https://ui-avatars.com/api/?name=B2&background=random" class="w-full h-full object-cover"></div>
                        </div>
                     </div>
                </div>

                <div class="p-5 rounded-3xl border border-white/10 bg-white/5 text-center mb-6 relative overflow-hidden">
                    <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent"></div>
                    <span class="text-[10px] font-black text-muted tracking-widest relative z-10">MARCADOR FINAL</span>
                    <div class="text-4xl font-black italic text-white mt-3 tracking-tighter relative z-10">${resultRead}</div>
                </div>

                <button class="btn-confirm-v7" onclick="window.closeHomeMatchModal()">
                    <span class="t-main">CERRAR PROTOCOLO</span>
                    <i class="fas fa-check"></i>
                </button>
            </div>
        `;
        return;
    }

    if (!isParticipant && !isAdmin) {
        const resultRead = matchDoc?.resultado?.sets || 'Aún sin resultado';
        area.innerHTML = `
            <div class="booking-hub-v7 animate-up p-3 max-w-sm mx-auto">
                <h3 class="hub-title-v7 text-center mb-4">Resultado del Partido</h3>
                <div class="p-4 rounded-2xl border border-white/10 bg-white/5 text-center">
                    <span class="text-[9px] uppercase tracking-[3px] font-black text-muted">Modo lectura</span>
                    <div class="text-2xl font-black italic text-white mt-2">${resultRead}</div>
                    <p class="text-[10px] text-white/65 mt-3">Solo los jugadores que participan en este partido pueden anotar o modificar el resultado.</p>
                </div>
                <button class="btn-confirm-v7 mt-4" onclick="window.closeMatchModal()">
                    <span class="t-main">ENTENDIDO</span>
                    <i class="fas fa-check"></i>
                </button>
            </div>
        `;
        return;
    }

    const matchDate = getMatchDate(matchDoc);
    if (!isAdmin) {
        if ((players.filter(Boolean).length || 0) < MAX_PLAYERS) {
            area.innerHTML = `
                <div class="booking-hub-v7 animate-up p-3 max-w-sm mx-auto">
                    <h3 class="hub-title-v7 text-center mb-4">Resultado bloqueado</h3>
                    <div class="p-4 rounded-2xl border border-white/10 bg-white/5 text-center">
                        <p class="text-[10px] text-white/65 mt-2">Aún no hay ${MAX_PLAYERS} jugadores confirmados en la partida.</p>
                    </div>
                    <button class="btn-confirm-v7 mt-4" onclick="window.closeMatchModal()">
                        <span class="t-main">ENTENDIDO</span>
                        <i class="fas fa-check"></i>
                    </button>
                </div>
            `;
            return;
        }

        const openAt = matchDate ? (matchDate.getTime() + MATCH_DURATION_MS) : null;
        if (!openAt || Date.now() < openAt) {
            const minsLeft = openAt ? Math.max(1, Math.ceil((openAt - Date.now()) / 60000)) : 90;
            area.innerHTML = `
                <div class="booking-hub-v7 animate-up p-3 max-w-sm mx-auto">
                    <h3 class="hub-title-v7 text-center mb-4">Resultado bloqueado</h3>
                    <div class="p-4 rounded-2xl border border-white/10 bg-white/5 text-center">
                        <p class="text-[10px] text-white/65 mt-2">Solo se puede reportar tras 1h30 desde la reserva.</p>
                        <p class="text-xs font-black text-primary mt-3">Tiempo restante: ${minsLeft} min</p>
                    </div>
                    <button class="btn-confirm-v7 mt-4" onclick="window.closeMatchModal()">
                        <span class="t-main">ENTENDIDO</span>
                        <i class="fas fa-check"></i>
                    </button>
                </div>
            `;
            return;
        }
    }

    // Fetch player names for MVP selection
    const playerNames = await Promise.all(players.map(async (uid) => {
        if (!uid) return { id: null, name: 'Vacío' };
        const name = await getPlayerName(uid);
        return { id: uid, name };
    }));

    // Use V7 Booking Hub style for result form
    area.innerHTML = `
        <div class="booking-hub-v7 animate-up p-2 max-w-sm mx-auto">
            <h3 class="hub-title-v7 text-center mb-6">Resultados</h3>
            <div class="flex-col gap-4 mb-6">
                ${[1, 2, 3].map(i => `
                    <div class="range-box-v7 justify-between" id="set-row-${i}">
                        <span class="text-[10px] font-black text-primary w-12">SET ${i}</span>
                        <div class="flex-row gap-4">
                             <input type="number" id="s${i}-1" class="bg-transparent border-none text-white font-black text-xl w-10 text-center outline-none" placeholder="0" onchange="checkSets()">
                             <span class="opacity-30">-</span>
                             <input type="number" id="s${i}-2" class="bg-transparent border-none text-white font-black text-xl w-10 text-center outline-none" placeholder="0" onchange="checkSets()">
                        </div>
                    </div>
                `).join('')}
            </div>

            <!-- MVP SELECTOR -->
            <div class="range-box-v7 flex-col gap-2 mb-8 items-start">
                <span class="text-[10px] font-black text-primary uppercase tracking-widest pl-1">Seleccionar MVP (+Bonus)</span>
                <select id="mvp-select" class="w-full bg-transparent border-none text-white font-black text-xs h-10 outline-none cursor-pointer">
                    <option value="" class="bg-[#0f172a]">Ninguno</option>
                    ${playerNames.map(p => p.id ? `<option value="${p.id}" class="bg-[#0f172a]">${p.name.toUpperCase()}</option>` : '').join('')}
                </select>
            </div>

            <button class="btn-confirm-v7" id="btn-save-res">
                <span class="t-main">REGISTRAR DATOS</span>
                <i class="fas fa-save"></i>
            </button>
            ${renderApoingLink("Comprobar reserva en Apoing")}
        </div>
    `;

    window.checkSets = () => {
        const s1_1 = parseInt(document.getElementById('s1-1').value) || 0;
        const s1_2 = parseInt(document.getElementById('s1-2').value) || 0;
        const s2_1 = parseInt(document.getElementById('s2-1').value) || 0;
        const s2_2 = parseInt(document.getElementById('s2-2').value) || 0;

        const w1 = s1_1 > s1_2 ? 1 : (s1_2 > s1_1 ? 2 : 0);
        const w2 = s2_1 > s2_2 ? 1 : (s2_2 > s2_1 ? 2 : 0);

        const row3 = document.getElementById('set-row-3');
        if (row3) {
            if (w1 !== 0 && w1 === w2) {
                row3.style.opacity = '0.2';
                row3.style.pointerEvents = 'none';
                document.getElementById('s3-1').value = '';
                document.getElementById('s3-2').value = '';
            } else {
                row3.style.opacity = '1';
                row3.style.pointerEvents = 'auto';
            }
        }
    };

    document.getElementById('btn-save-res').onclick = async () => {
        const saveBtn = document.getElementById('btn-save-res');
        const prevBtnHtml = saveBtn?.innerHTML || '';
        const res = [];
        for(let i=1; i<=3; i++){
            const i1 = document.getElementById(`s${i}-1`);
            const i2 = document.getElementById(`s${i}-2`);
            if (i1 && i2 && i1.value !== '' && i2.value !== '') {
                res.push(`${i1.value}-${i2.value}`);
            }
        }
        
        if (res.length < 2) return showToast("INCOMPLETO", "Se requieren al menos 2 sets", "warning");

        const resultT0 = performance.now();
        try {
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = `<span class="t-main">GUARDANDO...</span><i class="fas fa-spinner fa-spin"></i>`;
            }
            showToast("Guardando...", "Registrando resultado oficial del partido.", "info");
            const resultStr = res.join(' ');
            const mvpId = document.getElementById('mvp-select')?.value || null;
            
            // We only call processMatchResults, it will handle estado: 'jugado' atomically
            const rankingSync = await processMatchResults(id, col, resultStr, { mvpId });
            if (!rankingSync?.success) {
                throw new Error(rankingSync?.error || 'ranking-sync-failed');
            }
            await syncLinkedEventMatchFromRegularMatch(id, col, resultStr);
            const meData = await getDocument('usuarios', auth.currentUser.uid);
            const meName = meData?.nombreUsuario || meData?.nombre || 'Un jugador';
            const targetUids = (rankingSync?.changes || [])
                .map((c) => c?.uid)
                .filter((uid) => uid && uid !== auth.currentUser.uid && !String(uid).startsWith('GUEST_'));
            if (targetUids.length > 0) {
                await createNotification(
                    targetUids,
                    "Resultado subido",
                    `${meName} subió el resultado: ${resultStr}.`,
                    "result_uploaded",
                    "puntosRanking.html",
                    { type: "result_uploaded", matchId: id, dedupId: `result_uploaded_${id}` },
                );
            }
            const diaryTargets = (rankingSync?.changes || [])
                .filter((c) => c?.uid && !String(c.uid).startsWith('GUEST_'))
                .map((c) => ({ uid: c.uid, won: Boolean(c.analysis?.won) }));
            await Promise.all(diaryTargets.map((t) => suggestDiaryEntry(t.uid, id, t.won).catch(() => null)));
            if (!rankingSync?.skipped) analyticsCount("matches.completed", 1);
            analyticsTiming("match.report_result_ms", performance.now() - resultT0);
            showToast(
                "DATOS GUARDADOS",
                rankingSync?.skipped ? "Resultado guardado (ranking ya procesado)." : "Ranking actualizado",
                "success"
            );
            window.closeMatchModal();
            if (!rankingSync?.skipped) {
                await showPostMatchSummaryModal(rankingSync, id);
            } else {
                setTimeout(() => {
                    try { window.location.href = `diario.html?matchId=${id}`; } catch (_) {}
                }, 900);
            }
        } catch (e) {
            showToast("ERROR", `Fallo al guardar resultados (${e?.message || 'sync'})`, "error");
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = prevBtnHtml;
            }
        }
    };
};

// --- DYNAMIC UI HELPERS ---
window.toggleCourtInput = (sel) => {
    const customInp = document.getElementById('inp-court-custom');
    const finalInp = document.getElementById('inp-court');
    if (sel.value === 'custom') {
        customInp.classList.remove('hidden');
        customInp.focus();
        finalInp.value = customInp.value; 
    } else {
        customInp.classList.add('hidden');
        finalInp.value = sel.value;
    }
};

window.openPlayerSelector = async (matchId, col, extra) => {
    const q = query(collection(db, 'usuarios'), orderBy('nombreUsuario'), limit(50));
    const listSnap = await getDocs(q);
    const users = listSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:360px">
            <div class="modal-header border-b border-white/10 p-4 flex-row between items-center">
                <span class="text-xs font-black text-white uppercase tracking-widest">AÑADIR JUGADOR</span>
                <button class="close-btn w-8 h-8 rounded-full bg-white/5 flex center" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times text-white"></i></button>
            </div>
            
            <div class="p-4">
                <div class="ps-tabs flex-row gap-2 mb-4">
                    <div class="ps-tab active flex-1 p-2 text-center rounded-xl bg-primary text-black font-black text-xs cursor-pointer" onclick="window.switchPsTab(this, 'search')">EXISTENTE</div>
                    <div class="ps-tab flex-1 p-2 text-center rounded-xl bg-white/5 text-white font-black text-xs cursor-pointer" onclick="window.switchPsTab(this, 'guest')">INVITADO</div>
                </div>
                
                <div id="ps-panel-search">
                    <input type="text" id="ps-search" class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold mb-3 outline-none focus:border-primary/50" placeholder="Buscar jugador..." oninput="window.filterPsUsers(this.value)">
                    <div id="ps-list" class="flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scroll">
                        <!-- Users Rendered Here -->
                    </div>
                </div>
                
                <div id="ps-panel-guest" class="hidden flex-col gap-3">
                    <input type="text" id="guest-name" class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold outline-none focus:border-primary/50" placeholder="Nombre Invitado">
                    <div class="flex-row gap-2">
                        <input type="number" id="guest-level" class="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold outline-none focus:border-primary/50" placeholder="Nivel (2.5)" step="0.1">
                        <input type="text" id="guest-pala" class="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold outline-none focus:border-primary/50" placeholder="Pala (Opcional)">
                    </div>
                </div>

                <button id="btn-add-guest" class="hidden w-full py-4 mt-4 bg-gradient-to-r from-primary to-lime-400 rounded-xl text-black font-black text-xs tracking-widest shadow-glow hover:scale-[1.02] transition-transform" onclick="window.addGuest('${matchId}', '${col}', ${JSON.stringify(extra).replace(/"/g, "'")})">
                    CONFIRMAR INVITADO <i class="fas fa-check ml-2"></i>
                </button>

                <button class="w-full py-4 mt-6 bg-white/10 rounded-xl text-white font-black text-xs tracking-widest border border-white/10 hover:bg-white/20" onclick="this.closest('.modal-overlay').remove()">
                    FINALIZAR SELECCIÓN
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    window.psUsersCache = users;
    window.psMatchContext = { matchId, col, extra };
    window.filterPsUsers('');
};

window.switchPsTab = (tab, mode) => {
    document.querySelectorAll('.ps-tab').forEach(t => {
        t.classList.remove('bg-primary', 'text-black');
        t.classList.add('bg-white/5', 'text-white');
    });
    tab.classList.remove('bg-white/5', 'text-white');
    tab.classList.add('bg-primary', 'text-black');
    
    document.getElementById('ps-panel-search').classList.toggle('hidden', mode !== 'search');
    document.getElementById('ps-panel-guest').classList.toggle('hidden', mode !== 'guest');
    document.getElementById('btn-add-guest').classList.toggle('hidden', mode !== 'guest');
};

window.filterPsUsers = (q) => {
    const term = q.toLowerCase();
    const filtered = window.psUsersCache.filter(u => (u.nombreUsuario || u.nombre || '').toLowerCase().includes(term));
    const mid = window.psMatchContext.matchId;
    const col = window.psMatchContext.col;
    const extra = window.psMatchContext.extra;
    
    document.getElementById('ps-list').innerHTML = filtered.map(u => {
        const isNew = mid === 'NEW';
        const action = isNew ? `window.selectUserForNew('${u.id}')` : `window.executeMatchAction('add', '${mid}', '${col}', {uid:'${u.id}', idx:${extra.idx}})`;
        const finalAction = `${action}; showToast('Añadido', 'Jugador seleccionado');`;
        
        return `
        <div class="flex-row items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 hover:border-primary/50 cursor-pointer transition-all hover:bg-white/10" onclick="${finalAction}">
            <img src="${u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png'}" class="w-8 h-8 rounded-full bg-black/50 object-cover border border-white/10">
            <div class="flex-col flex-1">
                <span class="text-xs font-bold text-white">${u.nombreUsuario || u.nombre || 'Jugador'}</span>
                <span class="text-[9px] text-muted">Nivel ${(u.nivel || 2.5).toFixed(2)}</span>
            </div>
            <i class="fas fa-plus text-primary text-xs"></i>
        </div>
        `;
    }).join('');
};

window.addGuest = (mid, col, extra) => {
    const name = document.getElementById('guest-name').value.trim();
    const level = document.getElementById('guest-level').value || 2.5;
    const pala = document.getElementById('guest-pala').value.trim() || 'Desconocida';
    
    if (!name) return showToast("ERROR", "Nombre requerido", "error");
    
    const guestId = `GUEST_${name}_${level}_${pala}`;
    
    if (mid === 'NEW') {
        const u = { id: guestId, nombreUsuario: name + ' (Inv)', nivel: parseFloat(level), fotoPerfil: './imagenes/Logojafs.png', isGuest: true };
        if (!window.psUsersCache) window.psUsersCache = [];
        window.psUsersCache.push(u);
        window.selectUserForNew(guestId);
    } else {
        window.executeMatchAction('add', mid, col, { uid: guestId, idx: extra.idx });
    }
    showToast('Invitado', 'Se ha añadido al squad');
};
 
// CSS injection removed. Styles moved to css/premium-v7.css

window.selectUserForNew = (uid) => {
    const extra = window.psMatchContext.extra; 
    window._initialJugadores[extra.idx] = uid;
    
    let u = window.psUsersCache.find(x => x.id === uid);
    if (!u && uid.startsWith('GUEST_')) {
         const parts = uid.split('_');
         u = { nombreUsuario: parts[1] + ' (Inv)', nivel: parseFloat(parts[2]), fotoPerfil: './imagenes/Logojafs.png' };
    }
    
    const slot = document.getElementById(`slot-${extra.idx}-wrap`);
    if(slot && u) {
        const isTeamA = extra.idx < 2;
        const color = isTeamA ? 'var(--primary)' : 'var(--secondary)';
        
        slot.className = "p-slot-v7 pointer";
        slot.onclick = null; 
        slot.innerHTML = `
            <div class="p-img-box" style="border-color:${color}">
                <img src="${u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png'}">
            </div>
            <span class="p-badge" style="color:${color}; border-color:currentColor">${(Number(u.nivel)||2.5).toFixed(1)}</span>
            <span class="text-[9px] font-black uppercase tracking-widest mt-1 truncate w-16 text-center" style="color:${color}">${u.nombreUsuario || u.nombre || 'Jugador'}</span>
            <button class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex center text-white text-[8px] shadow-lg z-10 hover:scale-110 transition-transform" onclick="event.stopPropagation(); window.removeUserFromNew(${extra.idx})"><i class="fas fa-times"></i></button>
        `;
    }
};

window.handleCreationSlotClick = (idx) => {
    if (!Array.isArray(window._initialJugadores)) {
        window._initialJugadores = [auth.currentUser?.uid || null, null, null, null];
    }
    if (window._initialJugadores[idx]) {
        window.removeUserFromNew(idx);
        return;
    }
    const meUid = auth.currentUser?.uid;
    // If user is not already in formation, fill this slot directly.
    if (meUid && !window._initialJugadores.includes(meUid)) {
        window.selectUserForNew(meUid);
        showToast("Alineación", "Te has añadido automáticamente al hueco seleccionado", "success");
        return;
    }
    // Otherwise open selector only when needed (admin/organizer style flow).
    window.openPlayerSelector('NEW', window._creationType || 'amistoso', { idx });
};

window.removeUserFromNew = (idx) => {
    window._initialJugadores[idx] = null;
    const slot = document.getElementById(`slot-${idx}-wrap`);
    if(slot) {
        slot.className = "p-slot-v7";
        slot.innerHTML = `<div class="p-img-box empty"><i class="fas fa-plus text-muted"></i></div>`;
        slot.onclick = () => window.handleCreationSlotClick(idx);
    }
};
