/* =====================================================
   PADELUMINATIS CALENDAR ENGINE V7.0
   Mistral-Inspired Modern Matrix Logic.
   ===================================================== */

import { db, auth, subscribeDoc, subscribeCol, updateDocument, getDocument } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where, addDoc, doc, getDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast, countUp } from './ui-core.js';
import { renderMatchDetail, renderCreationForm } from './match-service.js';
import { isExpiredOpenMatch, isFinishedMatch, isCancelledMatch } from "./utils/match-utils.js";
import { observeCoreSession } from "./core/core-engine.js";

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

const DEFAULT_APOING_ICS_URL = ""; // Empty by default now to avoid confusion
const APOING_PROXY_LIST = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?",
    "https://proxy.cors.sh/", // Fallback 3
];
const APOING_PROXY_3 = "https://r.jina.ai/http://";
const APOING_SYNC_TTL_MS = 120000;

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

    if (!apoingEvents.length) {
        container.innerHTML = `
            <div class="apoing-chip" onclick="window.showApoingGuide()">
                <span id="apoing-sync-state" class="apoing-sync-state">Sin reservas en Apoing</span>
                <i class="fas fa-chevron-right ml-2 opacity-50"></i>
            </div>
        `;
        return;
    }

    const now = new Date();
    // Filter out club events (duration > 95) and keep only user's own reservations
    const myNext = apoingEvents
        .filter(e => e.dtStart >= now)
        .filter(e => isApoingMine(e))
        .filter(e => (eventDurationMs(e) / 60000) <= 95)
        .sort((a,b) => a.dtStart - b.dtStart)[0];

    if (!myNext) {
        container.innerHTML = `
            <div class="apoing-chip" onclick="window.showApoingGuide()">
                <span id="apoing-sync-state" class="apoing-sync-state">Apoing OK: Sin próximas reservas tuyas</span>
                <i class="fas fa-chevron-right ml-2 opacity-50"></i>
            </div>
        `;
    } else {
        const dateStr = myNext.dtStart.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
        const timeStr = myNext.dtStart.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        
        container.innerHTML = `
            <div class="apoing-upcoming-box-v2 animate-scale-in" onclick="window.showApoingGuide()">
                <div class="v2-box-glow"></div>
                <div class="flex-row items-center gap-3 relative z-10 w-full">
                    <div class="v2-box-icon">
                        <i class="fas fa-calendar-star"></i>
                        <div class="v2-icon-pulse"></div>
                    </div>
                    <div class="flex-col flex-1">
                        <div class="flex-row items-center justify-between">
                            <span class="v2-tag">PRÓXIMA RESERVA</span>
                            <span class="v2-status">ACTIVA</span>
                        </div>
                        <div class="v2-datetime">
                            <span class="v2-date">${dateStr}</span>
                            <span class="v2-sep"></span>
                            <span class="v2-time">${timeStr}</span>
                        </div>
                    </div>
                    <div class="v2-arrow">
                        <i class="fas fa-chevron-right"></i>
                    </div>
                </div>
            </div>
        `;
    }
}

function getApoingIcsUrl() {
    const byUser = String(userData?.apoingCalendarUrl || "").trim();
    const byStorage = String(localStorage.getItem("apoingCalendarUrl") || "").trim();
    return byUser || byStorage || DEFAULT_APOING_ICS_URL;
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
        /\(([A-Za-zÀ-ÿ'`.\- ]{3,})\)/,
        /[-|]\s*([A-Za-zÀ-ÿ ]{3,})/ // Match names after a dash or bar
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
    
    const owner = normalizeName(ev.owner || "");
    const summary = normalizeName(ev.summary || "");
    const desc = normalizeName(ev.description || "");
    const fullText = `${summary} ${desc}`;

    const myNames = [
        normalizeName(userData?.nombreUsuario || ""),
        normalizeName(userData?.nombre || ""),
        normalizeName(String(currentUser?.email || "").split("@")[0] || "")
    ].filter(s => s && s.length > 2);

    // 1. Direct match on extracted owner
    if (owner && myNames.some(s => owner.includes(s) || s.includes(owner))) return true;
    
    // 2. Search names in summary/description (common in Apoing)
    if (myNames.some(s => fullText.includes(s))) return true;
    
    return false;
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
        const enriched = { ...ev, owner };
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
        return txt;
    } finally {
        clearTimeout(t);
    }
}

async function syncApoingReservations(force = false) {
    const now = Date.now();
    if (!force && now < apoingNextRetryAt) return;
    if (!force && now - apoingLastSyncAt < APOING_SYNC_TTL_MS && apoingEvents.length) return;
    const icsUrl = getApoingIcsUrl();
    if (!icsUrl) {
        apoingEvents = [];
        apoingSlotMap = new Map();
        updateApoingSyncBadge("Apoing desactivado", "warn");
        return;
    }
    try {
        updateApoingSyncBadge("Sincronizando Apoing...");
        let raw = "";
        const isLocalDev = ["127.0.0.1", "localhost"].includes(String(window.location.hostname || "").toLowerCase());
        const candidates = isLocalDev
            ? [
                `${APOING_PROXY_3}${icsUrl.replace(/^https?:\/\//i, "")}`,
                ...APOING_PROXY_LIST.map(p => `${p}${encodeURIComponent(icsUrl)}`),
            ]
            : [
                `${APOING_PROXY_3}${icsUrl.replace(/^https?:\/\//i, "")}`,
                ...APOING_PROXY_LIST.map(p => `${p}${encodeURIComponent(icsUrl)}`),
            ];
        let lastErr = null;
        for (const candidate of candidates) {
            try {
                raw = await fetchApoingIcs(candidate);
                break;
            } catch (e) {
                lastErr = e;
            }
        }
        if (!raw) {
            throw lastErr || new Error("apoing_fetch_failed");
        }
        
        // Cache the raw ICS
        try { sessionStorage.setItem(`apoing_raw_cache_${icsUrl}`, JSON.stringify({ ts: now, data: raw })); } catch(_) {}

        const parsed = parseIcsEvents(raw).filter((e) => !Number.isNaN(e.dtStart.getTime()));
        console.log(`[Apoing Debug] Total eventos brutos: ${parsed.length}`);
        
        // RELAXED FILTER: Show everything from the ICS
        const filtered = parsed;
        
        console.log(`[Apoing Debug] Eventos tras filtro: ${filtered.length}`);
        const events = expandRecurringEvents(filtered);
        apoingEvents = events;
        indexApoingEvents(events);
        apoingLastSyncAt = now;
        apoingNextRetryAt = 0;
        updateApoingSyncBadge(`Apoing sincronizado (${events.length})`, "ok");
    } catch (e) {
        console.warn("Apoing sync fallback failed:", e?.message || e);
        
        // Try local session cache fallback
        try {
            const cached = JSON.parse(sessionStorage.getItem(`apoing_raw_cache_${icsUrl}`));
            if (cached && now - cached.ts < 3600000) { // 1 hour cache
                console.log("[Apoing] Using emergency cache fallback");
                const parsed = parseIcsEvents(cached.data);
                const events = expandRecurringEvents(parsed);
                apoingEvents = events;
                indexApoingEvents(events);
                updateApoingSyncBadge(`Caché: ${events.length}`, "warn");
                return;
            }
        } catch(_) {}

        apoingEvents = [];
        apoingSlotMap = new Map();
        apoingLastSyncAt = now;
        apoingNextRetryAt = now + 3 * 60 * 1000;
        updateApoingSyncBadge("Sin datos de Apoing", "err");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('calendar');
    startClock();
    
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

                calendarMatchUnsubs.forEach((unsub) => {
                    try { if (typeof unsub === 'function') unsub(); } catch (_) {}
                });
                calendarMatchUnsubs = [];

                const unsubA = await subscribeCol("partidosAmistosos", () => syncMatches());
                const unsubR = await subscribeCol("partidosReto", () => syncMatches());
                if (typeof unsubA === 'function') calendarMatchUnsubs.push(unsubA);
                if (typeof unsubR === 'function') calendarMatchUnsubs.push(unsubR);

                syncMatches();
            } catch (e) {
                console.error('Calendar init error:', e);
                renderGrid();
            }
        },
    });

    // Navigation setup
    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.onclick = () => { currentWeekOffset--; renderGrid(); };
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.onclick = () => { currentWeekOffset++; renderGrid(); };
    const apoingBadge = document.getElementById('apoing-sync-state');
    if (apoingBadge && !apoingBadge.dataset.bound) {
        apoingBadge.dataset.bound = "1";
        apoingBadge.style.cursor = "pointer";
        apoingBadge.title = "Pulsa para forzar sincronización con Apoing";
        apoingBadge.addEventListener('click', () => {
            syncApoingReservations(true);
        });
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

async function syncMatches() {
    try {
        const [snapA, snapR] = await Promise.all([
            window.getDocsSafe(collection(db, "partidosAmistosos")),
            window.getDocsSafe(collection(db, "partidosReto"))
        ]);
        
        allMatches = [];
        snapA.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
        snapR.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', isComp: true, ...d.data() }));
        await autoCancelExpiredMatches(allMatches);

        await Promise.all([
            hydrateCreatorNames(),
            fetchWeeklyWeather(),
            syncApoingReservations(),
        ]);
        renderGrid();
    } catch (e) {
        console.error('Calendar sync error:', e);
        const status = document.getElementById('apoing-sync-state');
        if (status) {
            status.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error Sync';
            status.className = 'apoing-sync-state err';
            status.onclick = () => window.showApoingGuide();
        }
        allMatches = [];
        renderGrid();
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
            .slice(0, 5)
            .map(e => `
            <div class="status-item-v7">
                <i class="fas fa-calendar-check text-sport-green"></i>
                <div class="flex-col">
                    <span class="text-[10px] font-black uppercase">${e.summary}</span>
                    <span class="text-[8px] opacity-60">${e.dtStart.toLocaleString('es-ES', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})}</span>
                </div>
            </div>
        `).join('')
        : '<div class="p-4 text-center opacity-40 text-[10px]">No se han detectado eventos futuros en el enlace o no se ha sincronizado correctamente.</div>';

    area.innerHTML = `
        <div class="flex-col gap-4 p-2">
            <div class="info-box-v7">
                <i class="fas fa-info-circle"></i>
                <p class="text-[11px] font-medium leading-relaxed">Padeluminatis sincroniza tus reservas directamente desde Apoing. Necesitas tu enlace <b>.ics</b> personal.</p>
            </div>
            
            <div class="config-section-v7">
                <label class="cfg-label-v7">TU ENLACE ICS PERSONAL</label>
                <div class="flex-row gap-2">
                    <input type="text" id="inp-apoing-url" value="${currentUrl}" placeholder="https://www.apoing.com/calendars/..." class="input" style="font-size: 10px;">
                    <button class="btn-confirm-v7" onclick="window.saveApoingUrl()" style="min-width: 80px; padding: 0 10px;">GUARDAR</button>
                </div>
                <p class="text-[8px] mt-2 opacity-50 uppercase font-black">Consigue tu enlace en: Perfil -> Sincronización -> Calendario Celular</p>
            </div>

            <div class="status-section-v7">
                <label class="cfg-label-v7">ESTADO DE SINCRONIZACIÓN</label>
                <div class="status-list-v7">
                    <div class="status-item-v7">
                        <i class="fas ${apoingEvents.length > 0 ? 'fa-check-circle text-sport-green' : 'fa-circle-notch fa-spin opacity-40'}"></i>
                        <span>Eventos detectados: <b>${apoingEvents.length}</b></span>
                    </div>
                    <div class="status-item-v7">
                        <i class="fas fa-link ${currentUrl ? 'text-primary' : 'text-sport-red'}"></i>
                        <span>URL configurada: <b>${currentUrl ? 'SÍ' : 'NO'}</b></span>
                    </div>
                    ${eventsHtml}
                </div>
            </div>

            <button class="btn-mini wide" onclick="window.location.reload()"><i class="fas fa-rotate"></i> REFORZAR SINCRONIZACIÓN</button>
        </div>
    `;

    modal.classList.add('active');
};

window.saveApoingUrl = async () => {
    const url = document.getElementById('inp-apoing-url')?.value.trim();
    if (!url) return;
    
    // Save locally
    localStorage.setItem('apoingCalendarUrl', url); // Changed key to match getApoingIcsUrl
    
    // Save to Firebase profile if possible
    if (currentUser?.uid) {
        const { updateDoc, doc, db } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        try {
            await updateDoc(doc(db, 'usuarios', currentUser.uid), {
                apoingCalendarUrl: url
            });
        } catch(e) { console.warn("Failed to save URL to profile", e); }
    }
    
    document.getElementById('modal-match').classList.remove('active');
    showToast("Enlace Apoing actualizado", "success");
    syncApoingReservations(true); // Force sync after saving
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
        const weekCount = apoingEvents.filter((e) => {
            const t = e?.dtStart?.getTime?.() || 0;
            return t >= startOfWeek.getTime() && t <= endOfWeek.getTime();
        }).length;
        const tone = weekCount > 0 ? "ok" : "warn";
        updateApoingSyncBadge(`Apoing: ${weekCount} en semana · ${apoingEvents.length} total`, tone);
    } else {
        const icsUrl = getApoingIcsUrl();
        if (icsUrl) {
            updateApoingSyncBadge("Apoing: Sin eventos", "warn");
        } else {
            updateApoingSyncBadge("Apoing: No configurado", "warn");
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

    const match = allMatches.find(m => {
        const mDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        if (Number.isNaN(mDate.getTime())) return false;
        const mYear = mDate.getFullYear();
        const mMonth = (mDate.getMonth() + 1).toString().padStart(2, '0');
        const mDay = mDate.getDate().toString().padStart(2, '0');
        const mDStr = `${mYear}-${mMonth}-${mDay}`;
        if (mDStr !== dStr) return false;
        const mTime = mDate.getTime();
        return mTime >= slotTime.getTime() && mTime < slotEnd.getTime();
    });
    
    const isPast = slotEnd < new Date();
    let state = 'libre';
    let label = 'PISTA LIBRE';
    let sub = '';
    let ownerSub = '';
    let extraIcon = '';
    let isLocked = false;

    if (match) {
        // Private Match Check
        if (match.visibility === 'private' && currentUser) {
            const uid = currentUser.uid;
             if (match.organizerId !== uid && match.creador !== uid && !(match.invitedUsers || []).includes(uid) && !(match.jugadores || []).includes(uid)) {
                state = 'bloqueado';
                label = 'PRIVADA';
                sub = 'RESERVADO';
                extraIcon = '<i class="fas fa-lock text-white/50 absolute top-2 right-2 text-xs"></i>';
                isLocked = true;
            }
        }

        if (!isLocked) {
            const isMine = !!currentUser && match.jugadores?.includes(currentUser.uid);
            const count = (match.jugadores || []).filter(id => id).length;
            const isFull = count >= 4;
            const isPlayed = isFinishedMatch(match);
            const isClosed = isCancelledMatch(match) || isExpiredOpenMatch(match);
            
            if (isClosed) {
                state = 'cerrada';
                label = 'ANULADO';
                sub = 'FUERA DE PLAZO';
                ownerSub = `ORGANIZA: ${shortName(match.creatorName || "Sistema")}`;
            } else if (isPlayed) {
                state = 'jugado';
                label = 'JUGADO';
                sub = match.resultado?.sets || 'VER RES';
                if (isMine) {
                    const hasDiary = userData?.diario?.some(e => e.matchId === match.id);
                    if (!hasDiary) {
                        label = 'DIARIO';
                        extraIcon = '<i class="fas fa-exclamation-triangle pulse-warning absolute top-1 right-1 text-[10px] text-yellow-400"></i>';
                    } else {
                        label = 'FINALIZADO';
                    }
                }
            } else {
                if (isMine) {
                    state = 'propia';
                    label = 'TU PARTIDO';
                    sub = 'VER DETALLES';
                    ownerSub = `ORGANIZA: ${shortName(match.creatorName || "Tú")}`;
                }
                else if (isFull) {
                    state = 'cerrada';
                    label = 'COMPLETO';
                    sub = 'SQUAD LLENO';
                    ownerSub = `ORGANIZA: ${shortName(match.creatorName)}`;
                }
                else {
                    state = 'abierta';
                    label = 'DISPONIBLE';
                    sub = `${4 - count} PLAZAS`;
                    ownerSub = `ORGANIZA: ${shortName(match.creatorName)}`;
                }
            }

            if (!ownerSub && match.creatorName) {
                ownerSub = `ORGANIZA: ${shortName(match.creatorName)}`;
            }
        }
    } else if (apoingEvent) {
        const mine = isApoingMine(apoingEvent);
        const totalSlotReservations = apoingForSlot.length;
        const durationMin = eventDurationMs(apoingEvent) / 60000;
        const isClubSocial = durationMin > 95; // Padel is usually 90

        state = mine ? "apoing-mine" : "apoing-other";
        
        const ownerName = shortName(apoingEvent.owner || (mine ? userData?.nombreUsuario || "Tú" : "Club"));

        if (isClubSocial) {
            label = "CLUB SOCIAL";
            sub = mine ? "TU RESERVA CLUB" : "OCUPADO (CLUB)";
            ownerSub = ownerName;
        } else {
            label = mine ? "MI PISTA" : "OCUPADA";
            sub = mine
                ? (totalSlotReservations > 1 ? `MÍA + ${totalSlotReservations - 1} EXTERNAS` : "RESERVA APOING")
                : (totalSlotReservations > 1 ? `${totalSlotReservations} RESERVAS CLUB` : "OCUPADA EN APOING");
            ownerSub = ownerName;
        }
            
        const apoingIconColor = mine ? 'text-orange-400' : 'text-amber-500';
        
        extraIcon = `
            <div class="apoing-slot-mini absolute top-2 right-2 flex items-center gap-1">
                ${mine ? `<span class="text-[8px] font-black ${isClubSocial ? 'text-blue-400' : 'text-orange-400'}">${isClubSocial ? 'TUYA' : 'MÍA'}</span>` : ''}
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
        const targetDate = date.toISOString().split('T')[0];
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
        <div class="slot-v5 ${state} ${isPast ? 'past' : ''} relative" onclick="handleSlot('${dStr}', '${hour}', '${match?.id || ''}', '${match?.col || ''}', ${isPastEmpty ? 'true' : 'false'})">
            ${extraIcon}
            ${weatherHtml}
            <span class="slot-chip-v5">${label}</span>
            <span class="slot-info-v5">${sub}</span>
            ${ownerSub ? `<span class="slot-owner-v5">${ownerSub}</span>` : ''}
        </div>
    `;
}

function shortName(name) {
    if (!name) return "Jugador";
    return name.split(" ").slice(0, 2).join(" ");
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

    if (isPastFreeSlot && !id) {
        slotInteractionBusy = false;
        showToast('BLOQUEADO', 'No se puede reservar en franjas horarias ya pasadas.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    const title = document.getElementById('modal-titulo');
    
    if(!modal || !area) {
        slotInteractionBusy = false;
        return;
    }

    modal.classList.add('active');
    area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
    
    try {
        const slotDate = new Date(`${date}T${hour}:00`);
        const slotKey = buildSlotKey(slotDate, hour);
        const apoingForSlot = (apoingSlotMap.get(slotKey) || []).sort((a, b) => a.dtStart - b.dtStart);
        const myApoing = apoingForSlot.find(e => isApoingMine(e));

        if (id) {
            const mData = allMatches.find(m => m.id === id);
            const finished = mData && (mData.resultado?.sets || ['jugado','jugada','finalizado'].includes(String(mData.estado || '').toLowerCase()));
            
            if (finished) {
                if (title) title.textContent = 'RESUMEN DE PARTIDO';
                // Direct read mode by passing an impersonated guest user for played matches
                // so match-service defaults to non-participant read mode.
                await withTimeout(renderMatchDetail(area, id, col, { uid: 'guest_reader' }, { rol: 'user' }));
                slotInteractionBusy = false;
                return;
            }

            if (title) title.textContent = 'DETALLES DE MISIÓN';
            await withTimeout(renderMatchDetail(area, id, col, currentUser, userData));
            
            // Add integrity check alert if it's the user's match
            if (myApoing) {
                showToast("VALIDADO ✅", "Tienes reserva confirmada en Apoing para este partido.", "success");
            } else {
                // If it's my match but no apoing found
                const isMyMatch = !!currentUser && userData?.partidosJugadosIds?.includes(id); 
                if (isMyMatch) showToast("ATENCIÓN ⚠️", "No hemos detectado tu reserva en Apoing para este horario.", "warn");
            }
        } else {
            if (apoingForSlot.length) {
                if (title) title.textContent = myApoing ? '¡RESERVA CONFIRMADA!' : 'PISTA OCUPADA (APOING)';
                area.innerHTML = renderApoingSlotDetail(date, hour, apoingForSlot, myApoing);
                if (myApoing) {
                    showToast("SNC APOING", "Juega hoy o monta un partido para esta reserva.", "info");
                }
            } else {
                if (title) title.textContent = 'NUEVO DESPLIEGUE';
                await withTimeout(renderCreationForm(area, date, hour, currentUser, userData));
            }
        }
    } catch(e) {
        console.error("Render error:", e);
        area.innerHTML = '<div class="center p-10 opacity-50">Error de carga</div>';
    } finally {
        slotInteractionBusy = false;
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
        const isClub = durationMin > 95;
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
                        <span class="card-owner">${mine ? 'TITULAR: TÚ MISMO' : `POSEEDOR: ${shortName(owner)}`}</span>
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
        const isClub = durationMin > 95;
        
        if (isClub) {
            actionsHtml = `
                <div class="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl mb-4 text-center">
                    <p class="text-[11px] text-blue-200 font-bold mb-1 uppercase">RESERVA DE CLUB SOCIAL</p>
                    <p class="text-[10px] text-white/60">Esta reserva de más de 90 min parece ser del club o piscina. No interfiere con el ranking de Padel.</p>
                </div>
            `;
        } else {
            actionsHtml = `
                <div class="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl mb-4 text-center">
                    <p class="text-[11px] text-emerald-400 font-black mb-1 uppercase italic">VALIDEZ CONFIRMADA ✅</p>
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

window.showApoingGuide = () => {
    const modal = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    const title = document.getElementById('modal-titulo');
    if (!modal || !area) return;
    
    if (title) title.textContent = 'GUÍA DE CONEXIÓN APOING';
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

