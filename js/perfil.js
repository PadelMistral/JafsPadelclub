import {
  auth,
  db,
  subscribeDoc,
  subscribeCol,
  updateDocument,
  uploadProfilePhoto,
  uploadUserGalleryPhoto,
  getDocument,
} from "./firebase-service.js";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  doc,
  serverTimestamp,
  addDoc,
  deleteDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { showToast, countUp, initAppUI } from "./ui-core.js";
import {
  injectHeader,
  injectNavbar,
  initBackground,
  setupModals,
} from "./modules/ui-loader.js";
import { AI } from './ai-engine.js';
import { PredictiveEngine } from './predictive-engine.js';
import { RivalIntelligence } from './rival-intelligence.js';
import { SmartNotifier } from './modules/smart-notifications.js';
import {
  aggregateCoreMonthlyImprovement,
  computeCompetitiveWinrate,
  computeCoreUserPercentiles,
  getCoreDivisionByRating,
  getCoreLevelProgressState,
  getDivisionMovement,
  observeCoreSession,
} from "./core/core-engine.js";
import { isFinishedMatch, isCancelledMatch, resolveWinnerTeam } from "./utils/match-utils.js";
import { getAIMemory, primeAIMemory } from "./ai/ai-memory.js";
import { addPlayerHistoryEntry } from "./services/player-history-service.js";
import { syncComputedStreakForUser } from "./services/streak-service.js";
import { installScreenErrorMonitoring } from "./services/error-monitor.js";
const APOING_PROFILE_DEBUG = true;
installScreenErrorMonitoring("perfil", () => ({
  viewedUserUid: auth?.currentUser?.uid || null,
}));
function escapeProfileHtml(raw = "") {
  const div = document.createElement("div");
  div.textContent = String(raw || "");
  return div.innerHTML;
}
function confirmProfileAction({
  title = "Confirmar",
  message = "¿Quieres continuar?",
  confirmLabel = "Continuar",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay active modal-stack-front";
    overlay.innerHTML = `
      <div class="modal-card glass-strong" style="max-width:380px;">
        <div class="modal-header">
          <h3 class="modal-title">${escapeProfileHtml(title)}</h3>
          <button class="close-btn" type="button">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-[11px] text-white/75 leading-relaxed">${escapeProfileHtml(message)}</p>
          <div class="flex-row gap-2 mt-4">
            <button type="button" class="btn btn-ghost w-full" data-profile-cancel>Cancelar</button>
            <button type="button" class="btn w-full ${danger ? "btn-danger" : "btn-primary"}" data-profile-ok>${escapeProfileHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
    const close = (accepted = false) => {
      overlay.remove();
      resolve(Boolean(accepted));
    };
    overlay.querySelector(".close-btn")?.addEventListener("click", () => close(false));
    overlay.querySelector("[data-profile-cancel]")?.addEventListener("click", () => close(false));
    overlay.querySelector("[data-profile-ok]")?.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.body.appendChild(overlay);
  });
}
function apoingProfileLog(step, data = null) {
  if (!APOING_PROFILE_DEBUG) return;
  try {
    if (data === null || data === undefined) console.log(`[ApoingProfile][${step}]`);
    else console.log(`[ApoingProfile][${step}]`, data);
  } catch (_) {}
}

function maybeFocusApoingSection() {
  if (window.__apoingFocusHandled) return;
  const url = new URL(window.location.href);
  const focus = String(url.searchParams.get("focus") || "").toLowerCase();
  const hash = String(window.location.hash || "").toLowerCase();
  if (focus !== "apoing" && !hash.includes("apoing")) return;
  window.__apoingFocusHandled = true;
  window.requestAnimationFrame(() => {
    const target =
      document.getElementById("profile-apoing-settings") ||
      document.getElementById("profile-apoing-section");
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("flash-focus-ring");
    window.setTimeout(() => target.classList.remove("flash-focus-ring"), 1800);
  });
}

window.openAIHubFromProfile = function () {
  try { sessionStorage.setItem("openAIHub", "1"); } catch (_) {}
  window.location.href = "home.html";
};

document.addEventListener("DOMContentLoaded", () => {
  initAppUI('profile');
  initBackground();
  setupModals();

  const normalizeProfileProductCopy = () => {
    const pageTitle = document.querySelector("title");
    if (pageTitle) pageTitle.textContent = "Perfil | JafsPadel";
    document.querySelectorAll(".section-title").forEach((node) => {
      const text = String(node.textContent || "");
      if (/Siri/i.test(text)) node.innerHTML = `<i class="fas fa-brain-circuit text-purple-400 mr-2"></i>IA Tactica`;
      if (/Métricas|MÃ©tricas/i.test(text)) node.textContent = "Metricas de rendimiento";
      if (/Memoria y Evoluci/i.test(text)) node.innerHTML = `<i class="fas fa-memory text-primary mr-2"></i>Memoria y evolucion`;
      if (/Configuraci/i.test(text)) node.innerHTML = `<i class="fas fa-cog text-white/30 mr-2"></i>Configuracion`;
    });
    const iaCta = document.querySelector("#profile-chat-ia-cta .text-\\[11px\\]");
    if (iaCta) iaCta.textContent = "Todo lo avanzado, en la IA";
  };
  normalizeProfileProductCopy();

  const compactProfileSection = (sectionId, titleHtml) => {
    const section = document.getElementById(sectionId);
    if (!section || section.dataset.compacted === "1") return;
    section.dataset.compacted = "1";
    const children = Array.from(section.children);
    if (!children.length) return;

    const details = document.createElement("details");
    details.className = "profile-accordion";
    const summary = document.createElement("summary");
    summary.className = "profile-accordion-trigger";
    summary.innerHTML = `
      <h2 class="section-title" style="margin:0;">${titleHtml}</h2>
      <i class="fas fa-chevron-down accordion-arrow"></i>
    `;
    const body = document.createElement("div");
    body.style.marginTop = "12px";

    children.forEach((child) => {
      if (child.classList?.contains("section-header")) return;
      body.appendChild(child);
    });

    details.appendChild(summary);
    details.appendChild(body);
    section.replaceChildren(details);
  };

  compactProfileSection("ai-tactical-report-section", `<i class="fas fa-brain-circuit text-purple-400 mr-2"></i>IA Tactica`);
  compactProfileSection("profile-settings-section", `<i class="fas fa-cog text-white/30 mr-2"></i>Configuracion`);

  const sections = Array.from(document.querySelectorAll(".profile-section"));
  const memorySection = sections.find((section) => section.querySelector("#profile-memory-bank"));
  if (memorySection && !memorySection.dataset.compacted) {
    memorySection.id = memorySection.id || "profile-memory-section";
    compactProfileSection(memorySection.id, `<i class="fas fa-memory text-primary mr-2"></i>Memoria y Evolucion`);
  }

  const achievementsSection = sections.find((section) => section.querySelector("#achievements-grid"));
  if (achievementsSection && !achievementsSection.dataset.compacted) {
    achievementsSection.id = achievementsSection.id || "profile-achievements-section";
    compactProfileSection(achievementsSection.id, `<i class="fas fa-medal text-sport-gold mr-2"></i>Logros`);
  }

  const rivalrySection = sections.find((section) => section.querySelector("#rival-intel-dashboard"));
  if (rivalrySection && !rivalrySection.dataset.compacted) {
    rivalrySection.id = rivalrySection.id || "profile-rivalry-section";
    compactProfileSection(rivalrySection.id, `<i class="fas fa-crosshairs text-primary mr-2"></i>Rivalidad y Alianzas`);
  }

  const apoingSection = sections.find((section) => section.querySelector("#apoing-preview"));
  if (apoingSection && !apoingSection.dataset.compacted) {
    apoingSection.id = apoingSection.id || "profile-apoing-section";
    compactProfileSection(apoingSection.id, `<i class="fas fa-calendar-check text-primary mr-2"></i>Mis Reservas Apoing`);
  }

  let currentUser = null;
  let userData = null;
  let eloChart = null;
  let radarChart = null;
  let attrEvolutionChart = null;
  let eloLogsCache = [];
  let profileUid = null;
  let viewingOwnProfile = true;
  let playerHistoryFeed = [];
  let unsubPlayerHistory = null;
  let usersCache = [];
  let usersCacheAt = 0;
  let globalLogsCache = [];
  let globalLogsCacheAt = 0;
  let advStatsCacheAt = 0;
  let selectedEloRange = 30;

  async function loadProfileGallery(uid) {
    const grid = document.getElementById("profile-gallery-grid");
    if (!grid || !uid) return;
    try {
      const snap = await getDocs(
        query(collection(db, "usuarios", uid, "gallery"), orderBy("createdAt", "desc"), limit(24)),
      );
      if (snap.empty) {
        grid.innerHTML = `<div class="text-center py-6 opacity-40 text-[10px] font-black uppercase col-span-3">Aun no hay fotos subidas en tu galeria compartida.</div>`;
        return;
      }
      grid.innerHTML = snap.docs.map((entry) => {
        const item = entry.data() || {};
        const imageUrl = String(item.url || "").trim();
        const canEdit = viewingOwnProfile && currentUser?.uid === uid;
        return `
          <article class="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 min-h-[110px]">
            <img src="${escapeProfileHtml(imageUrl)}" alt="Galeria" class="w-full h-[118px] object-cover">
            <div class="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-[#020617] via-[#020617cc] to-transparent">
              <div class="text-[9px] uppercase tracking-widest text-white/70 truncate">${escapeProfileHtml(item.name || "foto")}</div>
              <div class="flex-row gap-2 mt-2">
                ${canEdit ? `<button type="button" class="btn btn-primary text-[9px] px-2 py-1" onclick="window.useGalleryPhotoAsProfile('${uid}','${entry.id}')">Perfil</button>` : ``}
                ${canEdit ? `<button type="button" class="btn btn-ghost text-[9px] px-2 py-1" onclick="window.deleteGalleryPhoto('${uid}','${entry.id}')">Borrar</button>` : ``}
              </div>
            </div>
          </article>
        `;
      }).join("");
    } catch (_) {
      grid.innerHTML = `<div class="text-center py-6 opacity-40 text-[10px] font-black uppercase col-span-3">No se pudo cargar la galeria.</div>`;
    }
  }

  const getApoingStorageKey = (uid) => `apoingCalendarUrl:${uid || "anon"}`;
  const APOING_PROFILE_PROXY_URL = `${window.location.origin}/api/apoing-ics?url=`;
  const APOING_PROFILE_PROXY_3 = "https://r.jina.ai/http://";

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
      if (key === "SUMMARY") current.summary = value;
      if (key === "DESCRIPTION") current.description = value;
      if (key === "DTSTART") current.dtStart = parseIcsDate(value);
      if (key === "DTEND") current.dtEnd = parseIcsDate(value);
    }
    return out.filter((e) => e.dtStart instanceof Date && e.dtEnd instanceof Date);
  }

  async function fetchApoingIcs(url, timeoutMs = 22000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
      if (!resp.ok) throw new Error(`apoing_http_${resp.status}`);
      const txt = await resp.text();
      if (!String(txt || "").includes("BEGIN:VCALENDAR")) throw new Error("apoing_invalid_ics");
      apoingProfileLog("ics.fetch.ok", { urlPreview: `${String(url).slice(0, 70)}...`, size: String(txt || "").length });
      return txt;
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchRawApoingByUrl(icsUrl = "") {
    const cleanUrl = String(icsUrl || "").trim();
    if (!cleanUrl) return "";
    try {
      apoingProfileLog("ics.fetch.try", { url: cleanUrl });
      const jinaTarget = `${APOING_PROFILE_PROXY_3}${cleanUrl.replace(/^https?:\/\//i, "")}`;
      return await fetchApoingIcs(jinaTarget);
    } catch (e) {
      apoingProfileLog("ics.fetch.fail", { err: e?.message || String(e) });
      try {
        const target = `${APOING_PROFILE_PROXY_URL}${encodeURIComponent(cleanUrl)}`;
        return await fetchApoingIcs(target);
      } catch (e2) {
        apoingProfileLog("ics.fetch.unavailable", { err: e2?.message || String(e2) });
        return "";
      }
    }
  }

  function renderApoingPreviewEmpty(message = "Configura tu calendario Apoing en Ajustes", sub = "Verás aquí un resumen de tus reservas activas") {
    const box = document.getElementById("apoing-preview");
    if (!box) return;
    box.innerHTML = `
      <div class="flex-col gap-2 items-center py-4 opacity-40">
        <i class="fas fa-calendar-plus text-2xl"></i>
        <span class="text-[11px] font-bold">${message}</span>
        <span class="text-[9px] text-muted">${sub}</span>
      </div>
    `;
  }

  async function renderApoingPreview(data = {}) {
    const box = document.getElementById("apoing-preview");
    if (!box) return;
    const localUrl = String(localStorage.getItem(getApoingStorageKey(currentUser?.uid)) || "").trim();
    const apoingUrl = String(data?.apoingCalendarUrl || localUrl || "").trim();
    apoingProfileLog("preview.input", {
      uid: currentUser?.uid || "",
      hasUserUrl: Boolean(String(data?.apoingCalendarUrl || "").trim()),
      hasLocalUrl: Boolean(localUrl),
      urlPreview: apoingUrl ? `${apoingUrl.slice(0, 45)}...` : "",
    });
    if (!apoingUrl) {
      renderApoingPreviewEmpty();
      return;
    }

    try {
      box.innerHTML = `<div class="center py-4 opacity-50"><i class="fas fa-circle-notch fa-spin text-primary"></i></div>`;
      const raw = await fetchRawApoingByUrl(apoingUrl);
      const now = Date.now();
      const events = parseIcsEvents(raw)
        .filter((e) => (e.dtStart?.getTime?.() || 0) >= now)
        .filter((e) => /padel|pádel|reserva|pista|court/i.test(`${e.summary || ""} ${e.description || ""}`))
        .sort((a, b) => a.dtStart - b.dtStart)
        .slice(0, 6);
      apoingProfileLog("preview.events", {
        count: events.length,
        first: events[0]
          ? {
              summary: events[0].summary || "",
              start: events[0].dtStart?.toISOString?.() || "",
              end: events[0].dtEnd?.toISOString?.() || "",
            }
          : null,
      });

      if (!events.length) {
        renderApoingPreviewEmpty("No se han detectado reservas futuras", "Cuando tengas reservas en Apoing, aparecerán aquí automáticamente");
        return;
      }

      box.innerHTML = events.map((ev) => {
        const day = ev.dtStart.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" }).toUpperCase();
        const h1 = ev.dtStart.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
        const h2 = ev.dtEnd.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
        const title = String(ev.summary || "Reserva de pista");
        return `
          <div class="apoing-slot">
            <div class="apoing-slot-time">${day}</div>
            <div class="apoing-slot-info">${h1} - ${h2} · ${title}</div>
          </div>
        `;
      }).join("");
    } catch (_) {
      apoingProfileLog("preview.error");
      renderApoingPreviewEmpty("No se pudo sincronizar Apoing", "Revisa tu URL .ics o vuelve a intentarlo más tarde");
    }
  }

  observeCoreSession({
    onSignedOut: () => {
      window.location.href = "index.html";
    },
    onReady: async ({ user, userDoc }) => {
      currentUser = user;
      const targetUid = new URLSearchParams(window.location.search).get("uid");
      profileUid = targetUid || user.uid;
      viewingOwnProfile = profileUid === user.uid;

      SmartNotifier.checkInactivity({ id: user.uid, lastMatchDate: user.limitMatchDate });

      const data = userDoc || (await getDocument("usuarios", user.uid));
      await injectHeader(data || {});
      injectNavbar("profile");

      if (data) SmartNotifier.checkInactivity({ id: user.uid, lastMatchDate: data.lastMatchDate });

      const settingsSection = document.getElementById("profile-settings-section");
      if (settingsSection) settingsSection.style.display = viewingOwnProfile ? "" : "none";
      const gallerySection = document.getElementById("profile-gallery-section");
      if (gallerySection) gallerySection.style.display = viewingOwnProfile ? "" : "none";
      
      // Read-only mode for other users' profiles
      if (!viewingOwnProfile) {
        // Hide editable elements
        document.querySelectorAll('.avatar-edit-btn, #upload-photo, #btn-logout, #profile-chat-ia-cta, #btn-open-gallery-upload, #upload-gallery-photo').forEach(el => {
          if (el) el.style.display = 'none';
        });
        // Disable avatar click
        const avatarWrap = document.querySelector('.profile-avatar-wrapper');
        if (avatarWrap) { avatarWrap.style.cursor = 'default'; avatarWrap.onclick = null; }
        // Hide add gear button
        document.querySelectorAll('button[onclick*="openGearModal"]').forEach(el => el.style.display = 'none');
      }

      subscribeDoc("usuarios", profileUid, async (docData) => {
        if (docData) {
          docData.computedStreak = await syncComputedStreakForUser(profileUid, docData, {
            maxLogs: 80,
            skipPersist: !viewingOwnProfile,
          });
          const primedMemory = await primeAIMemory(profileUid).catch(() => null);
          if (primedMemory && !docData.aiMemory) docData.aiMemory = primedMemory;
          userData = docData;
          renderProfileData(docData);
          renderAIInsights(docData);
          renderMemoryBank(docData);
          renderPlayerTimeline(docData);
          loadEloHistory(profileUid);
          loadCompetitiveData(profileUid);
          renderTacticalRadar(docData);
          renderAchievements(docData);
          renderDiarioStats(docData.diario || [], docData);
          loadAdvancedCompetitiveStats(profileUid, docData);
          loadVisualIntelligence(profileUid, docData);
          if (viewingOwnProfile) loadProfileGallery(profileUid);
          maybeFocusApoingSection();
        } else if (!userData) {
          const fallback = {
            nombreUsuario: "Jugador",
            nombre: "Jugador",
            nivel: 2.5,
            puntosRanking: 1000,
            victorias: 0,
            partidosJugados: 0,
            rachaActual: 0,
          };
          userData = fallback;
          renderProfileData(fallback);
          renderMemoryBank(fallback);
          renderPlayerTimeline(fallback);
        }
      });

      if (typeof unsubPlayerHistory === "function") {
        try { unsubPlayerHistory(); } catch (_) {}
      }
      unsubPlayerHistory = await subscribeCol(
        "playerHistory",
        (rows) => {
          playerHistoryFeed = (rows || []).slice().sort((a, b) => {
            const aTime = toSafeDate(a?.createdAt)?.getTime() || 0;
            const bTime = toSafeDate(b?.createdAt)?.getTime() || 0;
            return bTime - aTime;
          });
          renderPlayerTimeline(userData || {});
        },
        [["uid", "==", profileUid]],
        [],
        24,
      );

      setupStatInteractions();
    },
  });

  async function renderProfileData(data) {
    if (!data) return;
    
    // Header Info
    const nameEl = document.getElementById("p-name");
    const roleEl = document.getElementById("p-role");
    const avatarEl = document.getElementById("p-avatar");
    const userInp = document.getElementById("p-username-inp");

    const name = data.nombreUsuario || data.nombre || "JUGADOR";
    const photo = data.fotoPerfil || data.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;
    const phone = data.telefono || "";

    if (nameEl) nameEl.textContent = name.toUpperCase();
    if (roleEl) roleEl.textContent = (data.rol || 'Atleta Pro').toUpperCase();
    if (avatarEl) avatarEl.src = photo;
    if (userInp) userInp.value = name;
    
    // Form inputs
    const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    setVal("p-phone-inp", phone);
    setVal("p-weight-inp", data.peso || "");
    const vivInfo = data.vivienda || data.direccion || {};
    if(vivInfo.bloque) {
        setVal("addr-bloque", vivInfo.bloque);
        setVal("addr-piso", vivInfo.piso);
        setVal("addr-puerta", vivInfo.puerta);
    }
    const apoingInp = document.getElementById("apoing-url-inp");
    if (apoingInp) {
      const stored = String(localStorage.getItem(getApoingStorageKey(currentUser?.uid)) || "").trim();
      apoingInp.value = String(data.apoingCalendarUrl || stored || "");
    }

    // V7 Stats Cards
    const levelVal = (data.nivel || 2.5).toFixed(2);
    const ptsVal = Math.round(data.puntosRanking || 1000);
    const streakVal = Number.isFinite(Number(data.computedStreak)) ? Number(data.computedStreak) : (data.rachaActual || 0);
    
    const lvlEl = document.getElementById("p-nivel");
    const ptsEl = document.getElementById("p-puntos");
    const stkEl = document.getElementById("p-streak");
    
    if(lvlEl) countUp(lvlEl, levelVal);
    if(ptsEl) countUp(ptsEl, ptsVal);
    if(stkEl) {
        stkEl.textContent = Math.abs(streakVal);
        stkEl.style.color = streakVal >= 0 ? "var(--sport-green)" : "var(--sport-red)";
    }

    const divisionBadgeEl = document.getElementById("profile-division-badge");
    if (divisionBadgeEl) {
      const division = getCoreDivisionByRating(ptsVal);
      divisionBadgeEl.innerHTML = `<i class="fas ${division.icon}"></i> ${division.label}`;
      divisionBadgeEl.style.borderColor = `${division.color}66`;
      divisionBadgeEl.style.color = division.color;
      const lastBefore = Number(data?.lastMatchAnalysis?.pointsBefore);
      if (Number.isFinite(lastBefore)) {
        divisionBadgeEl.classList.toggle("up", getDivisionMovement(lastBefore, ptsVal) > 0);
      }
    }

    // Grid Metrics (Detailed)
    const winrate = computeCompetitiveWinrate(data.victorias, data.partidosJugados);
    const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
    setText("stat-total-matches", data.partidosJugados || 0);
    setText("stat-total-wins", data.victorias || 0);
    setText("stat-streak", Math.abs(streakVal));
    setText("stat-winrate", winrate + "%");

    // Level Progress
    updateLevelProgress(data.nivel || 2.5, data.puntosRanking || 1000);

    // Elite Stats (Positional ELO)
    renderEliteStats(data);
    
    // Gear/Palas
    renderGear(data.palas || []);
    renderUltimateFutCard(data);
    renderApoingPreview(data).catch(() => {});
  }

  function toSafeDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatTimelineDate(value) {
    const d = toSafeDate(value);
    if (!d) return "Ahora";
    return d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
    }).toUpperCase();
  }

  function renderMemoryBank(user = {}) {
    const container = document.getElementById("profile-memory-bank");
    if (!container) return;
    const mem = user.aiMemory || getAIMemory(profileUid);
    const insights = Array.isArray(mem?.insights) ? mem.insights.slice(0, 2) : [];
    const patterns = Array.isArray(mem?.patterns) ? mem.patterns.slice(0, 2) : [];
    const cards = [
      ...insights.map((item) => ({
        eyebrow: "Insight IA",
        title: item.type || "general",
        text: item.text || "Sin detalle",
        metaLeft: `${item.hits || 1} usos`,
        metaRight: formatTimelineDate(item.updatedAt || item.createdAt),
      })),
      ...patterns.map((item) => ({
        eyebrow: "Patrón",
        title: item.id || "repetido",
        text: item.summary || "Sin resumen",
        metaLeft: `${item.hits || 1} detecciones`,
        metaRight: formatTimelineDate(item.lastSeenAt || item.firstSeenAt),
      })),
    ];

    if (!cards.length) {
      container.innerHTML = `<div class="memory-card-empty">La IA todavía no tiene suficiente historial unificado para este jugador.</div>`;
      return;
    }

    container.innerHTML = cards.map((card) => `
      <article class="memory-card">
        <div class="memory-card__eyebrow">${card.eyebrow}</div>
        <div class="memory-card__title">${card.title}</div>
        <div class="memory-card__text">${card.text}</div>
        <div class="memory-card__meta">
          <span>${card.metaLeft}</span>
          <span>${card.metaRight}</span>
        </div>
      </article>
    `).join("");
  }

  function renderPlayerTimeline(user = {}) {
    const container = document.getElementById("profile-timeline");
    if (!container) return;
    const diary = Array.isArray(user.diario) ? user.diario : [];
    const mem = user.aiMemory || getAIMemory(profileUid);

    const diaryItems = diary.slice(-4).map((entry) => ({
      date: entry?.fecha || entry?.timestamp || entry?.createdAt,
      title: "Entrada de diario",
      text: entry?.coachNote || entry?.memoryNote || entry?.tactica?.leccion || "Nueva reflexión táctica registrada.",
      tone: "diary",
      tag: "Diario",
    }));

    const eloItems = (eloLogsCache || []).slice(0, 4).map((log) => ({
      date: log?.timestamp,
      title: Number(log?.diff || 0) >= 0 ? "Subida de ranking" : "Ajuste de ranking",
      text: `${Number(log?.diff || 0) >= 0 ? "+" : ""}${Number(log?.diff || 0).toFixed(2)} ELO · ${log?.reason || "Partido procesado"}`,
      tone: "elo",
      tag: "Ranking",
    }));

    const memoryItems = (mem?.insights || []).slice(0, 3).map((item) => ({
      date: item?.updatedAt || item?.createdAt,
      title: "Memoria IA",
      text: item?.text || "Nueva observación almacenada por la IA.",
      tone: "ai",
      tag: "IA",
    }));

    const persistedItems = (playerHistoryFeed || []).slice(0, 6).map((item) => ({
      date: item?.createdAt,
      title: item?.title || "Actividad",
      text: item?.text || "Nuevo evento registrado en tu historial.",
      tone: item?.tone || "system",
      tag: item?.tag || "Sistema",
    }));

    const rows = [...persistedItems, ...diaryItems, ...eloItems, ...memoryItems]
      .filter((row) => row.date || row.text)
      .sort((a, b) => (toSafeDate(b.date)?.getTime() || 0) - (toSafeDate(a.date)?.getTime() || 0))
      .slice(0, 8);

    if (!rows.length) {
      container.innerHTML = `<div class="memory-card-empty">Cuando empieces a jugar, analizar y registrar partidos, aquí verás tu evolución completa.</div>`;
      return;
    }

    container.innerHTML = rows.map((row) => `
      <article class="timeline-item">
        <div class="timeline-item__date">${formatTimelineDate(row.date)}</div>
        <div>
          <div class="timeline-item__title">${row.title}</div>
          <div class="timeline-item__text">${row.text}</div>
          <span class="timeline-item__tag ${row.tone}">${row.tag}</span>
        </div>
      </article>
    `).join("");
  }

  function getLevelProgressState(rawNivel, rawPuntos) {
    return getCoreLevelProgressState({
      rating: Number(rawPuntos || 1000),
      levelOverride: Number(rawNivel || 2.5),
    });
  }

  function updateLevelProgress(nivel, puntos) {
    const state = getLevelProgressState(nivel, puntos);

    const bar = document.getElementById("level-bar");
    const currentLabel = document.getElementById("p-level-current");
    const detailEl = document.getElementById("level-progress-detail");
    const lowerLabel = document.getElementById("level-lower");
    const upperLabel = document.getElementById("level-upper");
    const upperBottomLabel = document.getElementById("level-upper-bottom");

    if (bar) bar.style.width = `${state.progressPct.toFixed(2)}%`;
    if (currentLabel) currentLabel.textContent = `NIVEL ${state.currentLevel.toFixed(2)} · ${state.progressPct.toFixed(2)}%`;
    if (detailEl) {
      detailEl.innerHTML = `
        <span class="lvl-shift-chip up">+${state.pointsToUp} PTS · NV ${state.nextLevel.toFixed(2)}</span>
        <span class="lvl-shift-chip down">-${state.pointsToDown} PTS · NV ${state.prevLevel.toFixed(2)}</span>
      `;
    }

    if (lowerLabel) lowerLabel.textContent = state.prevLevel.toFixed(2);
    if (upperLabel) upperLabel.textContent = state.nextLevel.toFixed(2);
    if (upperBottomLabel) upperBottomLabel.textContent = state.nextLevel.toFixed(2);
  }

  function renderUltimateFutCard(data) {
    const container = document.getElementById("fut-card-container");
    if (!container || !data) return;

    const attrs = data.atributosTecnicos || {};
    const diario = Array.isArray(data.diario) ? data.diario : [];
    const stats = data.stats || {};

    const clamp = (v, min = 0, max = 99) => Math.max(min, Math.min(max, Number(v) || 0));
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const avgShot = (key) => {
      const vals = diario
        .map((e) => Number(e?.shots?.[key]))
        .filter((v) => Number.isFinite(v) && v > 0);
      return vals.length ? clamp(avg(vals) * 10, 1, 99) : null;
    };

    const volea = avgShot("volley") ?? clamp(attrs.volea ?? 50, 1, 99);
    const bandeja = avgShot("bandeja") ?? clamp(((attrs.tecnica ?? 50) + (attrs.fondo ?? 50)) / 2, 1, 99);
    const smash = avgShot("smash") ?? clamp(attrs.remate ?? 50, 1, 99);
    const vibora = avgShot("vibora") ?? clamp(((attrs.volea ?? 50) + (attrs.tecnica ?? 50)) / 2, 1, 99);
    const globo = avgShot("lob") ?? clamp(attrs.fondo ?? 50, 1, 99);
    const saque = avgShot("serve") ?? clamp(((attrs.tecnica ?? 50) + (attrs.mentalidad ?? 50)) / 2, 1, 99);

    const consistencyDerived = diario.length
      ? clamp(
          avg(
            diario.map((e) => {
              const w = Number(e?.stats?.winners ?? 0);
              const ue = Number(e?.stats?.ue ?? 0);
              return ((w + 1) / (ue + 1)) * 40;
            }),
          ),
          1,
          99,
        )
      : clamp(stats.consistency ?? 55, 1, 99);
    const mental = clamp(attrs.mentalidad ?? 50, 1, 99);
    const fisico = clamp(attrs.fisico ?? 50, 1, 99);
    const tactica = clamp(attrs.tactica ?? attrs.lecturaJuego ?? 50, 1, 99);

    const overallRaw = (
      volea * 0.16 +
      bandeja * 0.14 +
      smash * 0.16 +
      vibora * 0.1 +
      globo * 0.1 +
      saque * 0.09 +
      consistencyDerived * 0.1 +
      mental * 0.08 +
      fisico * 0.07
    );
    const overall = Math.round(clamp(overallRaw, 1, 99));

    let tier = "Bronce";
    if (overall >= 90) tier = "Elite";
    else if (overall >= 82) tier = "Pro";
    else if (overall >= 74) tier = "Avanzado";
    else if (overall >= 66) tier = "Competitivo";

    const level = Number(data.nivel || 2.5).toFixed(2);
    const name = (data.nombreUsuario || data.nombre || "Jugador").toUpperCase();
    const dominant = (data.posicionPreferida || data.posicion || "Reves").toUpperCase();

    const barRow = (label, value) => `
      <div class="fut-bar-row">
        <span class="l">${label}</span>
        <div class="fut-bar"><span style="width:${clamp(value, 1, 99)}%"></span></div>
        <span class="n">${Math.round(clamp(value, 1, 99))}</span>
      </div>
    `;

    const photo = data.fotoPerfil || data.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;

    container.innerHTML = `
      <div class="fut-card-v2 tier-${tier.toLowerCase()} animate-up">
        <div class="fut-card-glow"></div>
        
        <div class="fut-card-top">
          <div class="fut-card-ovr-box">
            <span class="ovr">${overall}</span>
            <span class="tier">${tier}</span>
          </div>
          <div class="fut-card-img-box">
            <img src="${photo}" alt="${name}">
          </div>
        </div>

        <div class="fut-card-info">
          <h3 class="fut-name">${name}</h3>
          <div class="fut-meta">${dominant} · NIVEL ${level}</div>
          <div class="flex-row center gap-3 mt-1 opacity-60 text-[8px] font-black uppercase">
            <span>${data.partidosJugados || 0} PJ</span>
            <span>${data.victorias || 0} W</span>
          </div>
        </div>

        <div class="fut-card-grid">
          <div class="fut-row">
            <div class="stat"><span>VOL</span><strong>${Math.round(volea)}</strong></div>
            <div class="stat"><span>BAN</span><strong>${Math.round(bandeja)}</strong></div>
            <div class="stat"><span>SMA</span><strong>${Math.round(smash)}</strong></div>
          </div>
          <div class="fut-row">
            <div class="stat"><span>VIB</span><strong>${Math.round(vibora)}</strong></div>
            <div class="stat"><span>LOB</span><strong>${Math.round(globo)}</strong></div>
            <div class="stat"><span>SER</span><strong>${Math.round(saque)}</strong></div>
          </div>
        </div>

        <div class="fut-card-bars">
           ${barRow("CONSISTENCIA", consistencyDerived)}
           ${barRow("MENTAL", mental)}
           ${barRow("FISICO", fisico)}
           ${barRow("TACTICA", tactica)}
        </div>
      </div>
    `;
  }

  async function loadEloHistory(uid) {
    try {
      const logs = await window.getDocsSafe(
        query(
          collection(db, "rankingLogs"),
          where("uid", "==", uid),
          orderBy("timestamp", "desc"),
          limit(220),
        ),
      );

      const raw = logs.docs.map((d) => d.data());
      eloLogsCache = raw;
      bindEloRangeControls();
      renderEloByDays(selectedEloRange);
      renderEloHistoryMini(raw.slice(0, 5));
      renderActivityHeatmap(raw);
      if (userData) renderPlayerTimeline(userData);
    } catch (e) {
      return;
    }
  }

  function bindEloRangeControls() {
    const map = [
      { id: "elo-range-30", days: 30 },
      { id: "elo-range-60", days: 60 },
      { id: "elo-range-90", days: 90 },
    ];
    map.forEach((cfg) => {
      const el = document.getElementById(cfg.id);
      if (!el || el.dataset.bound === "1") return;
      el.dataset.bound = "1";
      el.addEventListener("click", () => {
        selectedEloRange = cfg.days;
        map.forEach((x) => document.getElementById(x.id)?.classList.toggle("active", x.days === cfg.days));
        renderEloByDays(cfg.days);
      });
    });
  }

  function renderEloByDays(days = 30) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = eloLogsCache
      .filter((l) => {
        const d = l?.timestamp?.toDate ? l.timestamp.toDate() : new Date(0);
        return d.getTime() >= since;
      })
      .slice()
      .reverse();
    renderEloChart(rows);
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

  async function loadAdvancedCompetitiveStats(uid, data) {
    try {
      const now = Date.now();
      if (now - advStatsCacheAt < 20000) return;
      advStatsCacheAt = now;
      const logsSnap = await window.getDocsSafe(
        query(
          collection(db, "rankingLogs"),
          where("uid", "==", uid),
          orderBy("timestamp", "desc"),
          limit(50),
        ),
      );
      const logs = logsSnap?.docs?.map((d) => d.data()) || [];
      const played = Number(data?.partidosJugados || 0);
      const winrate = computeCompetitiveWinrate(data?.victorias, played);

      const formResults = logs.slice(0, 5).map((l) => (Number(l?.diff || 0) >= 0 ? "W" : "L"));
      const formEl = document.getElementById("profile-form-chips");
      if (formEl) formEl.innerHTML = buildFormChips(formResults, 5);

      const strongMatches = logs.filter((l) => {
        const myTeam = Number(l?.details?.breakdown?.teamRating || 0);
        const rival = Number(l?.details?.breakdown?.rivalTeamRating || 0);
        return rival > myTeam + 50;
      });
      const equalMatches = logs.filter((l) => {
        const myTeam = Number(l?.details?.breakdown?.teamRating || 0);
        const rival = Number(l?.details?.breakdown?.rivalTeamRating || 0);
        return Math.abs(rival - myTeam) <= 50;
      });
      const weakerMatches = logs.filter((l) => {
        const myTeam = Number(l?.details?.breakdown?.teamRating || 0);
        const rival = Number(l?.details?.breakdown?.rivalTeamRating || 0);
        return rival < myTeam - 50;
      });
      const strongWins = strongMatches.filter((l) => Number(l?.diff || 0) > 0).length;
      const equalWins = equalMatches.filter((l) => Number(l?.diff || 0) > 0).length;
      const weakerWins = weakerMatches.filter((l) => Number(l?.diff || 0) > 0).length;
      const vsStrongPct = strongMatches.length ? Math.round((strongWins / strongMatches.length) * 100) : 0;
      const vsEqualPct = equalMatches.length ? Math.round((equalWins / equalMatches.length) * 100) : 0;
      const vsWeakerPct = weakerMatches.length ? Math.round((weakerWins / weakerMatches.length) * 100) : 0;

      const streakValues = logs.map((l) => Number(l?.details?.streakAfter || 0)).filter((v) => Number.isFinite(v));
      const bestStreak = streakValues.length ? Math.max(...streakValues, Math.abs(Number(data?.rachaActual || 0))) : Math.abs(Number(data?.rachaActual || 0));

      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
      };
      setText("adv-winrate", `${winrate}%`);
      setText("adv-played", played);
      setText("adv-best-streak", bestStreak);
      setText("adv-vs-strong", `${vsStrongPct}%`);
      setText("adv-vs-equal", `${vsEqualPct}%`);
      setText("adv-vs-weaker", `${vsWeakerPct}%`);

      const last10El = document.getElementById("adv-elo-last10");
      if (last10El) {
        const rows = logs.slice(0, 10).map((log) => {
          const diff = Number(log?.diff || 0);
          const cls = diff >= 0 ? "up" : "down";
          const ts = log?.timestamp?.toDate ? log.timestamp.toDate() : new Date();
          const date = ts.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
          return `<div class="elo-last10-row"><span class="d">${date}</span><span class="v ${cls}">${diff >= 0 ? "+" : ""}${diff.toFixed(0)}</span></div>`;
        });
        last10El.innerHTML = rows.length ? rows.join("") : `<div class="elo-last10-row"><span class="d">Sin datos</span><span class="v">--</span></div>`;
      }
    } catch (_) {}
  }

  async function loadVisualIntelligence(uid, data) {
    try {
      const [users, globalLogs] = await Promise.all([
        loadUsersSnapshot(),
        loadGlobalLogsSnapshot(),
      ]);
      const monthlyImprovement = aggregateCoreMonthlyImprovement(globalLogs, 30);
      const pcts = computeCoreUserPercentiles({
        users,
        targetUid: uid,
        monthlyImprovement,
      });
      setTextSafe("pct-elo", `Top ${pcts.elo}%`);
      setTextSafe("pct-winrate", `Top ${pcts.winrate}%`);
      setTextSafe("pct-activity", `Top ${pcts.activity}%`);
      setTextSafe("pct-improvement", `Top ${pcts.monthlyImprovement}%`);

      renderAttributeEvolution(data?.diario || []);
      renderActivityHeatmap(eloLogsCache);
      renderAutoInsights(data, eloLogsCache, monthlyImprovement.get(uid) || 0);
      initQuickComparator(uid, users);
    } catch (e) {
      console.warn("Visual intelligence load failed:", e);
    }
  }

  async function loadUsersSnapshot() {
    const now = Date.now();
    if (usersCache.length && now - usersCacheAt < 120000) return usersCache;
    usersCacheAt = now;
    const snap = await window.getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(500)));
    usersCache = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    return usersCache;
  }

  async function loadGlobalLogsSnapshot() {
    const now = Date.now();
    if (globalLogsCache.length && now - globalLogsCacheAt < 120000) return globalLogsCache;
    globalLogsCacheAt = now;
    const snap = await window.getDocsSafe(query(collection(db, "rankingLogs"), orderBy("timestamp", "desc"), limit(1500)));
    globalLogsCache = (snap?.docs || []).map((d) => d.data());
    return globalLogsCache;
  }

  function renderAttributeEvolution(diario = []) {
    const canvas = document.getElementById("attr-evolution-chart");
    if (!canvas || typeof Chart === "undefined") return;

    const rows = (diario || [])
      .filter((e) => e?.fecha)
      .map((e) => ({ ...e, _date: new Date(e.fecha) }))
      .filter((e) => Number.isFinite(e._date.getTime()))
      .sort((a, b) => a._date - b._date)
      .slice(-24);

    if (rows.length < 2) {
      if (attrEvolutionChart) attrEvolutionChart.destroy();
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const labels = rows.map((e) => e._date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }));
    const volea = rows.map((e) => Number(e?.shots?.volley || 5) * 10);
    const defensa = rows.map((e) => Number(e?.shots?.lob || 5) * 10);
    const smash = rows.map((e) => Number(e?.shots?.smash || 5) * 10);

    if (attrEvolutionChart) attrEvolutionChart.destroy();
    attrEvolutionChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Volea", data: volea, borderColor: "#a3e635", tension: 0.35, pointRadius: 2 },
          { label: "Defensa", data: defensa, borderColor: "#38bdf8", tension: 0.35, pointRadius: 2 },
          { label: "Smash", data: smash, borderColor: "#f59e0b", tension: 0.35, pointRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "rgba(255,255,255,0.8)", boxWidth: 10, font: { size: 10 } } } },
        scales: {
          y: { min: 0, max: 100, ticks: { color: "rgba(255,255,255,0.5)", font: { size: 9 } }, grid: { color: "rgba(255,255,255,0.08)" } },
          x: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 8 } }, grid: { display: false } },
        },
      },
    });
  }

  function renderActivityHeatmap(logs = []) {
    const box = document.getElementById("activity-heatmap");
    if (!box) return;
    const days = 84;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    const counts = new Map();
    (logs || []).forEach((l) => {
      const d = l?.timestamp?.toDate ? l.timestamp.toDate() : null;
      if (!d) return;
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      counts.set(key, Number(counts.get(key) || 0) + 1);
    });

    const cells = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const c = Number(counts.get(key) || 0);
      const intensity = c === 0 ? 0.08 : Math.min(0.95, 0.2 + c * 0.18);
      const color = c === 0 ? "rgba(255,255,255,0.08)" : `rgba(163,230,53,${intensity})`;
      cells.push(`<div title="${key} · ${c} actividad(es)" style="width:10px;height:10px;border-radius:2px;background:${color}"></div>`);
    }

    box.innerHTML = `
      <div class="text-[9px] font-black uppercase text-muted mb-2">Últimos 84 días</div>
      <div style="display:grid;grid-template-columns:repeat(28, 10px);gap:3px;">${cells.join("")}</div>
    `;
  }

  function renderAutoInsights(user, logs = [], monthlyImprovement = 0) {
    const box = document.getElementById("auto-insights");
    if (!box) return;
    const current5 = (logs || []).slice(0, 5).reduce((acc, l) => acc + Number(l?.diff || 0), 0);
    const prev5 = (logs || []).slice(5, 10).reduce((acc, l) => acc + Number(l?.diff || 0), 0);
    const trend = current5 - prev5;
    const played = Number(user?.partidosJugados || 0);
    const winrate = computeCompetitiveWinrate(user?.victorias, played);

    const insights = [];
    if (trend > 20) insights.push({ icon: "fa-arrow-trend-up", title: "Mejora Detectada", text: `Momentum positivo: +${Math.round(trend)} ELO frente al tramo previo.` });
    if (trend < -20) insights.push({ icon: "fa-arrow-trend-down", title: "Descenso Detectado", text: `Rendimiento a la baja: ${Math.round(trend)} ELO vs tramo previo.` });
    if (monthlyImprovement > 0) insights.push({ icon: "fa-calendar-check", title: "Mejora Mensual", text: `Balance últimos 30 días: +${Math.round(monthlyImprovement)} ELO.` });
    if (monthlyImprovement < 0) insights.push({ icon: "fa-triangle-exclamation", title: "Alerta Mensual", text: `Balance últimos 30 días: ${Math.round(monthlyImprovement)} ELO.` });
    insights.push({ icon: "fa-bullseye", title: "Rendimiento Global", text: `Winrate actual ${winrate}% en ${played} partidos.` });

    box.innerHTML = insights.map((x) => `
      <div class="automation-card">
        <div class="auto-icon"><i class="fas ${x.icon}"></i></div>
        <div class="flex-col">
          <span class="text-[8px] font-black tracking-widest uppercase text-primary mb-1">${x.title}</span>
          <p class="text-[10px] text-white font-bold leading-tight">${x.text}</p>
        </div>
      </div>
    `).join("");
  }

  function initQuickComparator(uid, users = []) {
    const select = document.getElementById("quick-compare-user");
    const btn = document.getElementById("quick-compare-run");
    if (!select || !btn) return;
    if (select.dataset.bound !== "1") {
      select.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        const rivalId = String(select.value || "");
        if (!rivalId) return;
        await renderQuickComparison(uid, rivalId);
      });
    }

    const currentVal = select.value;
    const options = (users || [])
      .filter((u) => (u.id || u.uid) !== uid)
      .slice(0, 200)
      .map((u) => `<option value="${u.id || u.uid}">${u.nombreUsuario || u.nombre || "Jugador"} · ${Math.round(Number(u.puntosRanking || 1000))} ELO</option>`)
      .join("");
    select.innerHTML = `<option value="">Selecciona jugador...</option>${options}`;
    if (currentVal) select.value = currentVal;
  }

  async function renderQuickComparison(uid, rivalId) {
    const box = document.getElementById("quick-compare-result");
    if (!box) return;
    box.innerHTML = `<div class="py-4 center"><div class="spinner-neon"></div></div>`;
    try {
      const { comparePlayers } = await import("./modules/player-comparator.js");
      const c = await comparePlayers(uid, rivalId);
      if (!c) throw new Error("no_data");
      const h2h = c.h2h || { total: 0, winsA: 0, winsB: 0 };
      box.innerHTML = `
        <div class="grid grid-cols-2 gap-3">
          <div class="stat-card-v9 cyan"><span class="s-lbl">${c.p1.name || "Yo"}</span><span class="s-val">${Math.round(c.p1.elo || 0)}</span></div>
          <div class="stat-card-v9 magenta"><span class="s-lbl">${c.p2.name || "Rival"}</span><span class="s-val">${Math.round(c.p2.elo || 0)}</span></div>
          <div class="adv-stat-card"><span>PERCENTIL</span><b>Top ${c.p1.percentileTop}% vs Top ${c.p2.percentileTop}%</b></div>
          <div class="adv-stat-card"><span>WINRATE</span><b>${c.p1.winrate}% vs ${c.p2.winrate}%</b></div>
          <div class="adv-stat-card"><span>FORMA</span><b>${c.p1.form} vs ${c.p2.form}</b></div>
          <div class="adv-stat-card"><span>H2H</span><b>${h2h.winsA}-${h2h.winsB} (${h2h.total})</b></div>
        </div>
      `;
    } catch (_) {
      box.innerHTML = `<div class="text-[10px] text-danger uppercase font-black">No se pudo calcular la comparación.</div>`;
    }
  }

  function setTextSafe(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderEloHistoryMini(logs = []) {
    const box = document.getElementById("elo-history-mini");
    if (!box) return;
    if (!Array.isArray(logs) || logs.length === 0) {
      box.innerHTML = `<div class="elo-mini-row"><span class="elo-mini-date">Sin cambios recientes</span><span class="elo-mini-delta">--</span></div>`;
      return;
    }

    box.innerHTML = logs.map((log) => {
      const diff = Number(log?.diff || 0);
      const cls = diff >= 0 ? "up" : "down";
      const ts = log?.timestamp?.toDate ? log.timestamp.toDate() : new Date();
      const label = ts.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
      return `
        <div class="elo-mini-row">
          <span class="elo-mini-date">${label}</span>
          <span class="elo-mini-delta ${cls}">${diff >= 0 ? "+" : ""}${diff.toFixed(0)}</span>
        </div>
      `;
    }).join("");
  }

  async function loadCompetitiveData(uid) {
    try {
        const amSnap = await window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), limit(50)));
        const reSnap = await window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), limit(50)));
        const evSnap = await window.getDocsSafe(query(collection(db, "eventoPartidos"), where("jugadores", "array-contains", uid), limit(100)));
        
        const allMatchesRaw = [...amSnap.docs, ...reSnap.docs, ...evSnap.docs].map(d => d.data());
        
        const partners = {};
        const rivals = { won: {}, lost: {} };

        allMatchesRaw.forEach(m => {
            if (!isFinishedMatch(m) || isCancelledMatch(m)) return;
            const winnerTeam = resolveWinnerTeam(m);
            if (winnerTeam !== 1 && winnerTeam !== 2 && winnerTeam !== "A" && winnerTeam !== "B") return;

            const players = Array.isArray(m.jugadores) || Array.isArray(m.playerUids) ? (m.jugadores || m.playerUids) : [];
            const myIdx = players.indexOf(uid);
            if (myIdx < 0) return;
            
            const isTeam1 = myIdx < 2;
            const userWon = (winnerTeam === 1 || winnerTeam === "A") ? isTeam1 : !isTeam1;
            
            const userTeam = isTeam1 ? players.slice(0, 2) : players.slice(2, 4);
            const rivalTeam = isTeam1 ? players.slice(2, 4) : players.slice(0, 2);

            userTeam?.forEach(p => {
                if (p && p !== uid && !String(p).startsWith("GUEST_")) {
                    partners[p] = (partners[p] || 0) + 1;
                }
            });

            rivalTeam?.forEach(r => {
                if (r && !String(r).startsWith("GUEST_")) {
                    if (userWon) rivals.won[r] = (rivals.won[r] || 0) + 1;
                    else rivals.lost[r] = (rivals.lost[r] || 0) + 1;
                }
            });
        });

        const fetchName = async (id) => {
            const d = await getDocument('usuarios', id);
            return { name: d?.nombreUsuario || d?.nombre || 'Desconocido', id: id };
        };

        const getTop = (obj) => {
            const keys = Object.keys(obj);
            if (keys.length === 0) return null;
            return keys.reduce((a, b) => obj[a] > obj[b] ? a : b);
        };

        const topPartnerId = getTop(partners);
        const topNemesisId = getTop(rivals.lost);
        const topVictimId = getTop(rivals.won);

        const updateCard = async (elId, uId, defaultLabel) => {
            const valEl = document.getElementById(elId);
            const boxEl = valEl?.closest('.nexus-item-v9');
            if(uId) {
                const u = await fetchName(uId);
                if(valEl) valEl.textContent = u.name;
                if(boxEl) {
                    boxEl.dataset.id = u.id;
                    boxEl.style.cursor = 'pointer';
                    boxEl.onclick = () => window.loadRivalAnalysis(u.id);
                }
            } else {
                if(valEl) valEl.textContent = "---";
                if(boxEl) boxEl.onclick = null;
            }
        };

        await updateCard('profile-partner', topPartnerId);
        await updateCard('profile-nemesis', topNemesisId);
        await updateCard('profile-victim', topVictimId);

    } catch(e) { console.error("Competitive error:", e); }
  }

  function renderEloChart(logs) {
    const canvas = document.getElementById("elo-chart");
    if (!canvas) return;

    if (logs.length < 2) {
      canvas.parentElement.innerHTML = `<div class="center flex-col py-6 opacity-40"><i class="fas fa-chart-line text-2xl mb-2"></i><span class="text-xs">Faltan datos de combates</span></div>`;
      return;
    }

    if (eloChart) eloChart.destroy();
    
    // Calculate color based on trend
    const start = logs[0].newTotal;
    const end = logs[logs.length-1].newTotal;
    const color = end >= start ? '#a3e635' : '#ef4444'; // Green or Red

    const labels = logs.map((l) => {
      const d = l?.timestamp?.toDate ? l.timestamp.toDate() : new Date();
      return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
    });
    const points = logs.map((l) => l.newTotal);

    eloChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
            data: points,
            borderColor: color,
            backgroundColor: (ctx) => {
                const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 100);
                gradient.addColorStop(0, color + '33');
                gradient.addColorStop(1, color + '00');
                return gradient;
            },
            fill: true,
            tension: 0.4,
            pointBackgroundColor: color,
            pointRadius: 3,
            borderWidth: 2
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          y: { display:false, min: Math.min(...points) - 10, max: Math.max(...points) + 10 },
          x: { display: false }
        },
      },
    });
  }

  function renderGear(palas) {
    const list = document.getElementById("gear-container");
    if (!list) return;

    if (palas.length === 0) {
      list.innerHTML = `<div class="empty-feed-v9 py-10"><i class="fas fa-microchip mb-4"></i><p>SIN EQUIPAMIENTO</p><span>REGISTRA TU PRIMERA PALA</span></div>`;
      return;
    }

    list.innerHTML = palas.map((p, idx) => {
        const health = p.matchesUsed ? Math.max(0, 100 - (p.matchesUsed / 50) * 100) : 100;
        const color = health > 70 ? 'var(--sport-green)' : health > 30 ? 'var(--sport-gold)' : '#ff4d4d';
        return `
            <div class="stat-card-v9 ${idx % 2 === 0 ? 'cyan' : 'magenta'} mb-3">
                <div class="flex-row between items-center mb-3">
                    <div class="flex-col">
                        <span class="text-xs font-black uppercase tracking-widest text-primary">${p.marca}</span>
                        <h4 class="text-lg font-black italic uppercase">${p.modelo}</h4>
                    </div>
                    <div class="node-mood-v9"><i class="fas fa-table-tennis-paddle-ball"></i></div>
                </div>
                <div class="flex-col gap-2 mb-4">
                    <div class="flex-between text-[9px] font-black opacity-40"><span>INTEGRIDAD</span><span>${Math.round(health)}%</span></div>
                    <div class="m-bar" style="height: 3px;"><div class="m-fill" style="width: ${health}%; background: ${color}"></div></div>
                </div>
                <div class="node-tags-v9">
                    ${p.potencia ? `<span class="tag-v9 winner">POT: ${p.potencia}</span>` : ""}
                    ${p.control ? `<span class="tag-v9 elite">CTR: ${p.control}</span>` : ""}
                </div>
                <button class="btn-icon-sm text-danger absolute top-2 right-2 opacity-30 hover:opacity-100" onclick="window.removePala(${idx})"><i class="fas fa-times"></i></button>
            </div>
        `;
    }).join("");
  }

  function renderTacticalRadar(user) {
    const canvas = document.getElementById("tactical-radar-chart");
    if (!canvas) return;

    // Use Advanced Stats Evolution (Phase 3)
    // Scale: 0-100 internally, display 0-10 on chart
    const attrs = user.atributosTecnicos || { 
        mentalidad: 50, tactica: 50, fisico: 50, 
        tecnica: 50, fondo: 50, volea: 50, remate: 50 
    };

    // Mapping relevant stats for the Radar
    const dataPoints = [
        attrs.mentalidad / 10,
        (attrs.tactica || attrs.lecturaJuego || 50) / 10,
        attrs.fisico / 10,
        (attrs.tecnica || attrs.consistencia || 50) / 10,
        attrs.fondo / 10,
        ((attrs.volea + attrs.remate) / 2) / 10 // Attack composite
    ];
    
    if (radarChart) radarChart.destroy();

    radarChart = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: ['MENTAL', 'TÁCTICA', 'FÍSICO', 'TÉCNICA', 'DEFENSA', 'ATAQUE'],
        datasets: [{
          label: 'ADN',
          data: dataPoints,
          backgroundColor: 'rgba(163, 230, 53, 0.2)', // Sport Lime
          borderColor: '#a3e635',
          borderWidth: 2,
          pointBackgroundColor: '#a3e635',
          pointBorderColor: '#fff',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: 'rgba(255,255,255,0.1)' },
            grid: { color: 'rgba(255,255,255,0.1)' },
            pointLabels: { 
                color: 'rgba(255,255,255,0.8)', 
                font: { size: 10, weight: 'bold', family: "'Orbitron', sans-serif" } 
            },
            ticks: { display: false, max: 10 },
            suggestedMin: 0, requestedMax: 10
          }
        },
        plugins: { legend: { display: false } }
      }
    });

    // Render Attribute Bars (List below radar)
    const attrList = document.getElementById('attribute-list');
    if (attrList) {
        const createBar = (label, val) => `
            <div class="mb-3">
                <div class="flex-row between text-[9px] font-black uppercase mb-1">
                    <span class="text-white">${label}</span>
                    <span class="text-primary">${Math.round(val)}/99</span>
                </div>
                <div class="m-bar" style="height:4px; background:rgba(255,255,255,0.1)">
                    <div class="m-fill" style="width:${val}%; background:var(--primary); box-shadow: 0 0 10px var(--primary)"></div>
                </div>
            </div>
        `;

        attrList.innerHTML = `
            ${createBar('VOLEA', attrs.volea)}
            ${createBar('REMATE', attrs.remate)}
            ${createBar('FONDO DE PISTA', attrs.fondo)}
            ${createBar('FÍSICO', attrs.fisico)}
            ${createBar('MENTALIDAD', attrs.mentalidad)}
        `;
    }
  }

  function renderAchievements(user) {
    const grid = document.getElementById("achievements-grid");
    const countLabel = document.getElementById("achv-count-label");
    if (!grid) return;

    const played = Number(user?.partidosJugados || 0);
    const wins = Number(user?.victorias || 0);
    const winrate = computeCompetitiveWinrate(wins, played);
    const diary = Array.isArray(user?.diario) ? user.diario : [];
    const now = Date.now();
    const recentDiaryCount = diary.filter((e) => {
      const d = new Date(e?.fecha || "");
      if (!Number.isFinite(d?.getTime?.())) return false;
      return now - d.getTime() <= 30 * 24 * 60 * 60 * 1000;
    }).length;

    const rules = [
      { id: 'first_win', name: 'PRIMERA SANGRE', icon: 'fa-bolt', desc: 'Gana tu primer partido', check: u => u.victorias > 0, tier: 'bronze' },
      { id: 'streak_3', name: 'EN RACHA', icon: 'fa-fire', desc: '3 victorias seguidas', check: u => u.rachaActual >= 3, tier: 'silver' },
      { id: 'streak_5', name: 'INVICTO', icon: 'fa-shield', desc: '5 victorias seguidas', check: u => u.rachaActual >= 5, tier: 'gold' },
      { id: 'streak_10', name: 'LEYENDA', icon: 'fa-fire', desc: '10 victorias seguidas', check: u => u.rachaActual >= 10, tier: 'gold' },
      { id: 'veteran_50', name: 'VETERANO', icon: 'fa-medal', desc: 'Juega 50 partidos', check: () => played >= 50, tier: 'silver' },
      { id: 'veteran_200', name: 'MARATON', icon: 'fa-award', desc: 'Juega 200 partidos', check: () => played >= 200, tier: 'gold' },
      { id: 'winrate_60', name: 'DOMINADOR', icon: 'fa-bullseye', desc: 'Winrate >= 60% (min 20 partidos)', check: () => played >= 20 && winrate >= 60, tier: 'silver' },
      { id: 'winrate_75', name: 'IMPLACABLE', icon: 'fa-skull', desc: 'Winrate >= 75% (min 30 partidos)', check: () => played >= 30 && winrate >= 75, tier: 'gold' },
      { id: 'centurion', name: 'CENTURION', icon: 'fa-trophy', desc: 'Gana 100 partidos', check: u => u.victorias >= 100, tier: 'gold' },
      { id: 'bagel', name: 'THE BAGEL', icon: 'fa-bread-slice', desc: 'Gana un set 6-0', check: u => u.stats?.bagels > 0, tier: 'silver' },
      { id: 'gear_fan', name: 'ARMERIA', icon: 'fa-tags', desc: 'Registra 3 palas', check: u => u.palas?.length >= 3, tier: 'bronze' },
      { id: 'diario_master', name: 'ANALISTA', icon: 'fa-book', desc: '5 entradas de diario', check: u => u.diario?.length >= 5, tier: 'silver' },
      { id: 'diario_month', name: 'CRONISTA', icon: 'fa-pen', desc: '3 entradas de diario en 30 dias', check: () => recentDiaryCount >= 3, tier: 'bronze' },
      { id: 'net_king', name: 'REY DE LA RED', icon: 'fa-crown', desc: 'Disponible cuando midamos puntos ganados en red', check: () => false, tier: 'silver', locked: true },
      { id: 'mvp_month', name: 'MVP DEL MES', icon: 'fa-star', desc: 'Disponible cuando exista evaluacion mensual', check: () => false, tier: 'gold', locked: true }
    ];

    let unlockedCount = 0;
    grid.innerHTML = rules.map(r => {
      const isLocked = r.locked === true;
      const isUnlocked = !isLocked && r.check(user);
      if (isUnlocked) unlockedCount++;
      return `
        <div class="ach-item-v9 ${isUnlocked ? 'active' : ''} ${r.tier}" title="${r.desc}">
            <div class="ach-icon-box">
                <i class="fas ${r.icon}"></i>
                ${isUnlocked ? '<div class="ach-check"><i class="fas fa-check"></i></div>' : ''}
            </div>
            <span class="ach-lbl-v9">${r.name}</span>
            <span class="ach-sub-v9">${isLocked ? "PROXIMAMENTE" : (isUnlocked ? "DESBLOQUEADO" : "PENDIENTE")}</span>
        </div>
      `;
    }).join('');

    if (countLabel) countLabel.textContent = `${unlockedCount} / ${rules.length} DESBLOQUEADOS`;
  }

  function renderEliteStats(data) {
      // Sub-ELO Display
      const elo = data.elo || {};
      const base = Math.round(data.puntosRanking || 1000);
      const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = Math.round(val || base); };
      setText('elo-drive', elo.drive);
      setText('elo-reves', elo.reves);
      setText('elo-indoor', elo.indoor);
      setText('elo-outdoor', elo.outdoor);
  }

  function renderDiarioStats(diario, data) {
     try {
      // Advanced Stats from Diary
      if(!diario || diario.length === 0) return; // Need at least one entry

     // Averages
     let mentalSum = 0, consistencySum = 0, pressureSum = 0;
     let count = 0;
     
     diario.forEach(e => {
         if(e.biometria) {
             mentalSum += (e.biometria.mental || 5);
             pressureSum += (e.biometria.confianza || 5); // Proxy for handling pressure
             count++;
         }
         // Calculate consistency proxy from winners/UE
         if(e.stats) {
             const w = e.stats.winners || 0;
             const ue = e.stats.ue || 1;
             const ratio = Math.min(10, (w/ue)*5); // Scale to 10
             consistencySum += ratio;
         }
     });

     if(count === 0) return;

     const consPct = Math.round((consistencySum / count) * 10);
     const pressPct = Math.round((pressureSum / count) * 10);

     const setBar = (idVal, idBar, val) => {
         const v = Math.min(100, Math.max(0, val));
         const elVal = document.getElementById(idVal);
         const elBar = document.getElementById(idBar);
         if(elVal) elVal.textContent = `${v}/100`;
         if(elBar) elBar.style.width = `${v}%`;
     };

     setBar('val-consistency', 'bar-consistency', consPct);
     setBar('val-pressure', 'bar-pressure', pressPct);

     // New Biometric indicators from core AI state
     const adv = data?.advancedStats || {};
     setBar('val-fatigue-profile', 'bar-fatigue-profile', adv.fatigueIndex || 0);
     setBar('val-stress-profile', 'bar-stress-profile', adv.pressure || 0);
    } catch (e) { console.error("Diario render error:", e); }
  }

  async function renderAIInsights(user) {
      if(!user) return;
      try {
        const state = user.playerState || {};
        const q = state.qualitative || {};
        const recs = state.activeInterventions || [];
        const metrics = state.metrics || {};
        const lastSeen = user.ultimoAcceso?.toDate ? user.ultimoAcceso.toDate() : new Date();
        const winrate = computeCompetitiveWinrate(user?.victorias, user?.partidosJugados);
        const confidence = Math.max(30, Math.min(99, Math.round(((Number(user.nivel || 2.5) - 2) * 22) + (winrate * 0.45))));
        
        let analysis = q;
        if (!q.style) {
            analysis = { style: 'Calculando...', progression: 'Recopilando datos...' };
            // Trigger background calculation locally if needed, but normally AIOrchestrator handles this
        }

        const container = document.getElementById('ai-profile-insights');
        if (container) {
            container.innerHTML = `
                <div class="ai-insight-card animate-fade-in">
                    <div class="ai-header"><i class="fas fa-brain-circuit text-purple-400"></i><span class="text-[9px] font-black tracking-widest">ESTILO</span></div>
                    <h3 class="text-xl font-black text-white uppercase italic mb-2">${analysis.style || 'Neutro'}</h3>
                    <div class="flex-wrap gap-1 flex">${(analysis.strengths || []).slice(0, 2).map(s => `<span class="tag-v9 winner">${s}</span>`).join('')}</div>
                </div>
                <div class="ai-insight-card animate-fade-in delay-100">
                    <div class="ai-header"><i class="fas fa-chart-line text-cyan-400"></i><span class="text-[9px] font-black tracking-widest">TENDENCIA</span></div>
                    <h3 class="text-lg font-black text-white uppercase italic mb-1">${analysis.progression || 'Estable'}</h3>
                    <span class="text-[10px] text-muted">${analysis.emotionalTrend || 'Sin cambios'}</span>
                </div>
                <div class="ai-insight-card animate-fade-in delay-150">
                    <div class="ai-header"><i class="fas fa-shield-heart text-sport-green"></i><span class="text-[9px] font-black tracking-widest">CONFIANZA IA</span></div>
                    <h3 class="text-xl font-black text-white uppercase italic mb-1">${confidence}%</h3>
                    <span class="text-[10px] text-muted">Basado en nivel, winrate y volumen de juego</span>
                </div>
                <div class="ai-insight-card animate-fade-in delay-200">
                    <div class="ai-header"><i class="fas fa-satellite-dish text-primary"></i><span class="text-[9px] font-black tracking-widest">SINCRONIZACIÓN</span></div>
                    <h3 class="text-sm font-black text-white uppercase italic mb-1">DATOS EN TIEMPO REAL</h3>
                    <span class="text-[10px] text-muted">Última actividad: ${lastSeen.toLocaleDateString('es-ES')} ${lastSeen.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            `;
        }
        
        const auto = document.getElementById('ai-automations');
        const fallbackRecs = [];
        if ((user.rachaActual || 0) < 0) fallbackRecs.push({ icon: 'fa-arrow-trend-down', type: 'Racha', text: 'Baja carga competitiva 24h y prioriza consistencia en saque + volea.' });
        if (winrate < 45) fallbackRecs.push({ icon: 'fa-crosshairs', type: 'Táctica', text: 'Agenda partidos de nivel similar para reconstruir confianza y ritmo.' });
        if ((user.diario || []).length < 3) fallbackRecs.push({ icon: 'fa-book-open', type: 'Diario', text: 'Registra sensaciones post-partido para mejorar recomendaciones automáticas.' });
        if (Number(user.partidosJugados || 0) < 8) fallbackRecs.push({ icon: 'fa-seedling', type: 'Progreso', text: 'Completa más partidos para que la IA estabilice tu perfil de juego.' });
        const finalRecs = recs.length > 0 ? recs : fallbackRecs;

        if (auto) {
            const phrases = [];
            
            // Phrase 1: Recent match (using eloLogsCache or user.diario)
            const lastEntry = (user.diario || []).sort((a,b) => {
                const da = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
                const db = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
                return db - da;
            })[0];
            
            if (lastEntry) {
                const res = lastEntry.resultado || "";
                const date = lastEntry.timestamp?.toDate ? lastEntry.timestamp.toDate() : new Date(lastEntry.timestamp);
                const isToday = date.toDateString() === new Date().toDateString();
                const isYesterday = date.toDateString() === new Date(Date.now()-86400000).toDateString();
                const dateText = isToday ? "Hoy" : (isYesterday ? "Ayer" : `El ${date.toLocaleDateString('es-ES')}`);
                phrases.push({ icon: 'fa-history', type: 'Partido', text: `${dateText} jugaste y el marcador fue ${res || 'ajustado'}. ¡Sigue así!` });
            }

            // Phrase 2: Weather (Actually checking global weather if on-site)
            const weather = window.weeklyWeather?.daily?.weather_code?.[0];
            const isSoleado = !weather || weather === 0;
            phrases.push({ icon: isSoleado ? 'fa-sun' : 'fa-cloud', type: 'Clima', text: isSoleado ? "Hoy hace un día soleado, ideal para el pádel." : "Parece que el cielo está cubierto, ¡perfecto para jugar en indoor!" });

            // Phrase 3: Next Match (Check Apoing or Upcoming)
            const hasApoing = !!user.apoingCalendarUrl;
            if (hasApoing) {
                phrases.push({ icon: 'fa-calendar-check', type: 'Agenda', text: "Tienes reservas en Apoing detectadas. ¡Prepárate para el próximo reto!" });
            }

            // Phrase 4: Progression
            phrases.push({ icon: 'fa-chart-line', type: 'Progreso', text: `Tu nivel actual es ${Number(user.nivel || 2.5).toFixed(2)}. Sigue entrenando para subir de división.` });

            // Combine with AI recs
            const allPhrases = [...phrases, ...finalRecs].filter(Boolean);
            
            let currentIdx = 0;
            const updateTicker = () => {
                const r = allPhrases[currentIdx];
                if (!r) return;
                auto.innerHTML = `
                    <div class="automation-card animate-fade-in" style="min-width: 100%;">
                        <div class="auto-icon"><i class="fas ${r.icon || 'fa-robot'}"></i></div>
                        <div class="flex-col">
                            <span class="text-[8px] font-black tracking-widest uppercase text-primary mb-1">${(r.type || 'AI').toUpperCase()}</span>
                            <p class="text-[11px] text-white font-bold leading-tight">${r.text}</p>
                        </div>
                    </div>
                `;
                currentIdx = (currentIdx + 1) % allPhrases.length;
            };

            if (window.__ai_ticker_interval) clearInterval(window.__ai_ticker_interval);
            updateTicker();
            window.__ai_ticker_interval = setInterval(updateTicker, 8000);
        }
      } catch(e) { console.error("AI Unified Error", e); }
  }

  function setupStatInteractions() {
    const bind = (id, title, msg) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.style.cursor = 'pointer';
        el.onclick = () => showVisualBreakdown(title, msg);
    };

    bind('profile-stat-level', 'Fórmula de Nivel', 'Calculado basándose en ELO: (ELO-1000)/400 + 2.5. Se pondera por dificultad del rival.');
    bind('profile-stat-points', 'Puntos Ranking', 'Puntos ELO acumulados. Suman por victorias, restan por derrotas considerando el ELO esperado.');
    bind('profile-stat-streak', 'Efecto Racha', 'Ratio de victorias recientes. Activa multiplicadores x1.25 (3), x1.6 (6), x2.5 (10).');
  }

  function showVisualBreakdown(title, content) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:320px; border: 1px solid rgba(255,255,255,0.1)">
            <div class="modal-header border-b border-white/10 p-4">
                <span class="text-xs font-black text-primary uppercase">${title}</span>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="p-5">
                <p class="text-sm text-white/80 leading-relaxed">${content}</p>
                <div class="mt-4 p-3 bg-white/5 rounded-xl border border-white/5 text-[10px] text-muted italic">
                    <i class="fas fa-info-circle mr-1"></i> Estos valores se actualizan en tiempo real tras cada partido.
                </div>
            </div>
        </div>
    `;
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  // Window Exports for HTML interactions
  window.openGearModal = () => document.getElementById("modal-gear")?.classList.add("active");
  
  window.savePala = async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    const marca = document.getElementById("gear-marca").value;
    const modelo = document.getElementById("gear-modelo").value;
    if(!marca || !modelo) return showToast("Error", "Datos incompletos", "error");
    
    const newPala = { marca, modelo, matchesUsed: 0, createdAt: new Date().toISOString() };
    try {
        showToast("Guardando...", "Registrando pala en tu inventario.", "info");
        const updated = [...(userData.palas || []), newPala];
        await updateDocument("usuarios", currentUser.uid, { palas: updated });
        document.getElementById("modal-gear").classList.remove("active");
        showToast("Éxito", "Pala añadida", "success");
    } catch(e) { showToast("Error", "Fallo al guardar", "error"); }
  };

  window.removePala = async (idx) => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    if (!(await confirmProfileAction({
      title: "Eliminar pala",
      message: "Se borrara esta pala de tu inventario.",
      confirmLabel: "Eliminar",
      danger: true,
    }))) return;
    try {
        showToast("Eliminando...", "Actualizando inventario.", "info");
        const updated = [...(userData.palas || [])];
        updated.splice(idx, 1);
        await updateDocument("usuarios", currentUser.uid, { palas: updated });
        showToast("Inventario", "Pala eliminada correctamente.", "success");
    } catch(e) { showToast("Error", "Fallo al eliminar", "error"); }
  };

  window.loadRivalAnalysis = async (rivalId) => {
    const dashboard = document.getElementById('rival-intel-dashboard');
    if(!dashboard) return;
    
    dashboard.innerHTML = '<div class="py-10 center"><div class="spinner-neon"></div></div>';
    
    try {
        const rival = await getDocument('usuarios', rivalId);
        const { RivalIntelligence } = await import('./rival-intelligence.js');
        const { comparePlayers } = await import('./modules/player-comparator.js');
        
        // Parallel Data Fetching
        const [amSnap, reSnap, comparison] = await Promise.all([
             window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", profileUid))),
             window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", profileUid))),
             comparePlayers(profileUid, rivalId)
        ]);

        const matches = [...amSnap.docs, ...reSnap.docs].filter(m => m.data().jugadores?.includes(rivalId)).map(d => d.data());
        const intel = RivalIntelligence.parseMatches(profileUid, rivalId, matches);
        
        // Power Difference Calculation
        let powerVisual = "";
        let compareMetrics = "";
        if (comparison) {
             const p1 = comparison.powerLevel.p1; // Me
             const p2 = comparison.powerLevel.p2; // Rival
             const diff = p1 - p2;
             const color = diff > 0 ? "text-sport-green" : (diff < 0 ? "text-sport-red" : "text-white");
             const icon = diff > 0 ? "fa-bolt" : "fa-shield-halved";
             powerVisual = `
                <div class="p-3 bg-black/40 rounded-xl border border-white/5 mb-2 flex-between">
                    <span class="text-[9px] font-black uppercase text-muted tracking-widest">POWER LEVEL</span>
                    <div class="flex-row gap-4 items-center">
                        <span class="text-xs font-black text-white opacity-50">YO: ${Math.round(p1)}</span>
                        <div class="h-4 w-[1px] bg-white/10"></div>
                        <span class="text-xs font-black ${color}"><i class="fas ${icon} mr-1"></i>${Math.round(p2)}</span>
                    </div>
                </div>
             `;
             compareMetrics = `
              <div class="grid grid-cols-2 gap-2 mb-2">
                <div class="p-2 bg-white/5 rounded-xl border border-white/5"><span class="text-[8px] text-muted uppercase block">ELO</span><b class="text-[11px]">${Math.round(comparison.p1.elo || 0)} vs ${Math.round(comparison.p2.elo || 0)}</b></div>
                <div class="p-2 bg-white/5 rounded-xl border border-white/5"><span class="text-[8px] text-muted uppercase block">Percentil</span><b class="text-[11px]">Top ${comparison.p1.percentileTop}% vs Top ${comparison.p2.percentileTop}%</b></div>
                <div class="p-2 bg-white/5 rounded-xl border border-white/5"><span class="text-[8px] text-muted uppercase block">Winrate</span><b class="text-[11px]">${comparison.p1.winrate}% vs ${comparison.p2.winrate}%</b></div>
                <div class="p-2 bg-white/5 rounded-xl border border-white/5"><span class="text-[8px] text-muted uppercase block">Forma</span><b class="text-[11px]">${comparison.p1.form} vs ${comparison.p2.form}</b></div>
              </div>
             `;
        }
        
        dashboard.innerHTML = `
            <div class="flex-row items-center gap-4 mb-4">
                <img src="${rival.fotoURL || rival.fotoPerfil || `https://ui-avatars.com/api/?name=${encodeURIComponent(rival.nombreUsuario || rival.nombre || 'R')}&background=random&color=fff`}" class="w-10 h-10 rounded-full border border-primary/30">
                <div class="flex-col">
                    <span class="text-xs font-black text-white italic uppercase">${rival.nombreUsuario || rival.nombre}</span>
                    <span class="text-[8px] font-bold text-muted uppercase">Nivel ${rival.nivel || '---'}</span>
                </div>
            </div>
            
            ${powerVisual}
            ${compareMetrics}

            <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="p-3 bg-white/5 rounded-xl border border-white/5">
                    <span class="text-[8px] font-black text-muted uppercase block">Balance H2H</span>
                    <span class="text-xs font-black text-white">${intel.wins}W - ${intel.losses}L</span>
                </div>
                <div class="p-3 bg-white/5 rounded-xl border border-white/5">
                    <span class="text-[8px] font-black text-muted uppercase block">Confianza</span>
                    <span class="text-xs font-black text-sport-green">${intel.confidence}%</span>
                </div>
            </div>
            <div class="p-3 bg-primary/10 rounded-xl border border-primary/20">
                <span class="text-[8px] font-black text-primary uppercase block mb-1">Análisis Táctico</span>
                <p class="text-[10px] text-white/80 leading-tight">${intel.tacticalBrief || 'No hay suficientes datos para un perfil táctico completo.'}</p>
            </div>
        `;
    } catch(e) {
        dashboard.innerHTML = '<div class="text-[10px] text-danger">Error al cargar inteligencia.</div>';
    }
  };
  
  // Theme Manager Init
  import("./modules/theme-manager.js").then(m => m.renderThemeSelector("theme-selector-container")).catch(console.error);
  
  function setActionBusy(buttonId, busy, loadingText = '...') {
    const btn = document.getElementById(buttonId);
    if (!btn) return () => {};
    if (!busy) return () => {};
    const prevHtml = btn.innerHTML;
    btn.disabled = true;
    if (btn.classList.contains('setting-save-btn')) {
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
    } else {
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
    }
    return () => {
      btn.disabled = false;
      btn.innerHTML = prevHtml;
    };
  }

  function ensureOwnProfile() {
    if (!viewingOwnProfile) {
      showToast("Modo público", "Solo el propietario puede editar este perfil.", "warning");
      return false;
    }
    return true;
  }

  async function logOwnProfileHistory(entry = {}) {
    if (!currentUser?.uid) return;
    await addPlayerHistoryEntry({
      uid: currentUser.uid,
      tag: "Perfil",
      tone: "system",
      ...entry,
    }).catch(() => {});
  }

  // Save profile handlers
  document.getElementById("p-save-name")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    const val = document.getElementById("p-username-inp").value.trim();
    if(!val) return showToast("Error", "Nombre vacío", "error");
    const unlock = setActionBusy("p-save-name", true, "Guardando");
    try {
      showToast("Guardando...", "Actualizando tu alias de combate.", "info");
      await updateDocument("usuarios", currentUser.uid, { nombreUsuario: val, nombre: val });
      await logOwnProfileHistory({
        kind: "profile_alias_update",
        title: "Alias actualizado",
        text: `Tu nombre visible paso a ser ${val}.`,
        entityId: currentUser.uid,
      });
      showToast("Identidad", "Alias de combate actualizado", "success");
      if(document.getElementById("p-name")) document.getElementById("p-name").textContent = val.toUpperCase();
    } catch (e) {
      showToast("Error", "No se pudo actualizar el alias.", "error");
    } finally {
      unlock();
    }
  });

  document.getElementById("p-save-phone")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    const val = document.getElementById("p-phone-inp").value.trim();
    if(!val) return showToast("Error", "Teléfono vacío", "error");
    const unlock = setActionBusy("p-save-phone", true, "Guardando");
    try {
      showToast("Guardando...", "Actualizando teléfono de contacto.", "info");
      await updateDocument("usuarios", currentUser.uid, { telefono: val });
      await logOwnProfileHistory({
        kind: "profile_phone_update",
        title: "Telefono actualizado",
        text: "Se actualizo tu via principal de contacto.",
        entityId: currentUser.uid,
      });
      showToast("Enlace", "Frecuencia de contacto guardada", "success");
    } catch (e) {
      showToast("Error", "No se pudo guardar el teléfono.", "error");
    } finally {
      unlock();
    }
  });

  document.getElementById("btn-save-apoing")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    const inp = document.getElementById("apoing-url-inp");
    if (!inp) return;
    const raw = String(inp.value || "").trim();
    if (!raw) {
      return showToast("Apoing", "Introduce primero tu enlace de calendario Apoing (.ics)", "warning");
    }
    const unlock = setActionBusy("btn-save-apoing", true, "Guardando");
    try {
      const safe = raw.replace(/[\s"]/g, "");
      const isLikelyApoing = /^https:\/\/www\.apoing\.com\/calendars\/.+\.ics$/i.test(safe);
      if (!isLikelyApoing) {
        showToast("Apoing", "El enlace no parece un calendario Apoing (.ics), pero se guardará igualmente.", "warning");
      } else {
        showToast("Apoing", "Sincronizando enlace de calendario...", "info");
      }
      await updateDocument("usuarios", currentUser.uid, { apoingCalendarUrl: safe });
      apoingProfileLog("save.userDoc.ok", { uid: currentUser.uid });
      await setDoc(doc(db, "apoingCalendars", currentUser.uid), {
        uid: currentUser.uid,
        nombre: userData?.nombreUsuario || userData?.nombre || currentUser.email || "Jugador",
        email: currentUser.email || "",
        icsUrl: safe,
        active: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      apoingProfileLog("save.publicDoc.ok", {
        uid: currentUser.uid,
        urlPreview: `${safe.slice(0, 45)}...`,
      });
      try {
        localStorage.setItem(getApoingStorageKey(currentUser.uid), safe);
      } catch (_) {}
      if (userData) userData.apoingCalendarUrl = safe;
      renderApoingPreview({ ...(userData || {}), apoingCalendarUrl: safe }).catch(() => {});
      await logOwnProfileHistory({
        kind: "profile_apoing_update",
        title: "Calendario Apoing conectado",
        text: "Tu disponibilidad externa quedo enlazada al perfil.",
        entityId: currentUser.uid,
      });
      showToast("Apoing", "Enlace de calendario guardado", "success");
    } catch (e) {
      showToast("Error", "No se pudo guardar el enlace de Apoing.", "error");
    } finally {
      unlock();
    }
  });

  document.getElementById("btn-share-apoing")?.addEventListener("click", async () => {
    const inp = document.getElementById("apoing-url-inp");
    if (!inp) return;
    const url = String(inp.value || "").trim() ||
      String(userData?.apoingCalendarUrl || localStorage.getItem(getApoingStorageKey(currentUser?.uid)) || "").trim();
    if (!url) {
      showToast("Apoing", "Configura primero tu enlace de calendario.", "warning");
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Mi disponibilidad en Padel (Apoing)",
          text: "Aquí tienes mi calendario Apoing para ver mis reservas.",
          url,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("Apoing", "Enlace copiado al portapapeles", "success");
      } else {
        const tmp = document.createElement("textarea");
        tmp.value = url;
        tmp.style.position = "fixed";
        tmp.style.opacity = "0";
        document.body.appendChild(tmp);
        tmp.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(tmp);
        showToast("Apoing", "Enlace copiado (modo compatibilidad)", "success");
      }
    } catch (_) {
      showToast("Apoing", "No se pudo compartir el enlace.", "error");
    }
  });

  // --- PASSWORD CHANGE ---
  document.getElementById("btn-change-password")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    const newPass = document.getElementById("p-new-password").value;
    const confirmPass = document.getElementById("p-confirm-password").value;
    
    if (!newPass || newPass.length < 6) {
      return showToast("Error", "La contraseña debe tener mínimo 6 caracteres", "error");
    }
    if (newPass !== confirmPass) {
      return showToast("Error", "Las contraseñas no coinciden", "error");
    }

    const unlock = setActionBusy("btn-change-password", true, "Actualizando");
    try {
      showToast("Actualizando...", "Aplicando nueva contraseña.", "info");
      const { updatePassword } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js');
      await updatePassword(auth.currentUser, newPass);
      document.getElementById("p-new-password").value = "";
      document.getElementById("p-confirm-password").value = "";
      showToast("Seguridad", "Contraseña actualizada con éxito ✓", "success");
    } catch (e) {
      console.error("Password change error:", e);
      if (e.code === 'auth/requires-recent-login') {
        showToast("Reautenticación", "Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña", "warning");
      } else {
        showToast("Error", "No se pudo cambiar la contraseña: " + (e.message || "Error desconocido"), "error");
      }
    } finally {
      unlock();
    }
  });

  document.getElementById("save-address")?.addEventListener("click", async () => {
    if (!currentUser?.uid) return showToast("Sesión", "Debes iniciar sesión de nuevo.", "warning");
    if (!ensureOwnProfile()) return;
    const b = document.getElementById("addr-bloque").value;
    const pi = document.getElementById("addr-piso").value;
    const pu = document.getElementById("addr-puerta").value;
    const unlock = setActionBusy("save-address", true, "Guardando");
    try {
      showToast("Guardando...", "Actualizando dirección.", "info");
      await updateDocument("usuarios", currentUser.uid, { vivienda: { bloque: b, piso: pi, puerta: pu } });
      await logOwnProfileHistory({
        kind: "profile_address_update",
        title: "Datos de vivienda actualizados",
        text: "Se actualizaron tus datos de localizacion en la aplicacion.",
        entityId: currentUser.uid,
      });
      showToast("Ubicación", "Coordenadas guardadas", "success");
    } catch (e) {
      showToast("Error", "No se pudo guardar la dirección.", "error");
    } finally {
      unlock();
    }
  });

  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.onclick = async () => {
    if (!(await confirmProfileAction({
      title: "Cerrar sesion",
      message: "Se cerrara tu sesion en este dispositivo.",
      confirmLabel: "Salir",
      danger: true,
    }))) return;
    auth.signOut();
  };

  // Photo Upload (Enhanced Path)
  document.getElementById("upload-photo")?.addEventListener("change", async (e) => {
    if (!ensureOwnProfile()) return;
    const file = e.target.files[0];
    if (file) {
        try {
            showToast("Subiendo...", "Procesando imagen con el satélite", "info");
            const url = await uploadProfilePhoto(currentUser.uid, file);
            await updateDocument("usuarios", currentUser.uid, { fotoPerfil: url, fotoURL: url });
            await logOwnProfileHistory({
              kind: "profile_photo_update",
              title: "Imagen de perfil renovada",
              text: "Tu identidad visual en la aplicacion fue actualizada.",
              entityId: currentUser.uid,
            });
            showToast("Éxito", "Imagen actualizada", "success");
        } catch(e) { showToast("Error", "Fallo al subir", "error"); }
    }
  });

  document.getElementById("btn-open-gallery-upload")?.addEventListener("click", () => {
    if (!ensureOwnProfile()) return;
    document.getElementById("upload-gallery-photo")?.click();
  });

  document.getElementById("upload-gallery-photo")?.addEventListener("change", async (e) => {
    if (!ensureOwnProfile()) return;
    const files = Array.from(e.target.files || []).filter(Boolean).slice(0, 6);
    if (!files.length) return;
    try {
      showToast("Galeria", "Subiendo imagenes seleccionadas...", "info");
      for (const file of files) {
        const url = await uploadUserGalleryPhoto(currentUser.uid, file);
        await addDoc(collection(db, "usuarios", currentUser.uid, "gallery"), {
          uid: currentUser.uid,
          url,
          name: file.name || "imagen",
          size: Number(file.size || 0),
          visibleToAdmin: true,
          createdAt: serverTimestamp(),
        });
      }
      await loadProfileGallery(currentUser.uid);
      showToast("Galeria", "Fotos subidas y listas para revision.", "success");
    } catch (_) {
      showToast("Error", "No se pudieron subir las fotos.", "error");
    } finally {
      e.target.value = "";
    }
  });

  window.useGalleryPhotoAsProfile = async (uid, imageId) => {
    if (!ensureOwnProfile()) return;
    try {
      const snap = await getDoc(doc(db, "usuarios", uid, "gallery", imageId));
      const photo = String(snap.data()?.url || "").trim();
      if (!photo) return showToast("Galeria", "No se encontro la imagen.", "warning");
      await updateDocument("usuarios", uid, { fotoPerfil: photo, fotoURL: photo });
      await loadProfileGallery(uid);
      showToast("Perfil", "Foto aplicada al perfil.", "success");
    } catch (_) {
      showToast("Error", "No se pudo aplicar la foto.", "error");
    }
  };

  window.deleteGalleryPhoto = async (uid, imageId) => {
    if (!ensureOwnProfile()) return;
    if (!(await confirmProfileAction({
      title: "Borrar foto",
      message: "Se eliminara esta imagen de tu galeria compartida.",
      confirmLabel: "Borrar",
      danger: true,
    }))) return;
    try {
      await deleteDoc(doc(db, "usuarios", uid, "gallery", imageId));
      await loadProfileGallery(uid);
      showToast("Galeria", "Foto eliminada.", "success");
    } catch (_) {
      showToast("Error", "No se pudo borrar la foto.", "error");
    }
  };

});
