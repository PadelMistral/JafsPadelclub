/* =====================================================
   PADELUMINATIS CALENDAR ENGINE V7.0
   Mistral-Inspired Modern Matrix Logic.
   ===================================================== */

import { db, auth, subscribeDoc, subscribeCol, updateDocument, getDocument } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where, addDoc, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast, countUp } from './ui-core.js';
import { renderMatchDetail, renderCreationForm } from './match-service.js';
import { isExpiredOpenMatch, isFinishedMatch, isCancelledMatch, getMatchPlayers, getMatchTeamPlayerIds, parseGuestMeta, buildBaseMatchPayload, toDateSafe as toDateSafeBase, getResultSetsString } from "./utils/match-utils.js";
import { observeCoreSession } from "./core/core-engine.js";
import { getFriendlyTeamName, isUnknownTeamName, normalizeTeamToken } from "./utils/team-utils.js";

// Shim de fecha segura por si alguna carga pierde la exportación
const toDateSafe = (value) => {
    try {
        if (typeof toDateSafeBase === "function") return toDateSafeBase(value);
    } catch (_) {}
    if (!value) return null;
    if (typeof value?.toDate === "function") {
        const d = value.toDate();
        return Number.isNaN(d?.getTime?.()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

let currentUser = null;
let userData = null;
let currentWeekOffset = 0;
let allMatches = [];
let weeklyWeather = null;
const calendarUserNameCache = new Map();
let slotInteractionBusy = false;
let calendarMatchUnsubs = [];
let calendarBootUid = null;
let apoingEvents = [];
let apoingSlotMap = new Map();
let apoingLastSyncAt = 0;
let apoingNextRetryAt = 0;
let apoingMyFutureCountLast = null;
const APOING_DEBUG = true;

function isKnockoutPhaseMatch(match = {}) {
    const phase = String(match.phase || "").toLowerCase();
    return ["knockout", "semi", "semis", "semifinal", "final", "cuartos", "quarter"].includes(phase);
}

function isGroupPhaseMatch(match = {}, ev = null) {
    const phase = String(match.phase || "").toLowerCase();
    if (["group", "liga", "league", "grupos"].includes(phase)) return true;
    if (!phase && (ev?.formato === "groups" || ev?.formato === "league")) return true;
    return false;
}

function getEventUserNameMap() {
    if (!window.__eventUserNameMap) window.__eventUserNameMap = new Map();
    return window.__eventUserNameMap;
}

function indexEventUserNames(eventDoc) {
    if (!eventDoc) return;
    const map = getEventUserNameMap();
    const inscritos = Array.isArray(eventDoc.inscritos) ? eventDoc.inscritos : [];
    inscritos.forEach((i) => {
        const uid = i?.uid;
        const name = i?.nombre || i?.nombreUsuario;
        if (uid && name) map.set(String(uid), String(name));
    });
    const teams = Array.isArray(eventDoc.teams) ? eventDoc.teams : [];
    teams.forEach((t) => {
        const players = Array.isArray(t?.players) ? t.players : [];
        players.forEach((p) => {
            const uid = p?.uid || p?.id;
            const name = p?.nombre || p?.nombreUsuario;
            if (uid && name) map.set(String(uid), String(name));
        });
    });
}

function apoingLog(step, data = null) {
    if (!APOING_DEBUG) return;
    try {
        if (data === null || data === undefined) console.log(`[Apoing][${step}]`);
        else console.log(`[Apoing][${step}]`, data);
    } catch (_) {}
}

const DEFAULT_APOING_ICS_URL = ""; // Empty by default now to avoid confusion
const APOING_PROXY_URL = "https://europe-west1-padeluminatis.cloudfunctions.net/getApoingICS?url=";
const APOING_PROXY_3 = "https://r.jina.ai/http://";
const APOING_SYNC_TTL_MS = 120000;
const CALENDAR_CACHE_KEY = "calendar:matches:v1";
const APOING_CACHE_KEY = "calendar:apoing:v1";
const PROPOSAL_DRAFT_KEY = "proposal:draft:v1";

function toDateSafeLocal(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") {
        const d = value.toDate();
        return Number.isNaN(d?.getTime?.()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function buildEventSlotKey(match) {
    const eventId = String(match?.eventoId || match?.eventId || match?.eventLink?.eventoId || "");
    if (!eventId) return null;
    const d = toDateSafeLocal(match?.fecha);
    if (!d) return null;
    const when = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    const court = String(match?.courtType || match?.pista || match?.court || "unknown").toLowerCase();
    return `${eventId}|${court}|${when}`;
}

function getRealPlayerCount(match) {
    const players = getMatchPlayers(match).filter(Boolean);
    return players.filter((p) => !String(p).startsWith("GUEST_")).length;
}



function isTbdMatch(match) {
    const noPlayers = getRealPlayerCount(match) === 0;
    const hasTeamIds = Boolean(match?.teamAId || match?.teamBId);
    if (hasTeamIds) return false;
    const isTbd =
        isUnknownTeamName(match?.teamAName || match?.equipoA) &&
        isUnknownTeamName(match?.teamBName || match?.equipoB);
    return noPlayers && isTbd;
}

function pickBestMatch(a, b) {
    const aCount = getRealPlayerCount(a);
    const bCount = getRealPlayerCount(b);
    if (aCount !== bCount) return aCount > bCount ? a : b;

    const aIsEvent = String(a?.col || "") === "eventoPartidos";
    const bIsEvent = String(b?.col || "") === "eventoPartidos";
    if (aIsEvent !== bIsEvent) return aIsEvent ? b : a;

    const aTbd = isTbdMatch(a);
    const bTbd = isTbdMatch(b);
    if (aTbd !== bTbd) return aTbd ? b : a;

    const aPlayed = Boolean(getResultSetsString(a)) || String(a?.estado || "").toLowerCase() === "jugado";
    const bPlayed = Boolean(getResultSetsString(b)) || String(b?.estado || "").toLowerCase() === "jugado";
    if (aPlayed !== bPlayed) return aPlayed ? a : b;

    return a;
}

function isMatchVisibleForUser(match, uid) {
    if (!match) return false;
    if (String(match?.col || "") === "eventoPartidos") return true;
    if (String(match?.visibility || "public") !== "private") return true;
    if (!uid) return false;
    const players = getMatchPlayers(match);
    return (
        match.organizerId === uid ||
        match.creador === uid ||
        players.includes(uid) ||
        (Array.isArray(match.invitedUsers) && match.invitedUsers.includes(uid))
    );
}

function scoreSlotMatch(match, uid) {
    let score = 0;
    if (!match) return score;
    const players = getMatchPlayers(match);
    if (uid && players.includes(uid)) score += 60;
    if (uid && (match.organizerId === uid || match.creador === uid)) score += 45;
    if (String(match?.visibility || "public") !== "private") score += 20;
    if (isMatchVisibleForUser(match, uid)) score += 15;
    if (String(match?.col || "") === "eventoPartidos") score += 10;
    if (isFinishedMatch(match)) score += 8;
    if (players.filter(Boolean).length === 4) score += 4;
    if (match?.linkedMatchId) score -= 12;
    return score;
}

function selectBestSlotMatch(matches = [], uid = null) {
    if (!Array.isArray(matches) || !matches.length) return null;
    return [...matches].sort((a, b) => scoreSlotMatch(b, uid) - scoreSlotMatch(a, uid))[0] || null;
}

function dedupeEventSlots(list = []) {
    const map = new Map();
    list.forEach((m) => {
        const key = buildEventSlotKey(m);
        if (!key) {
            const fallbackKey = `${m?.col || ""}:${m?.id || ""}`;
            map.set(fallbackKey, m);
            return;
        }
        if (!map.has(key)) {
            map.set(key, m);
            return;
        }
        const prev = map.get(key);
        map.set(key, pickBestMatch(prev, m));
    });
    return Array.from(map.values());
}

function normalizeMatchForCache(match) {
    const d = toDateSafeLocal(match?.fecha);
    return {
        ...match,
        fecha: d ? d.toISOString() : match?.fecha || null,
    };
}

function normalizeApoingEventForCache(ev) {
    return {
        ...ev,
        dtStart: ev?.dtStart instanceof Date ? ev.dtStart.toISOString() : ev?.dtStart || null,
        dtEnd: ev?.dtEnd instanceof Date ? ev.dtEnd.toISOString() : ev?.dtEnd || null,
    };
}

function hydrateApoingEvent(ev) {
    const start = ev?.dtStart ? new Date(ev.dtStart) : null;
    const end = ev?.dtEnd ? new Date(ev.dtEnd) : null;
    if (!start || Number.isNaN(start.getTime())) return null;
    if (!end || Number.isNaN(end.getTime())) return null;
    return { ...ev, dtStart: start, dtEnd: end };
}

function saveCalendarCache() {
    try {
        const payload = {
            updatedAt: Date.now(),
            matches: Array.isArray(allMatches) ? allMatches.map(normalizeMatchForCache) : [],
        };
        localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(payload));
        const apoingPayload = {
            updatedAt: Date.now(),
            events: Array.isArray(apoingEvents) ? apoingEvents.map(normalizeApoingEventForCache) : [],
        };
        localStorage.setItem(APOING_CACHE_KEY, JSON.stringify(apoingPayload));
    } catch {}
}

function loadCalendarCache() {
    try {
        const raw = localStorage.getItem(CALENDAR_CACHE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data?.matches)) allMatches = data.matches;
        }
        const rawA = localStorage.getItem(APOING_CACHE_KEY);
        if (rawA) {
            const dataA = JSON.parse(rawA);
            if (Array.isArray(dataA?.events)) {
                apoingEvents = dataA.events.map(hydrateApoingEvent).filter(Boolean);
                indexApoingEvents(apoingEvents);
            }
        }
        return Array.isArray(allMatches) && allMatches.length > 0;
    } catch {
        return false;
    }
}

function applyCalendarCache() {
    if (!loadCalendarCache()) return false;
    renderGrid();
    return true;
}

async function autoCancelExpiredMatches(matches = []) {
    const stale = matches.filter((m) => isExpiredOpenMatch(m));
    if (!stale.length) return;
    await Promise.all(
        stale.map(async (m) => {
            try {
                await updateDocument(m.col, m.id, {
                    estado: "anulado",
                    cancelReason: "auto_expired",
                    autoCancelledAt: serverTimestamp(),
                });
            } catch (_) {}
        }),
    );
}

function withTimeout(promise, ms = 12000) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('slot-render-timeout')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

async function hydrateCreatorNames() {
    const ids = [
        ...new Set(
            allMatches
                .map((m) => m?.organizerId || m?.creador)
                .filter(Boolean)
        ),
    ];

    const missing = ids.filter((id) => !calendarUserNameCache.has(id));
    await Promise.all(
        missing.map(async (uid) => {
            const u = await getDocument("usuarios", uid);
            const name = u?.nombreUsuario || u?.nombre || "Jugador";
            calendarUserNameCache.set(uid, name);
        })
    );

    allMatches = allMatches.map((m) => {
        const ownerId = m?.organizerId || m?.creador;
        return {
            ...m,
            creatorName: ownerId ? calendarUserNameCache.get(ownerId) || "Jugador" : "Jugador",
        };
    });
}

async function fetchWeeklyWeather() {
    try {
        const { getDetailedWeather } = await import('./external-data.js');
        weeklyWeather = await getDetailedWeather();
    } catch (e) { console.error("Weather error:", e); }
}

const HOURS = [
    { start: "08:00", end: "09:30" },
    { start: "09:30", end: "11:00" },
    { start: "11:00", end: "12:30" },
    { start: "12:30", end: "14:00" }, 
    { start: "14:30", end: "16:00" },
    { start: "16:00", end: "17:30" },
    { start: "17:30", end: "19:00" },
    { start: "19:00", end: "20:30" },
    { start: "20:30", end: "22:00" }
];

function updateApoingSyncBadge(text, tone = "") {
    const badge = document.getElementById("apoing-sync-state");
    if (!badge) return;
    badge.textContent = text;
    badge.classList.remove("ok", "warn", "err");
    if (tone) badge.classList.add(tone);
    
    // Also update the full info box if we have events
    updateUpcomingApoingBox();
}

function updateUpcomingApoingBox() {
    const container = document.getElementById("apoing-info-container");
    if (!container) return;

    const now = new Date();
    const myFuture = apoingEvents
        .filter(e => e.dtStart >= now)
        .filter(e => isApoingMine(e))
        .sort((a,b) => a.dtStart - b.dtStart);
    const myCount = myFuture.length;
    const myNext = myFuture[0] || null;

    if (!myCount || !myNext) {
        container.innerHTML = `
            <div class="apoing-chip" onclick="window.showApoingGuide()">
                <span id="apoing-sync-state" class="apoing-sync-state">Reservas de Apoing: 0 · Pulsa para ver días</span>
                <i class="fas fa-chevron-right ml-2 opacity-50"></i>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="apoing-chip" onclick="window.showApoingGuide()">
                <span id="apoing-sync-state" class="apoing-sync-state">Tienes ${myCount} reserva${myCount > 1 ? 's' : ''} de Apoing · Pulsa para ver los días</span>
                <i class="fas fa-chevron-right ml-2 opacity-50"></i>
            </div>
        `;
    }
}

function getApoingIcsUrl() {
    const byUser = String(userData?.apoingCalendarUrl || "").trim();
    const byStorage = String(localStorage.getItem(getApoingStorageKey(currentUser?.uid)) || "").trim();
    return byUser || byStorage || DEFAULT_APOING_ICS_URL;
}

function getApoingStorageKey(uid) {
    return `apoingCalendarUrl:${uid || "anon"}`;
}

function isClubSocialEvent(ev = {}) {
    const txt = normalizeName(`${ev.summary || ""} ${ev.description || ""}`);
    return txt.includes("club social") || txt.includes("club mistral homes") || txt.includes("mistral homes club");
}

function isPadelMistralEvent(ev = {}) {
    const txt = normalizeName(`${ev.summary || ""} ${ev.description || ""}`);
    return txt.includes("padel mistral homes") || txt.includes("padel") || txt.includes("pista") || txt.includes("reserva");
}

function isRelevantApoingEvent(ev = {}) {
    const txt = normalizeName(`${ev.summary || ""} ${ev.description || ""}`);
    const looksPadel = isPadelMistralEvent(ev) || txt.includes("partido") || txt.includes("court");
    if (isClubSocialEvent(ev)) return false;
    if (txt.includes("club") && !txt.includes("padel")) return false;
    return looksPadel;
}

function readProposalDraft() {
    try {
        const raw = localStorage.getItem(PROPOSAL_DRAFT_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.players)) return null;
        return data;
    } catch {
        return null;
    }
}

function clearProposalDraft() {
    try { localStorage.removeItem(PROPOSAL_DRAFT_KEY); } catch {}
}

async function closeProposalDraft(proposalId) {
    if (!proposalId) return;
    try {
        const chatSnap = await getDocs(collection(db, "propuestasPartido", proposalId, "chat"));
        await Promise.all(chatSnap.docs.map((d) => deleteDoc(d.ref)));
        await deleteDoc(doc(db, "propuestasPartido", proposalId));
    } catch (e) {
        console.warn("[Proposal] close failed", e);
    }
}

async function createMatchFromProposalDraft(draft, slotDate) {
    const safeDate = slotDate instanceof Date ? slotDate : new Date(slotDate);
    const players = Array.isArray(draft.players) ? draft.players : [];
    const surface = draft.surface || "indoor";
    const courtType = draft.courtType || "normal";
    const invitedUsers = Array.isArray(draft.invitedUsers) ? draft.invitedUsers : [];
    const creatorId = currentUser?.uid || draft.createdBy || null;
    const organizerId = draft.createdBy || currentUser?.uid || null;
    if (!creatorId) throw new Error("missing-user");
    if (players.filter(Boolean).length < 2) throw new Error("missing-players");

    await addDoc(collection(db, "partidosAmistosos"), buildBaseMatchPayload({
        creatorId,
        organizerId,
        matchDate: safeDate,
        players,
        minLevel: 1.0,
        maxLevel: 7.0,
        visibility: "private",
        invitedUsers,
        state: "abierto",
        surface,
        courtType,
        extra: {
            proposalId: draft.proposalId || null,
            createdAt: serverTimestamp(),
            timestamp: serverTimestamp(),
        }
    }));

    if (draft.proposalId) await closeProposalDraft(draft.proposalId);
    clearProposalDraft();
}

async function getApoingSources() {
    const sources = [];
    const pushUnique = (row) => {
        const uid = String(row?.uid || "").trim();
        const icsUrl = String(row?.icsUrl || "").trim();
        if (!uid || !icsUrl) return;
        if (!/^https:\/\/www\.apoing\.com\/calendars\/.+\.ics$/i.test(icsUrl)) return;
        if (sources.some((s) => s.uid === uid)) return;
        sources.push({
            uid,
            name: row?.name || "Jugador",
            email: row?.email || "",
            icsUrl,
        });
        apoingLog("source.added", { uid, name: row?.name || "Jugador", icsPreview: `${icsUrl.slice(0, 45)}...` });
    };

    try {
        const publicSnap = await getDocs(collection(db, "apoingCalendars"));
        publicSnap.forEach((d) => {
            const data = d.data() || {};
            if (data.active === false) return;
            pushUnique({
                uid: d.id,
                name: data.nombre || data.nombreUsuario || "Jugador",
                email: data.email || "",
                icsUrl: data.icsUrl || "",
            });
        });
    } catch (_) {}

    try {
        const usersSnap = await getDocs(collection(db, "usuarios"));
        usersSnap.forEach((d) => {
            const data = d.data() || {};
            const url = data.apoingCalendarUrl || data.icsUrl || "";
            if (!url) return;
            pushUnique({
                uid: d.id,
                name: data.nombreUsuario || data.nombre || "Jugador",
                email: data.email || "",
                icsUrl: url,
            });
        });
    } catch (_) {}

    const myUrl = getApoingIcsUrl();
    const hasMe = currentUser?.uid && sources.some((s) => s.uid === currentUser.uid);
    if (currentUser?.uid && myUrl && !hasMe) {
        pushUnique({
            uid: currentUser.uid,
            name: userData?.nombreUsuario || userData?.nombre || "Tú",
            email: currentUser.email || "",
            icsUrl: myUrl,
        });
    }
    apoingLog("sources.ready", {
        total: sources.length,
        uids: sources.map((s) => s.uid),
    });
    return sources;
}

async function ensureMyApoingSourceSync() {
    if (!currentUser?.uid) return;
    const myUrl = getApoingIcsUrl();
    if (!myUrl) return;
    if (!/^https:\/\/www\.apoing\.com\/calendars\/.+\.ics$/i.test(String(myUrl).trim())) return;
    try {
        await setDoc(doc(db, "apoingCalendars", currentUser.uid), {
            uid: currentUser.uid,
            nombre: userData?.nombreUsuario || userData?.nombre || currentUser.email || "Jugador",
            email: currentUser.email || "",
            icsUrl: String(myUrl).trim(),
            active: true,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        apoingLog("source.sync.self.ok", { uid: currentUser.uid });
    } catch (_) {}
}

function unfoldIcsLines(raw = "") {
    const lines = String(raw || "").split(/\r?\n/);
    const unfolded = [];
    for (const line of lines) {
        if (!line) continue;
        if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length) {
            unfolded[unfolded.length - 1] += line.trim();
        } else {
            unfolded.push(line.trim());
        }
    }
    return unfolded;
}

function parseIcsDate(value = "") {
    const v = String(value || "").trim().toUpperCase();
    const dOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dOnly) {
        const [, y, mo, d] = dOnly;
        return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
    }
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s = "00", isZulu] = m;
    if (isZulu === "Z") return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function decodeIcsText(text = "") {
    return String(text || "")
        .replaceAll("\\n", "\n")
        .replaceAll("\\,", ",")
        .replaceAll("\\;", ";")
        .replaceAll("\\\\", "\\");
}

function parseIcsEvents(icsText = "") {
    const lines = unfoldIcsLines(icsText);
    const out = [];
    let current = null;
    for (const line of lines) {
        if (line === "BEGIN:VEVENT") {
            current = {};
            continue;
        }
        if (line === "END:VEVENT") {
            if (current?.dtStart && current?.dtEnd) out.push(current);
            current = null;
            continue;
        }
        if (!current) continue;
        const split = line.indexOf(":");
        if (split <= 0) continue;
        const rawKey = line.slice(0, split).trim();
        const value = decodeIcsText(line.slice(split + 1).trim());
        const key = rawKey.split(";")[0].toUpperCase();
        if (key === "UID") current.uid = value;
        if (key === "SUMMARY") current.summary = value;
        if (key === "DESCRIPTION") current.description = value;
        if (key === "URL") current.url = value;
        if (key === "RRULE") current.rrule = value;
        if (key === "DTSTART") current.dtStart = parseIcsDate(value);
        if (key === "DTEND") current.dtEnd = parseIcsDate(value);
    }
    return out.filter((e) => e.dtStart instanceof Date && e.dtEnd instanceof Date);
}

function parseRRule(raw = "") {
    const rule = {};
    String(raw || "").split(";").forEach((pair) => {
        const [k, v] = pair.split("=");
        if (!k || !v) return;
        rule[String(k).toUpperCase()] = String(v).toUpperCase();
    });
    return rule;
}

function weekdayTokenToJs(token = "") {
    const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    return map[String(token || "").trim().toUpperCase()];
}

function eventDurationMs(ev = {}) {
    const a = ev?.dtStart?.getTime?.() || 0;
    const b = ev?.dtEnd?.getTime?.() || 0;
    const ms = b - a;
    return ms > 0 ? ms : 90 * 60 * 1000;
}

function expandRecurringEvents(events = [], horizonDays = 150, maxOut = 2000) {
    const out = [];
    const nowTs = Date.now();
    const horizon = nowTs + horizonDays * 24 * 60 * 60 * 1000;
    
    // Safety check for empty list
    if(!events.length) return [];

    for (const ev of events) {
        out.push(ev);
        if (!ev.rrule) continue;
        const rule = parseRRule(ev.rrule);
        const freq = rule.FREQ;
        const interval = Math.max(1, Number(rule.INTERVAL || 1));
        const count = Math.max(1, Number(rule.COUNT || 0));
        const until = rule.UNTIL ? parseIcsDate(rule.UNTIL) : null;
        const byDay = String(rule.BYDAY || "")
            .split(",")
            .map((t) => weekdayTokenToJs(t))
            .filter((n) => Number.isInteger(n));
        
        if (!freq || (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY")) continue;

        let emitted = 1;
        let cursorStart = new Date(ev.dtStart);
        const durationMs = eventDurationMs(ev);
        
        // Loop limit to prevent infinite expansion
        for (let i = 0; i < 800; i++) {
            if (freq === "DAILY") {
                cursorStart = new Date(cursorStart.getTime() + interval * 24 * 60 * 60 * 1000);
            } else if (freq === "MONTHLY") {
                cursorStart = new Date(cursorStart);
                cursorStart.setMonth(cursorStart.getMonth() + interval);
            } else {
                // WEEKLY
                if (byDay.length > 0) {
                    const weekStart = new Date(cursorStart);
                    weekStart.setDate(weekStart.getDate() + interval * 7);
                    const made = [];
                    byDay.forEach((wd) => {
                        const d = new Date(weekStart);
                        const delta = wd - d.getDay();
                        d.setDate(d.getDate() + delta);
                        d.setHours(ev.dtStart.getHours(), ev.dtStart.getMinutes(), ev.dtStart.getSeconds(), 0);
                        made.push(d);
                    });
                    made.sort((a, b) => a - b).forEach((s) => {
                        const t = s.getTime();
                        if (t <= ev.dtStart.getTime()) return; // Don't duplicate original or past cursor
                        if (until && t > until.getTime()) return;
                        if (count && emitted >= count) return;
                        if (t > horizon) return;
                        out.push({ ...ev, dtStart: new Date(s), dtEnd: new Date(t + durationMs) });
                        emitted += 1;
                    });
                    cursorStart = made[made.length - 1] || weekStart;
                    if (out.length >= maxOut) return out;
                    continue;
                }
                cursorStart = new Date(cursorStart.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
            }
            
            const t = cursorStart.getTime();
            if (until && t > until.getTime()) break;
            if (count && emitted >= count) break;
            if (t > horizon) break;
            out.push({ ...ev, dtStart: new Date(cursorStart), dtEnd: new Date(t + durationMs) });
            emitted += 1;
            if (out.length >= maxOut) return out;
        }
    }
    return out;
}

function normalizeName(raw = "") {
    return String(raw || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractOwnerFromApoingEvent(ev = {}) {
    const raw = `${ev.summary || ""} ${ev.description || ""}`;
    const patterns = [
        /(?:reservad[oa]\s+por|usuario|cliente|player|jugador)\s*[:\-]\s*([^\n,(]+)/i,
        /\(([A-Za-z\u00C0-\u024F'`.\- ]{3,})\)/,
        /[-|]\s*([A-Za-z\u00C0-\u024F ]{3,})/ // Match names after a dash or bar
    ];
    for (const p of patterns) {
        const m = raw.match(p);
        if (m?.[1]) {
            const owner = m[1].trim();
            if (!/mistral|padel|club|apoing|reserva/i.test(owner)) return owner;
        }
    }
    return "";
}

function isApoingMine(ev = {}) {
    if (!currentUser) return false;
    return ev?.sourceUid === currentUser.uid;
}

function buildSlotKey(dateObj, hour) {
    if(!(dateObj instanceof Date)) dateObj = new Date(dateObj);
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}|${hour}`;
}

function overlaps(startA, endA, startB, endB) {
    return startA < endB && endA > startB;
}

function indexApoingEvents(events = []) {
    const map = new Map();
    for (const ev of events) {
        const owner = extractOwnerFromApoingEvent(ev);
        const enriched = { ...ev, owner: owner || ev.sourceName || "" };
        const baseDate = new Date(ev.dtStart);
        baseDate.setHours(0, 0, 0, 0);
        for (const hObj of HOURS) {
            const [h, mi] = hObj.start.split(":").map(Number);
            const slotStart = new Date(baseDate);
            slotStart.setHours(h, mi, 0, 0);
            const slotEnd = new Date(slotStart);
            slotEnd.setMinutes(slotEnd.getMinutes() + 90);
            if (!overlaps(ev.dtStart.getTime(), ev.dtEnd.getTime(), slotStart.getTime(), slotEnd.getTime())) continue;
            const key = buildSlotKey(slotStart, hObj.start);
            const list = map.get(key) || [];
            list.push(enriched);
            map.set(key, list);
        }
    }
    apoingSlotMap = map;
}

async function fetchApoingIcs(url, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            method: "GET",
            cache: "no-store",
            signal: ctrl.signal,
        });
        if (!resp.ok) throw new Error(`apoing_http_${resp.status}`);
        const txt = await resp.text();
        if (!String(txt || "").includes("BEGIN:VCALENDAR")) throw new Error("apoing_invalid_ics");
        apoingLog("ics.fetch.ok", { urlPreview: `${String(url).slice(0, 70)}...`, size: String(txt || "").length });
        return txt;
    } finally {
        clearTimeout(t);
    }
}

async function fetchRawApoingByUrl(url) { try { console.log("Cargando calendario Apoing..."); const jinaTarget = `${APOING_PROXY_3}${url.replace(/^https?:\/\/\//i, "")}`; const jinaResp = await fetch(jinaTarget); if (jinaResp.ok) return await jinaResp.text(); const target = `${APOING_PROXY_URL}${encodeURIComponent(url)}`; const resp = await fetch(target); if (resp.ok) return await resp.text(); throw new Error(`Apoing fetch failed: ${resp.status}`); } catch (err) { console.warn("Apoing proxy warning:", err); return ""; } }
async function syncApoingReservations(force = false) {
    const now = Date.now();
    if (!force && now < apoingNextRetryAt) return;
    if (!force && now - apoingLastSyncAt < APOING_SYNC_TTL_MS && apoingEvents.length) return;

    const sources = await getApoingSources();
    apoingLog("sync.start", { force, sourceCount: sources.length });
    if (!sources.length) {
        apoingEvents = [];
        apoingSlotMap = new Map();
        updateApoingSyncBadge("Reservas de Apoing: 0", "warn");
        apoingLog("sync.no-sources");
        return;
    }

    try {
        updateApoingSyncBadge("Sincronizando Apoing...");
        const allEvents = [];

        for (const source of sources) {
            try {
                const icsUrl = String(source.icsUrl || "").trim();
                if (!icsUrl) continue;
                apoingLog("source.sync.begin", { uid: source.uid, name: source.name, icsPreview: `${icsUrl.slice(0, 45)}...` });
                const cacheKey = `apoing_raw_cache_${icsUrl}`;
                let raw = "";

                try {
                    raw = await fetchRawApoingByUrl(icsUrl);
                    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: now, data: raw }));
                } catch (errFetch) {
                    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
                    if (cached && now - Number(cached.ts || 0) < 3600000) {
                        raw = String(cached.data || "");
                    } else {
                        throw errFetch;
                    }
                }

                const parsed = parseIcsEvents(raw).filter((e) => !Number.isNaN(e.dtStart.getTime()));
                const filtered = parsed.filter((e) => isRelevantApoingEvent(e));
                const expanded = expandRecurringEvents(filtered).map((e) => ({
                    ...e,
                    sourceUid: source.uid,
                    sourceName: source.name,
                    sourceEmail: source.email,
                }));
                apoingLog("source.sync.stats", {
                    uid: source.uid,
                    parsed: parsed.length,
                    filtered: filtered.length,
                    expanded: expanded.length,
                    first: expanded[0]
                        ? {
                            summary: expanded[0].summary || "",
                            start: expanded[0].dtStart?.toISOString?.() || "",
                            end: expanded[0].dtEnd?.toISOString?.() || "",
                        }
                        : null,
                });
                allEvents.push(...expanded);
            } catch (errSource) {
                console.warn("Apoing source sync failed", source?.uid, errSource?.message || errSource);
                apoingLog("source.sync.error", { uid: source?.uid || "", err: errSource?.message || String(errSource) });
            }
        }

        const events = allEvents.sort((a, b) => (a.dtStart?.getTime?.() || 0) - (b.dtStart?.getTime?.() || 0));
        apoingEvents = events;
        indexApoingEvents(events);
        const byUser = {};
        events.forEach((e) => {
            const uid = String(e?.sourceUid || "unknown");
            byUser[uid] = (byUser[uid] || 0) + 1;
        });
        apoingLog("sync.done", {
            totalEvents: events.length,
            byUser,
            slotKeys: apoingSlotMap.size,
        });
        apoingLastSyncAt = now;
        apoingNextRetryAt = 0;

        const myFutureCount = apoingEvents.filter((e) => isApoingMine(e) && e.dtStart >= new Date()).length;
        if (apoingMyFutureCountLast !== null && myFutureCount !== apoingMyFutureCountLast) {
            try {
                const currentUid = (typeof auth !== "undefined" && auth?.currentUser?.uid) || (typeof currentUser !== "undefined" && currentUser?.uid) || null;
                if (currentUid) {
                    const { createNotification } = await import("./services/notification-service.js");
                    const nearbyOpenMatches = findOpenMatchesNearApoingReservation(apoingEvents);
                    const nearbySummary = nearbyOpenMatches.length
                        ? ` Tienes ${nearbyOpenMatches.length} partida${nearbyOpenMatches.length > 1 ? "s" : ""} abierta${nearbyOpenMatches.length > 1 ? "s" : ""} compatible${nearbyOpenMatches.length > 1 ? "s" : ""} en ese tramo.`
                        : "";
                    if (myFutureCount > apoingMyFutureCountLast) {
                        showToast("Apoing", "Nueva reserva detectada.", "success");
                        createNotification(currentUid, "Reserva Apoing", `Nueva reserva detectada en tu calendario.${nearbySummary}`, "info", "calendario.html", { type: "apoing_new", nearbyOpenMatches: nearbyOpenMatches.map((m) => m.id) });
                    } else {
                        showToast("Apoing", "Reserva cancelada.", "warning");
                        createNotification(currentUid, "Cancelación Apoing", "Se ha eliminado una reserva de tu calendario.", "warning", "calendario.html", { type: "apoing_removed" });
                    }
                }
            } catch(e) { console.warn("Failed to notify apoing change", e); }
        }
        apoingMyFutureCountLast = myFutureCount;
        updateApoingSyncBadge(`Reservas de Apoing: ${myFutureCount} tuyas · ${events.length} total`, events.length ? "ok" : "warn");
    } catch (e) {
        console.warn("Apoing sync fallback failed:", e?.message || e);
        apoingLog("sync.error", { err: e?.message || String(e) });
        apoingEvents = [];
        apoingSlotMap = new Map();
        apoingLastSyncAt = now;
        apoingNextRetryAt = now + 3 * 60 * 1000;
        updateApoingSyncBadge("Sin datos de reservas de Apoing", "err");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('calendar');
    startClock();
    try { renderGrid(); } catch (_) {}
    
    observeCoreSession({
        onSignedOut: () => {
            calendarMatchUnsubs.forEach((unsub) => {
                try { if (typeof unsub === 'function') unsub(); } catch (_) {}
            });
            calendarMatchUnsubs = [];
            calendarBootUid = null;
            window.location.href = 'index.html';
        },
        onReady: async ({ user, userDoc }) => {
            try {
                if (calendarBootUid === user.uid) return;
                calendarBootUid = user.uid;
                currentUser = user;
                userData = userDoc || {};
                ensureMyApoingSourceSync().catch(() => {});
                handleUrlParams();
                if (navigator.onLine === false) applyCalendarCache();

                calendarMatchUnsubs.forEach((unsub) => {
                    try { if (typeof unsub === 'function') unsub(); } catch (_) {}
                });
                calendarMatchUnsubs = [];

                const unsubA = await subscribeCol('partidosAmistosos', () => syncMatches());
                const unsubR = await subscribeCol('partidosReto', () => syncMatches());
                const unsubE = await subscribeCol('eventoPartidos', () => syncMatches());
                if (typeof unsubA === 'function') calendarMatchUnsubs.push(unsubA);
                if (typeof unsubR === 'function') calendarMatchUnsubs.push(unsubR);
                if (typeof unsubE === 'function') calendarMatchUnsubs.push(unsubE);

                syncMatches(); handleUrlParams();
            } catch (e) {
                console.error('Calendar init error:', e);
                renderGrid();
            }
        },
    });

    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.onclick = () => { currentWeekOffset--; renderGrid(); };
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.onclick = () => { currentWeekOffset++; renderGrid(); };
    const apoingBadge = document.getElementById('apoing-sync-state');
    if (apoingBadge && !apoingBadge.dataset.bound) {
        apoingBadge.dataset.bound = '1';
        apoingBadge.style.cursor = 'pointer';
        apoingBadge.title = 'Pulsa para forzar sincronización con Apoing';
        apoingBadge.addEventListener('click', () => syncApoingReservations(true));
    }
});

function startClock() {
    const timeEl = document.getElementById('current-time-v5');
    const dateEl = document.getElementById('current-date-v5');
    
    const update = () => {
        const now = new Date();
        if (timeEl) timeEl.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (dateEl) {
            const options = { weekday: 'long', day: 'numeric', month: 'short' };
            dateEl.textContent = now.toLocaleDateString('es-ES', options).toUpperCase();
        }
    };
    update();
    setInterval(update, 1000);
}

function renderRecentResultsStrip() {
    const container = document.getElementById('calendar-history-strip');
    if (!container) return;
    const items = [...allMatches]
        .filter((m) => isFinishedMatch(m))
        .sort((a, b) => (toDateSafe(b.fecha)?.getTime() || 0) - (toDateSafe(a.fecha)?.getTime() || 0))
        .slice(0, 5);

    if (!items.length) {
        container.innerHTML = `<div class="calendar-history-empty">Todavia no hay resultados cerrados para mostrar.</div>`;
        return;
    }

    container.innerHTML = items.map((match) => {
        const teamA = resolveTeamDisplayName(match, 'A');
        const teamB = resolveTeamDisplayName(match, 'B');
        const score = getResultSetsString(match) || 'Sin resultado';
        const date = toDateSafe(match.fecha);
        const type = match.col === 'eventoPartidos' ? 'Evento' : match.col === 'partidosReto' ? 'Reto' : 'Amistoso';
        return `
            <article class="calendar-history-card" onclick="handleSlot('${date ? date.toISOString().slice(0,10) : ''}', '${date ? date.toTimeString().slice(0,5) : ''}', '${match.id}', '${match.col}', false)">
                <span class="calendar-history-type">${type}</span>
                <div class="calendar-history-match">${teamA} vs ${teamB}</div>
                <div class="calendar-history-score">${score}</div>
                <div class="calendar-history-meta">${date ? date.toLocaleDateString('es-ES', { day:'2-digit', month:'short' }) : 'Sin fecha'}</div>
            </article>
        `;
    }).join('');
}

async function syncMatches() {
    try {
        const [snapA, snapR, snapE, snapEv] = await Promise.all([
            window.getDocsSafe(collection(db, "partidosAmistosos")),
            window.getDocsSafe(collection(db, "partidosReto")),
            window.getDocsSafe(collection(db, "eventoPartidos")),
            window.getDocsSafe(collection(db, "eventos"))
        ]);
        
        const eventDocs = snapEv.docs.reduce((acc, d) => {
            acc[d.id] = d.data();
            return acc;
        }, {});
        Object.values(eventDocs).forEach((ev) => indexEventUserNames(ev));

        const eventMatchesRaw = snapE.docs.map((d) => ({ id: d.id, ...d.data() }));
        const eventGroupReady = {};
        const eventMatchMap = eventMatchesRaw.reduce((acc, m) => {
            const eid = m.eventoId || m.eventId;
            if (!eid) return acc;
            if (!acc[eid]) acc[eid] = [];
            acc[eid].push(m);
            return acc;
        }, {});
        Object.keys(eventMatchMap).forEach((eid) => {
            const ev = eventDocs[eid];
            const groupMatches = eventMatchMap[eid].filter((m) => isGroupPhaseMatch(m, ev));
            if (!groupMatches.length) {
                eventGroupReady[eid] = true;
                return;
            }
            eventGroupReady[eid] = groupMatches.every((m) => isFinishedMatch(m));
        });

        allMatches = [];
        snapA.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
        snapR.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', isComp: true, ...d.data() }));
        snapE.forEach(d => {
            const data = d.data();
            // FILTER: If it's already linked to a real match, don't show the event placeholder
            if (data.linkedMatchId) return;
            if (isTbdMatch(data)) return;
            if (!data.fecha) return;

            const ev = eventDocs[data.eventoId];
            if (ev) {
                // If league/group, check teams. If knockout, we might allow it (manual)
                const ready = eventGroupReady[data.eventoId];
                const pendingLocked = isKnockoutPhaseMatch(data) && ready === false;
                allMatches.push({ id: d.id, col: 'eventoPartidos', eventMatchId: d.id, pendingLocked, ...data });
            }
        });
        allMatches = dedupeEventSlots(allMatches);
        await autoCancelExpiredMatches(allMatches);

        await Promise.all([
            hydrateCreatorNames(),
            fetchWeeklyWeather(),
            syncApoingReservations(),
        ]);
        renderGrid();
        renderRecentResultsStrip();
        saveCalendarCache();
    } catch (e) {
        console.error('Calendar sync error:', e);
        const cached = applyCalendarCache();
        if (cached) showToast("Offline", "Mostrando tu horario guardado.", "warning");
        const status = document.getElementById('apoing-sync-state');
        if (status) {
            status.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error Sync';
            status.className = 'apoing-sync-state err';
            status.onclick = () => window.showApoingGuide();
        }
        allMatches = [];
        renderGrid();
        renderRecentResultsStrip();
    }
}

window.showApoingGuide = () => {
    const modal = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    const titulo = document.getElementById('modal-titulo');
    if (!modal || !area) return;

    titulo.textContent = "CONFIGURACIÓN APOING";
    const currentUrl = getApoingIcsUrl() || "";
    
    const now = new Date();
    let eventsHtml = apoingEvents.length > 0 
        ? apoingEvents
            .filter(e => e.dtStart >= now)
            .slice(0, 12)
            .map(e => `
            <button class="status-item-v7 w-full text-left" onclick="window.jumpToApoingReservation('${e.dtStart.toISOString()}')">
                <i class="fas fa-calendar-check text-sport-green"></i>
                <div class="flex-col">
                    <span class="text-[10px] font-black uppercase">${e.summary}</span>
                    <span class="text-[8px] opacity-60">${e.dtStart.toLocaleString('es-ES', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})} · ${e.sourceName || 'Usuario'}</span>
                </div>
            </button>
        `).join('')
        : '<div class="p-4 text-center opacity-40 text-[10px]">No se han detectado reservas futuras de pádel en Apoing.</div>';

    area.innerHTML = `
        <div class="flex-col gap-4 p-2">
            <div class="info-box-v7">
                <i class="fas fa-info-circle"></i>
                <p class="text-[11px] font-medium leading-relaxed">JafsPadel sincroniza tus reservas directamente desde Apoing. Necesitas tu enlace <b>.ics</b> personal.</p>
            </div>
            
            <div class="config-section-v7">
                <label class="cfg-label-v7">TU ENLACE ICS PERSONAL</label>
                <div class="flex-row gap-2">
                    <input type="text" id="inp-apoing-url" value="${currentUrl}" placeholder="https://www.apoing.com/calendars/..." class="input" style="font-size: 10px;">
                    <button class="btn-confirm-v7" onclick="window.saveApoingUrl()" style="min-width: 80px; padding: 0 10px;">GUARDAR</button>
                </div>
                <p class="text-[8px] mt-2 opacity-50 uppercase font-black">Consigue tu enlace en: Perfil -> Sincronización -> Calendario celular</p>
            </div>

            <div class="status-section-v7">
                <label class="cfg-label-v7">ESTADO DE SINCRONIZACIÓN
                <div class="status-list-v7">
                    <div class="status-item-v7">
                        <i class="fas ${apoingEvents.length > 0 ? 'fa-check-circle text-sport-green' : 'fa-circle-notch fa-spin opacity-40'}"></i>
                        <span>Reservas de pádel detectadas: <b>${apoingEvents.length}</b></span>
                    </div>
                    <div class="status-item-v7">
                        <i class="fas fa-link ${currentUrl ? 'text-primary' : 'text-sport-red'}"></i>
                        <span>URL configurada: <b>${currentUrl ? 'SÍ' : 'NO'}</b></span>
                    </div>
                    ${eventsHtml}
                </div>
            </div>

            <button class="btn-mini wide" onclick="window.location.reload()"><i class="fas fa-rotate"></i> REFORZAR SINCRONIZACIÓN
        </div>
    `;

    modal.classList.add('active');
};

window.saveApoingUrl = async () => {
    const url = document.getElementById('inp-apoing-url')?.value.trim();
    if (!url) return;
    
    // Save locally scoped by user to avoid cross-account leaks
    if (currentUser?.uid) {
        localStorage.setItem(getApoingStorageKey(currentUser.uid), url);
    }
    
    // Save to Firebase profile if possible
    if (currentUser?.uid) {
        try {
            await updateDocument('usuarios', currentUser.uid, {
                apoingCalendarUrl: url
            });
            await setDoc(doc(db, "apoingCalendars", currentUser.uid), {
                uid: currentUser.uid,
                nombre: userData?.nombreUsuario || userData?.nombre || currentUser.email || "Jugador",
                email: currentUser.email || "",
                icsUrl: url,
                active: true,
                updatedAt: serverTimestamp(),
            }, { merge: true });
        } catch(e) { console.warn("Failed to save URL to profile", e); }
    }
    
    document.getElementById('modal-match').classList.remove('active');
    showToast("Apoing", "Enlace de calendario actualizado.", "success");
    syncApoingReservations(true); // Force sync after saving
};

window.jumpToApoingReservation = (isoDate) => {
    const target = new Date(isoDate);
    if (Number.isNaN(target.getTime())) return;

    const monday = new Date();
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);

    const targetMonday = new Date(target);
    const tDay = targetMonday.getDay() || 7;
    targetMonday.setDate(targetMonday.getDate() - tDay + 1);
    targetMonday.setHours(0, 0, 0, 0);

    currentWeekOffset = Math.round((targetMonday.getTime() - monday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    renderGrid();

    const dStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
    const slotHour = HOURS.find((h) => {
        const [hh, mm] = h.start.split(":").map(Number);
        const slotStart = new Date(target);
        slotStart.setHours(hh, mm, 0, 0);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 90);
        return target >= slotStart && target < slotEnd;
    })?.start || HOURS[0].start;

    setTimeout(() => {
        const slot = document.querySelector(`.slot-v5[onclick*="${dStr}"][onclick*="${slotHour}"]`);
        slot?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        if (slot) {
            slot.classList.add("ring-2");
            setTimeout(() => slot.classList.remove("ring-2"), 1200);
        }
    }, 120);

    document.getElementById("modal-match")?.classList.remove("active");
};

window.debugCalendarState = () => {
    console.log("=== CALENDAR DEBUG ===");
    console.log("UID:", currentUser?.uid);
    console.log("Matches cargados:", allMatches.length);
    console.log("Eventos Apoing:", apoingEvents.length);
    console.log("Apoing Slot Map Size:", apoingSlotMap.size);
    console.log("Configured Apoing URL:", getApoingIcsUrl());
    console.log("Sample Slot Keys (primero 5):", Array.from(apoingSlotMap.keys()).slice(0,5));
};

function renderGrid() {
    const container = document.getElementById('calendar-grid-v5');
    if (!container) return;

    const today = new Date();
    const startOfWeek = new Date(today);
    const day = today.getDay() || 7; 
    startOfWeek.setDate(today.getDate() - day + 1 + (currentWeekOffset * 7));
    startOfWeek.setHours(0,0,0,0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    if (apoingEvents.length) {
        const myFutureCount = apoingEvents.filter((e) => isApoingMine(e) && e.dtStart >= new Date()).length;
        updateApoingSyncBadge(`Reservas de Apoing: ${myFutureCount} tuyas · ${apoingEvents.length} total`, apoingEvents.length ? "ok" : "warn");
    } else {
        const icsUrl = getApoingIcsUrl();
        if (icsUrl) {
            updateApoingSyncBadge("Reservas de Apoing: 0", "warn");
        } else {
            updateApoingSyncBadge("Apoing no configurado", "warn");
        }
    }

    // Update labels
    const weekLabel = document.getElementById('week-range-text');
    const monthLabel = document.getElementById('month-year-text');
    if (weekLabel) weekLabel.textContent = `${startOfWeek.getDate()} - ${endOfWeek.getDate()}`;
    if (monthLabel) monthLabel.textContent = `${startOfWeek.toLocaleDateString('es-ES', {month: 'long', year: 'numeric'})}`.toUpperCase();

    let html = `
        <div class="grid-header-v5">
            <div class="corner-header-v5">GMT</div>
            ${Array.from({length: 7}).map((_, i) => {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                const isToday = d.toDateString() === new Date().toDateString();
                return `
                    <div class="day-header-v5 ${isToday ? 'today' : ''}">
                        <span class="d-name">${d.toLocaleDateString('es-ES', { weekday: 'short' }).substring(0,3)}</span>
                        <span class="d-num">${d.getDate()}</span>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="grid-body-v5">
    `;

    HOURS.forEach((hObj, idx) => {
        html += `<div class="time-row-v5">
            <div class="time-col-v5">
                <span class="t-start">${hObj.start}</span>
                <span class="t-end">${hObj.end}</span>
            </div>
            ${Array.from({length: 7}).map((_, i) => {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                return renderSlot(d, hObj.start);
            }).join('')}
        </div>`;
        if (hObj.start === '12:30') html += `<div class="break-v5">DESCANSO</div>`;
    });

    container.innerHTML = html + `</div>`;
    focusToday();
}

function renderSlot(date, hour) {
    try {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const dStr = `${year}-${month}-${day}`;

        const [h, min] = hour.split(':').map(Number);
        const slotTime = new Date(date);
        slotTime.setHours(h, min, 0, 0);
        const slotEnd = new Date(slotTime);
        slotEnd.setMinutes(slotEnd.getMinutes() + 90);
        const slotKey = buildSlotKey(slotTime, hour);
        const apoingForSlot = (apoingSlotMap.get(slotKey) || []).sort((a, b) => a.dtStart - b.dtStart);
        const apoingEvent = apoingForSlot[0] || null;

        const matchesInSlot = allMatches.filter(m => {
            try {
                const mDate = m.fecha?.toDate ? m.fecha.toDate() : (m.fecha ? new Date(m.fecha) : null);
                if (!mDate || Number.isNaN(mDate.getTime())) return false;
                const mYear = mDate.getFullYear();
                const mMonth = (mDate.getMonth() + 1).toString().padStart(2, '0');
                const mDay = mDate.getDate().toString().padStart(2, '0');
                const mDStr = `${mYear}-${mMonth}-${mDay}`;
                if (mDStr !== dStr) return false;
                const mTime = mDate.getTime();
                return mTime >= slotTime.getTime() && mTime < slotEnd.getTime();
            } catch(e) { return false; }
        });
        const match = selectBestSlotMatch(matchesInSlot, currentUser?.uid || null);
        
        const isPast = slotEnd < new Date();
        let state = 'libre';

        let label = 'PISTA LIBRE';
        let sub = '';
        let ownerSub = '';
        let extraIcon = '';
        let isLocked = false;

        if (match) {
            if (match.col === 'eventoPartidos') {
                if (match.pendingLocked) {
                    state = 'cerrada';
                    label = 'BRACKET PENDIENTE';
                    sub = 'Esperando fase de grupos';
                    ownerSub = `EVENTO: ${resolveTeamDisplayName(match, 'A')} VS ${resolveTeamDisplayName(match, 'B')}`;
                    extraIcon = '<i class="fas fa-lock text-white/50 absolute top-2 right-2 text-xs"></i>';
                    isLocked = true;
                } else {
                const isMineEvent = !!currentUser && (match.playerUids || []).includes(currentUser.uid);
                const isPlayedEvent = String(match.estado || '').toLowerCase() === 'jugado';
                state = isPlayedEvent ? 'jugado' : (isMineEvent ? 'propia' : 'cerrada');
                label = isPlayedEvent ? 'EVENTO JUGADO' : 'PARTIDO EVENTO';
                const resLabel = getResultSetsString(match) || 'VER RES';
                sub = isPlayedEvent ? resLabel : (match.phase ? String(match.phase).toUpperCase() : 'TORNEO');
                ownerSub = `EVENTO: ${resolveTeamDisplayName(match, 'A')} VS ${resolveTeamDisplayName(match, 'B')}`;
                }
            } else {
            // Private Match Check
            if (match.visibility === 'private' && currentUser) {
                const uid = currentUser.uid;
                const matchPlayers = getMatchPlayers(match);
                if (match.organizerId !== uid && match.creador !== uid && !(match.invitedUsers || []).includes(uid) && !matchPlayers.includes(uid)) {
                    state = 'bloqueado';
                    label = 'PRIVADA';
                    sub = 'RESERVADO';
                    extraIcon = '<i class="fas fa-lock text-white/50 absolute top-2 right-2 text-xs"></i>';
                    isLocked = true;
                }
            }

            if (!isLocked) {
                const matchPlayers = getMatchPlayers(match);
                const isMine = !!currentUser && matchPlayers.includes(currentUser.uid);
                const count = matchPlayers.filter(id => id).length;
                const isFull = count >= 4;
                const isPlayed = isFinishedMatch(match);
                const isClosed = isCancelledMatch(match) || isExpiredOpenMatch(match);
                
                if (isClosed) {
                    state = 'cerrada';
                    label = 'CERRADO';
                    sub = 'EXPIRADO';
                    ownerSub = `REF: ${match.id.substring(0,5).toUpperCase()}`;
                } else if (isPlayed) {
                    state = 'jugado';
                    label = match.eventMatchId ? 'EVENTO FINALIZADO' : 'PARTIDO FINALIZADO';
                    sub = getResultSetsString(match) || 'VER SCORE';
                    if (isMine) {
                        const hasDiary = userData?.diario?.some(e => e.matchId === match.id);
                        if (!hasDiary) {
                            label = 'PENDIENTE DIARIO';
                            extraIcon = '<i class="fas fa-exclamation-triangle pulse-warning absolute top-1 right-1 text-[10px] text-yellow-400"></i>';
                        } else {
                            label = match.eventMatchId ? 'EVENTO FINAL' : 'COMPLETADO';
                        }
                    }
                } else {
                    if (isMine) {
                        state = 'propia';
                        label = match.eventMatchId ? 'TU PARTIDO DE EVENTO' : 'TU PARTIDO';
                        sub = 'LISTO PARA JUGAR';
                        ownerSub = `ORGANIZA: ${shortName(match.creatorName || "Tú")}`;
                    }
                    else if (isFull) {
                        state = 'cerrada';
                        label = match.eventMatchId ? 'EVENTO LLENO' : 'COMPLETO';
                        sub = 'SIN PLAZAS';
                        ownerSub = `ORGANIZA: ${shortName(match.creatorName)}`;
                    }
                    else {
                        const plazas = 4-count;
                        state = 'abierta';
                        label = match.eventMatchId ? 'UNIRSE A EVENTO' : 'PARTIDO ABIERTO';
                        sub = `${plazas} ${plazas === 1 ? 'PLAZA' : 'PLAZAS'}`;
                        ownerSub = `ORGANIZA: ${shortName(match.creatorName)}`;
                    }
                }

                if (!ownerSub && match.creatorName) {
                    ownerSub = `ORGANIZA: ${shortName(match.creatorName)}`;
                }
            }
            }
        } else if (apoingEvent) {
            const mine = isApoingMine(apoingEvent);
            const totalSlotReservations = apoingForSlot.length;
            const isClubSocial = isClubSocialEvent(apoingEvent);

            state = mine ? "apoing-mine" : "apoing-other";
            
            const ownerName = shortName(apoingEvent.sourceName || apoingEvent.owner || (mine ? userData?.nombreUsuario || "Tú" : "Jugador"));

            if (isClubSocial) {
                label = "CLUB SOCIAL";
                sub = mine ? "TU RESERVA CLUB" : "OCUPADO (CLUB)";
                ownerSub = ownerName;
            } else {
                label = mine ? "MI RESERVA" : "OCUPADA";
                sub = mine
                    ? (totalSlotReservations > 1 ? `MÍA + ${totalSlotReservations - 1} EXTERNAS` : "RESERVA APOING")
                    : (totalSlotReservations > 1 ? `${totalSlotReservations} RESERVAS CLUB` : "OCUPADA EN APOING");
                ownerSub = `APOING: ${ownerName}`;
            }
                
            const apoingIconColor = mine ? 'text-orange-400' : 'text-amber-500';
            
            extraIcon = `
                <div class="apoing-slot-mini absolute top-2 right-2 flex items-center gap-1">
                    ${mine ? `<span class="text-[8px] font-black ${isClubSocial ? "text-blue-400" : "text-orange-400"}">${isClubSocial ? "TUYA" : "MIA"}</span>` : ""}
                    <i class="fas ${isClubSocial ? 'fa-house-user' : 'fa-calendar-check'} ${apoingIconColor} text-[10px]"></i>
                </div>
            `;
        }

        if (match && apoingEvent) {
            extraIcon = '<i class="fas fa-triangle-exclamation text-amber-300 absolute top-2 right-2 text-xs"></i>';
            ownerSub = `${ownerSub ? `${ownerSub} · ` : ""}APOING DETECTADO`;
        }

        // Weather logic
        let weatherHtml = '';
        if (weeklyWeather && weeklyWeather.daily) {
            const targetDate = dStr;
            const dayIdx = weeklyWeather.daily.time.indexOf(targetDate);
            if (dayIdx !== -1) {
                const code = weeklyWeather.daily.weather_code[dayIdx];
                const temp = Math.round(weeklyWeather.daily.temperature_2m_max[dayIdx]);
                const icon = getIconFromCode(code);
                const wx = getWeatherStateFromCode(code);
                weatherHtml = `<div class="slot-weather ${wx}"><i class="fas ${icon}"></i> <span>${temp}°</span></div>`;
            }
        }

        const isPastEmpty = !match && !apoingEvent && isPast;
        return `
            <div class="slot-v5 ${state} ${match?.eventMatchId || match?.col === 'eventoPartidos' ? 'evento' : ''} ${isPast ? 'past' : ''} relative" onclick="handleSlot('${dStr}', '${hour}', '${match?.id || ''}', '${match?.col || ''}', ${isPastEmpty ? 'true' : 'false'})">
                ${extraIcon}
                ${weatherHtml}
                <span class="slot-chip-v5">${label}</span>
                <span class="slot-info-v5">${sub}</span>
                ${ownerSub ? `<span class="slot-owner-v5">${ownerSub}</span>` : ''}
            </div>
        `;
    } catch(e) {
        console.error("Critical error in renderSlot:", e);
        return `<div class="slot-v5 err"><span class="text-[8px]">ERROR SLOT</span></div>`;
    }
}


function resolveTeamDisplayName(match, side) {
    const rawName = side === 'A' ? (match.teamAName || match.equipoA) : (match.teamBName || match.equipoB);
    const uids = getMatchTeamPlayerIds(match, side);
    
    const eventMap = getEventUserNameMap();
    const names = Array.isArray(uids) ? uids.map(uid => {
        if (!uid) return null;
        if (String(uid).startsWith("GUEST_")) {
            const guest = typeof parseGuestMeta === 'function' ? parseGuestMeta(uid) : { name: uid.split('_')[1] };
            return guest?.name || null;
        }
        return eventMap.get(String(uid)) || null;
    }).filter(Boolean) : [];

    return shortName(getFriendlyTeamName({
        teamName: rawName,
        playerNames: names,
        fallback: side === 'A' ? "Pareja 1" : "Pareja 2",
        side
    }));
}

function shortName(name) {
    if (!name) return "Jugador";
    return name.split(" ").slice(0, 2).join(" ");
}

function findOpenMatchesNearApoingReservation(events = []) {
    const now = Date.now();
    const myUpcoming = (events || [])
        .filter((e) => isApoingMine(e) && e?.dtStart instanceof Date && e.dtStart.getTime() >= now)
        .sort((a, b) => a.dtStart - b.dtStart);
    if (!myUpcoming.length) return [];

    return allMatches.filter((match) => {
        if (String(match?.estado || "").toLowerCase() !== "abierto") return false;
        const matchDate = toDateSafe(match?.fecha);
        if (!matchDate) return false;
        return myUpcoming.some((ev) => Math.abs(matchDate.getTime() - ev.dtStart.getTime()) <= (3 * 60 * 60 * 1000));
    }).slice(0, 3);
}

function getWeatherStateFromCode(code) {
    if (code === 0) return "sunny";
    if (code <= 3) return "cloudy";
    if (code <= 48) return "cloudy";
    if (code <= 82) return "rainy";
    if (code <= 99) return "rainy";
    return "cloudy";
}

function getIconFromCode(code) {
    if (code === 0) return 'fa-sun text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]';
    if (code <= 3) return 'fa-cloud-sun text-orange-300';
    if (code <= 48) return 'fa-smog text-gray-400';
    if (code <= 67) return 'fa-cloud-rain text-blue-400';
    if (code <= 77) return 'fa-snowflake text-white';
    if (code <= 82) return 'fa-cloud-showers-heavy text-blue-500';
    if (code <= 99) return 'fa-bolt text-yellow-500';
    return 'fa-cloud text-gray-400';
}

// Global Handlers
window.handleSlot = async (date, hour, id, col, isPastFreeSlot = false) => {
    if (slotInteractionBusy) return;
    slotInteractionBusy = true;

    if (window._vincularMatchId && !id) {
        const matchId = window._vincularMatchId;
        window._vincularMatchId = null;
        try {
            const slotDate = new Date(`${date}T${hour}:00`);
            const { createLinkedMatchFromEvent } = await import('./match-service.js');
            await createLinkedMatchFromEvent(matchId, slotDate);
            showToast("ÉXITO", "Partido vinculado correctamente", "success");
            window.location.search = ""; 
        } catch(e) {
            console.error("Linking error", e);
            showToast("ERROR", "No se pudo vincular el partido", "error");
        }
        slotInteractionBusy = false;
        return;
    }

    const isAdmin = userData?.rol === 'Admin';

    if (window._proposalDraft && !id) {
        try {
            const slotDate = new Date(`${date}T${hour}:00`);
            await createMatchFromProposalDraft(window._proposalDraft, slotDate);
            showToast("Propuesta creada", "Partido añadido al calendario.", "success");
            window._proposalDraft = null;
            slotInteractionBusy = false;
            return;
        } catch (e) {
            console.error("[Proposal] schedule error", e);
            showToast("No se pudo crear", "Revisa jugadores o permisos.", "error");
            slotInteractionBusy = false;
            return;
        }
    }

    const modal = document.getElementById('modal-match');
    // limpiar duplicados
    try { document.getElementById("modal-result-form")?.remove(); } catch {}
    try {
        document.querySelectorAll("#match-detail-area").forEach((el) => {
            if (!modal?.contains(el)) el.remove();
        });
    } catch {}

    const area = modal?.querySelector('#match-detail-area');
    const title = document.getElementById('modal-titulo');
    
    if(!modal || !area) {
        slotInteractionBusy = false;
        return;
    }

    modal.classList.add('active');
    area.innerHTML = '<div class="center py-10 text-center text-white/70"><div class="spinner-galaxy" style="margin-bottom:12px;"></div><div>Cargando detalles del partido...</div></div>';
    
    try {
        const slotDate = new Date(`${date}T${hour}:00`);
        const slotKey = buildSlotKey(slotDate, hour);
        const apoingForSlot = (apoingSlotMap.get(slotKey) || []).sort((a, b) => a.dtStart - b.dtStart);
        const myApoing = apoingForSlot.find(e => isApoingMine(e));

        if (id) {
            const mData = allMatches.find(m => m.id === id);
            if (mData?.col === 'eventoPartidos') {
                if (title) title.textContent = 'PARTIDO DE EVENTO';
                await withTimeout(renderMatchDetail(area, id, 'eventoPartidos', currentUser, userData));
                slotInteractionBusy = false;
                return;
            }
            const mState = String(mData?.estado || '').toLowerCase();
            const finished = mData && (Boolean(getResultSetsString(mData)) || ['cancelado', 'anulado'].includes(mState));
            const isAdmin = userData?.rol === 'Admin';
            
            if (finished && !isAdmin) {
                if (title) title.textContent = 'RESUMEN DE PARTIDO';
                // Direct read mode by passing an impersonated guest user for played matches
                // so match-service defaults to non-participant read mode.
                await withTimeout(renderMatchDetail(area, id, col, { uid: 'guest_reader' }, { rol: 'user' }));
                slotInteractionBusy = false;
                return;
            }

            if (title) title.textContent = "DETALLES DEL PARTIDO";
            await withTimeout(renderMatchDetail(area, id, col, currentUser, userData));
            
            // Add integrity check alert if it's the user's match
            if (myApoing) {
                showToast("Validado", "Tienes reserva confirmada en Apoing para este partido.", "success");
            } else {
                // If it's my match but no apoing found
                const isMyMatch = !!currentUser && userData?.partidosJugadosIds?.includes(id); 
                if (isMyMatch) showToast("Atencion", "No hemos detectado tu reserva en Apoing para este horario.", "warn");
            }
        } else {
            if (apoingForSlot.length) {
                if (title) title.textContent = 'NUEVO PARTIDO';
                await withTimeout(renderCreationForm(area, date, hour, currentUser, userData));

                const owners = Array.from(new Set(apoingForSlot.map((e) => shortName(e.sourceName || e.owner || "Jugador"))));
                const warningHtml = `
                    <div class="mb-3 p-3 rounded-2xl border border-amber-400/35 bg-amber-500/10">
                        <div class="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1">Reserva detectada en Apoing</div>
                        <div class="text-[10px] text-white/80">${myApoing ? "Tienes esta pista reservada en Apoing." : `Reservada por: ${owners.join(", ")}.`}</div>
                    </div>
                `;
                area.innerHTML = warningHtml + area.innerHTML;
            } else {
                if (title) title.textContent = 'NUEVO PARTIDO';
                await withTimeout(renderCreationForm(area, date, hour, currentUser, userData));
            }
        }
    } catch(e) {
        console.error("Render error in handleSlot:", e);
        area.innerHTML = `
            <div class="center p-10 flex-col gap-4 opacity-50">
                <i class="fas fa-exclamation-triangle text-2xl text-amber-500"></i>
                <div class="text-xs uppercase font-black">Error de carga</div>
                <button class="btn btn-ghost sm" onclick="window.location.reload()">REINTENTAR</button>
            </div>
        `;
        showToast("Error de carga", "No se pudo renderizar el detalle del partido.", "error");
    } finally {
        slotInteractionBusy = false;
    }
};


function renderEventMatchDetail(match, dateStr = '', hourStr = '', myApoing = null) {
    const phase = String(match.phase || 'group');
    const phaseLabel = phase === 'group' ? `Grupo ${match.group || ''}` : 
                      (phase === 'knockout' ? `Eliminatoria - R${match.round}` : 
                      (phase === 'league' ? `Jornada ${match.round}` :
                      (phase === 'semi' ? 'Semifinal' : 
                      (phase === 'final' ? 'Final' : 'Evento'))));
    const dateLabel = match.fecha ? new Date(match.fecha?.toDate ? match.fecha.toDate() : match.fecha).toLocaleString('es-ES') : 'Sin fecha programada';
    const result = getResultSetsString(match) || '--';
    const isPlayed = match.estado === 'jugado' || Boolean(getResultSetsString(match));
    const teamALabel = resolveTeamDisplayName(match, 'A');
    const teamBLabel = resolveTeamDisplayName(match, 'B');
    const canManage = !!currentUser && (
        (Array.isArray(match.playerUids) && match.playerUids.includes(currentUser.uid)) ||
        userData?.rol === 'Admin'
    );
    const canCreate = canManage && !isPlayed;

    return `
        <div class="p-4 flex-col gap-3">
            <div class="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div class="text-[9px] font-black uppercase tracking-widest text-primary mb-2">Evento · ${phaseLabel}</div>
                <div class="text-sm font-black text-white mb-1">${teamALabel} vs ${teamBLabel}</div>
                <div class="text-[10px] text-white/70 mb-1">Fecha: ${dateLabel}</div>
                <div class="text-[10px] text-white/70">Estado: ${(match.estado || 'pendiente').toUpperCase()}</div>
                ${isPlayed ? `<div class="text-[10px] text-white/70">Resultado: ${result}</div>` : ''}
            </div>
            ${canCreate ? `
                <div class="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl mb-1">
                    <p class="text-[9px] text-emerald-400 font-bold uppercase mb-1">¡Listo para vincular!</p>
                    <button class="btn btn-primary w-full" onclick="window.renderEventMatchToCreation('${match.id}', '${dateStr}', '${hourStr}')">
                        <i class="fas fa-plus-circle"></i> MONTAR PARTIDO
                    </button>
                </div>
            ` : ''}
            <div class="flex-row gap-2">
                <a class="btn btn-ghost w-full" href="evento-detalle.html?id=${match.eventoId}&tab=partidos">Abrir evento</a>
                ${canManage ? `<button class="btn btn-ghost w-full" onclick="window.location.href='evento-detalle.html?id=${match.eventoId}&tab=partidos&admin=1'">Gestionar</button>` : ''}
            </div>
        </div>
    `;
}

window.renderEventMatchToCreation = async (matchId, dateStr, hour) => {
    const area = document.getElementById('match-detail-area');
    if (!area) return;
    const match = matches.find(m => m.id === matchId && m.col === 'eventoPartidos');
    if (!match) return;

    // Pre-poblar los IDs de los jugadores del evento (desde equipos del evento si existen)
    let preFill = [];
    try {
        const ev = await getDocument('eventos', match.eventoId);
        const teams = Array.isArray(ev?.teams) ? ev.teams : [];
        const teamMap = new Map(teams.map(t => [t.id, t]));
        const teamA = teamMap.get(match.teamAId);
        const teamB = teamMap.get(match.teamBId);
        const players = [
            ...(teamA?.playerUids || []),
            ...(teamB?.playerUids || []),
        ];
        preFill = players.length ? players : (match.playerUids || []);
    } catch (_) {
        preFill = match.playerUids || [];
    }

    await withTimeout(renderCreationForm(area, dateStr, hour, currentUser, userData, preFill));
    
    // Auto-vincular el ID del evento en el selector
    const evSelector = document.getElementById('inp-event-link');
    if (evSelector) {
        // Esperar un momento a que se carguen las opciones
        setTimeout(() => {
            const optVal = `${match.eventoId}|${match.id}|${match.phase || ''}`;
            if ([...evSelector.options].some(o => o.value === optVal)) {
                evSelector.value = optVal;
                evSelector.dispatchEvent(new Event('change')); // Trigger event listener to pre-fill players
                const help = document.getElementById('event-link-help');
                if (help) help.textContent = "Vinculado automaticamente al partido del evento.";
            }
        }, 500);
    }
};

function escapeHtml(raw = "") {
    return String(raw || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function renderApoingSlotDetail(date, hour, events = [], myApoing = null) {
    const cards = events.map((ev) => {
        const mine = isApoingMine(ev);
        const durationMin = eventDurationMs(ev) / 60000;
        const isClub = isClubSocialEvent(ev);
        const start = ev.dtStart?.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) || "--:--";
        const end = ev.dtEnd?.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) || "--:--";
        const owner = ev.owner || "Anonizado";
        
        return `
            <div class="apoing-card-v7 ${mine ? 'mine' : 'other'} ${isClub ? 'club-social' : 'padel-match'}">
                <div class="card-glow"></div>
                <div class="flex-row items-center gap-3">
                    <div class="icon-orb">
                        <i class="fas ${isClub ? 'fa-house-user' : (mine ? 'fa-user-check' : 'fa-calendar-check')}"></i>
                    </div>
                    <div class="flex-col overflow-hidden">
                        <span class="card-type">${isClub ? 'RESERVA CLUB SOCIAL' : 'PISTA PADEL ASIGNADA'}</span>
                        <span class="card-title truncate">${ev.summary || 'Reserva Mistral'}</span>
                        <span class="card-owner">${mine ? "TITULAR: TÚ MISMO" : `POSEEDOR: ${shortName(owner)}`}</span>
                    </div>
                </div>
                <div class="card-footer-v7">
                    <div class="time-range"><i class="far fa-clock"></i> ${start} - ${end}</div>
                    <div class="duration-badge">${Math.round(durationMin)} MIN</div>
                </div>
            </div>
        `;
    }).join("");

    const ics = getApoingIcsUrl();
    
    let actionsHtml = `<div class="p-2"></div>`;
    if (myApoing) {
        const durationMin = eventDurationMs(myApoing) / 60000;
        const isClub = isClubSocialEvent(myApoing);
        
        if (isClub) {
            actionsHtml = `
                <div class="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl mb-4 text-center">
                    <p class="text-[11px] text-blue-200 font-bold mb-1 uppercase">RESERVA DE CLUB SOCIAL</p>
                    <p class="text-[10px] text-white/60">Esta reserva de más de 90 min parece ser del club o piscina. No interfiere con el ranking de pádel.</p>
                </div>
            `;
        } else {
            actionsHtml = `
                <div class="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl mb-4 text-center">
                    <p class="text-[11px] text-emerald-400 font-black mb-1 uppercase italic">VALIDEZ CONFIRMADA âœ…</p>
                    <p class="text-[10px] text-white/80 leading-snug">Esta reserva es tuya en Apoing. ¡Juega hoy o monta un partido ahora!</p>
                </div>
                <div class="grid grid-cols-2 gap-3 mb-4">
                    <button class="btn btn-primary" onclick="renderCreationForm(document.getElementById('match-detail-area'), '${date}', '${hour}', currentUser, userData)">
                        <i class="fas fa-plus-circle"></i> MONTAR PARTIDO
                    </button>
                    <button class="btn btn-confirm-v7" onclick="document.getElementById('modal-match').classList.remove('active'); showToast('VALIDADO','¡Misión reconocida! Prepárate para el juego','success')">
                        <i class="fas fa-check-double"></i> SOLO JUGAR
                    </button>
                </div>
            `;
        }
    }

    return `
        <div class="apoing-detail-container p-4">
            <div class="flex-col gap-3">
                ${cards}
            </div>
            
            <div class="mt-4">
               ${actionsHtml}
            </div>

            <div class="flex-row center gap-4 mt-2">
                <a class="text-[10px] text-primary font-black uppercase tracking-tighter hover:underline" href="${escapeHtml(ics)}" target="_blank">
                    <i class="fas fa-external-link-alt"></i> Ver fuente Apoing
                </a>
            </div>
        </div>
    `;
}

window.handleSelectorSearch = (val) => {
    const term = val.toLowerCase();
    const items = document.querySelectorAll('.u-item-list-v5');
    items.forEach(it => {
        const name = it.querySelector('.u-name-v5').textContent.toLowerCase();
        it.style.display = name.includes(term) ? 'flex' : 'none';
    });
};


function focusToday() {
    setTimeout(() => {
        const todayHeader = document.querySelector('.day-header-v5.today');
        if (todayHeader) todayHeader.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 200);
}

window.showApoingHowTo = () => {
    const modal = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    const title = document.getElementById('modal-titulo');
    if (!modal || !area) return;
    
    if (title) title.textContent = "GUÍA DE CONEXIÓN APOING";
    modal.classList.add('active');
    
    area.innerHTML = `
        <div class="p-4 flex-col gap-4">
            <div class="bg-sport-blue/10 border border-sport-blue/20 p-4 rounded-2xl">
                <h4 class="text-primary font-black mb-2 uppercase italic text-sm">¿Cómo sincronizar tus pistas?</h4>
                <ol class="text-[12px] text-white/70 space-y-3 pl-4 list-decimal">
                    <li>Entra en la web de <b>Apoing</b> y ve a "Mis Reservas".</li>
                    <li>Busca el botón <b>"Sincronizar Calendario"</b> o "Exportar ICS".</li>
                    <li>Copia el enlace que termina en <b>.ics</b>.</li>
                    <li>Ve a tu <b>Perfil</b> en esta App y pulsa en <b>"Conectar Apoing"</b>.</li>
                    <li>Pega el enlace y guarda. ¡Listo!</li>
                </ol>
            </div>
            <div class="bg-white/5 p-4 rounded-2xl border border-white/10">
                <p class="text-[11px] text-white/50 leading-relaxed italic">
                    Una vez conectado, verás tus reservas en color <span class="text-emerald-400 font-bold">VERDE (APOING TUYA)</span> y las del resto del club en <span class="text-cyan-400 font-bold">AZUL (OCUPADA)</span>.
                </p>
            </div>
            <button class="btn btn-primary w-full" onclick="window.location.href='perfil.html'">IR A MI PERFIL</button>
        </div>
    `;
};









async function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const vincularId = params.get('vincularMatchId');
    if (vincularId) {
        showToast("Vincular partido", "Selecciona una franja horaria para este partido de torneo", "info");
        window._vincularMatchId = vincularId;
    }
    const proposalId = params.get("proposalId");
    const draft = readProposalDraft();
    if (draft) {
        window._proposalDraft = draft;
        showToast("Propuesta lista", "Selecciona una franja libre para fijar el partido.", "info");
        if (!proposalId && draft?.proposalId) {
            try {
                const url = new URL(window.location.href);
                url.searchParams.set("proposalId", draft.proposalId);
                window.history.replaceState({}, "", url);
            } catch {}
        }
    }
}


