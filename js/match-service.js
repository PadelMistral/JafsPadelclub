/**
 * @file match-service.js
 * @version 19.0
 * @description Premium Match Management Service for Padeluminatis.
 * Handles match details rendering, creation, actions (join/leave/delete), and real-time chat.
 */

import { db, getDocument, subscribeDoc, auth } from "./firebase-service.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  addDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { showToast } from "./ui-core.js";
import { processMatchResults } from "./ranking-service.js";
import { sendNotification } from "./services/notifications.js";

// Global Close Utility
window.closeMatchModal = () => {
    const modal = document.getElementById('modal-match');
    if(modal) modal.classList.remove('active');
    
    // Also check for dynamic overlays
    const overlays = document.querySelectorAll('.modal-overlay.active');
    overlays.forEach(o => {
        if (o.querySelector('.modal-card') || o.querySelector('.modal-sheet')) {
            o.remove();
        }
    });
};

/**
 * Renders the detailed view of a match in a modal or container.
 * @param {HTMLElement} container - The container where the match detail will be rendered.
 * @param {string} matchId - The unique ID of the match.
 * @param {string} type - The type of match ('reto' or 'amistoso').
 * @param {Object} currentUser - The currently authenticated Firebase user.
 * @param {Object} userData - Additional user profile data from Firestore.
 */
export async function renderMatchDetail(
  container,
  matchId,
  type,
  currentUser,
  userData,
) {
  if (!container) return;
  const isReto = type ? type.toLowerCase().includes("reto") : false;
  const col = isReto ? "partidosReto" : "partidosAmistosos";

  container.innerHTML = `<div class="center py-20"><div class="spinner-galaxy"></div></div>`;

  const render = async (m) => {
    if (!m) {
      container.innerHTML =
        '<div class="center p-10 opacity-50">Partido no encontrado o cancelado.</div>';
      return;
    }

    const isPlayed = m.estado === "jugado";
    const isParticipant = m.jugadores?.includes(currentUser.uid);
    const isCreator =
      m.creador === currentUser.uid || userData?.rol === "Admin";
    const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
    const players = await Promise.all(
      [0, 1, 2, 3].map((i) => getPlayerData(m.jugadores?.[i])),
    );

    // Weather Forecast
    let weatherHtml =
      '<i class="fas fa-clock opacity-30"></i> <span class="text-[10px]">Cargando clima...</span>';
    try {
      const { getDetailedWeather } = await import("./external-data.js");
      const w = await getDetailedWeather();
      if (w && w.current) {
        const rain = w.current.rain || 0;
        const wind = w.current.wind_speed_10m || 0;
        weatherHtml = `
                    <div class="flex-row items-center gap-3">
                        <div class="flex-row items-center gap-1 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                            <i class="fas fa-wind text-cyan-400 text-[10px]"></i>
                            <span class="text-[10px] font-black text-white">${Math.round(wind)}<span class="opacity-50 ml-0.5">km/h</span></span>
                        </div>
                        <div class="flex-row items-center gap-1 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                            <i class="fas fa-droplet ${rain > 0 ? "text-blue-400" : "text-gray-500"} text-[10px]"></i>
                            <span class="text-[10px] font-black text-white">${rain}<span class="opacity-50 ml-0.5">mm</span></span>
                        </div>
                        <div class="flex-row items-center gap-1 bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                            <i class="fas fa-temperature-half text-primary text-[10px]"></i>
                            <span class="text-[10px] font-black text-white">${Math.round(w.current.temperature_2m)}°C</span>
                        </div>
                    </div>
                `;
      }
    } catch (e) {}

    // Win Forecast Logic
    const team1Avg =
      ((players[0]?.level || 2.5) + (players[1]?.level || 2.5)) / 2;
    const team2Avg =
      ((players[2]?.level || 2.5) + (players[3]?.level || 2.5)) / 2;
    const diff = team1Avg - team2Avg;
    const p1 = Math.min(Math.max(50 + diff * 20, 10), 90);
    const p2 = 100 - p1;

    const creatorSnap = await getDoc(doc(db, "usuarios", m.creador));
    const cName = creatorSnap.exists()
      ? creatorSnap.data().nombreUsuario || creatorSnap.data().nombre
      : "Jugador";

    container.innerHTML = `
        <div class="modal-header border-b border-white-05 pb-6 px-8">
            <div class="flex-col">
                <div class="flex-row items-center gap-2 mb-2">
                    <span class="type-badge-pro ${isReto ? "reto" : "amistoso"} text-[8px] px-3 py-1 rounded-full">${isReto ? "LIGA PRO" : "PARTIDA AMISTOSA"}</span>
                    <div class="pulse-dot-green"></div>
                    <span class="text-[9px] text-muted font-black uppercase tracking-[2px]">${isPlayed ? "COMBATE FINALIZADO" : "PISTA ABIERTA"}</span>
                </div>
                <h3 class="modal-title italic">${date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</h3>
                <div class="flex-row items-center gap-2 mt-2 opacity-70">
                    <i class="fas fa-clock text-primary text-[10px]"></i>
                    <span class="text-[11px] font-black text-white">${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} • MISTRAL PADEL CENTER</span>
                </div>
            </div>
            <button class="btn-close-neon" onclick="window.closeMatchModal()">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="modal-body custom-scroll p-8 pb-4">
            <!-- Forecast / Weather Section -->
            <div class="flex-row items-center justify-between mb-10 p-5 rounded-[24px] bg-white-03 border border-white-05 shadow-xl">
                ${weatherHtml}
                <div class="flex-col items-end">
                    <span class="text-[9px] text-muted font-black uppercase tracking-wider mb-1">Victoria Probable</span>
                    <span class="text-[18px] font-black text-primary glow-text">${Math.round(p1)}%</span>
                </div>
            </div>
            
            ${isPlayed && m.resultado?.sets ? `
                <div class="w-full text-center mb-10 animate-pop-in">
                    <div class="inline-block bg-white-03 border border-primary/20 p-8 rounded-[40px] backdrop-blur-2xl shadow-[0_0_40px_rgba(198,255,0,0.1)]">
                        <span class="text-6xl font-black text-white tracking-[8px] font-display">${m.resultado.sets}</span>
                        <div class="text-[10px] text-primary font-black mt-4 tracking-[6px] uppercase opacity-80">Marcador Final</div>
                    </div>
                </div>
            ` : ''}

            <div class="tennis-court-v5 shadow-2xl mb-10">
                <div class="net-line"></div>
                <div class="court-half">
                    <div class="court-slots">
                        ${renderPlayerSlot(players[0], 0, isCreator && !isPlayed, matchId, col)}
                        ${renderPlayerSlot(players[1], 1, isCreator && !isPlayed, matchId, col)}
                    </div>
                </div>
                <div class="vs-circle-v5">VS</div>
                <div class="court-half">
                     <div class="court-slots">
                        ${renderPlayerSlot(players[2], 2, isCreator && !isPlayed, matchId, col)}
                        ${renderPlayerSlot(players[3], 3, isCreator && !isPlayed, matchId, col)}
                    </div>
                </div>
            </div>

            <!-- Chat / Strategy Area -->
            <div class="bg-black/40 rounded-3xl border border-white-05 p-6 mb-10">
                <div class="flex-row items-center gap-3 mb-6 border-b border-white-05 pb-4">
                     <div class="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                     <span class="text-[10px] font-black text-white tracking-[3px] uppercase italic">Centro de Mando Táctico</span>
                </div>
                <div id="match-chat-msgs" class="chat-flow-area max-h-[160px] custom-scroll pr-3">
                    ${!isParticipant ? '<div class="chat-lock-msg py-10 text-center text-[10px] text-muted uppercase tracking-widest"><i class="fas fa-lock mr-2 block text-xl mb-3 opacity-20"></i> Canal Encriptado</div>' : ""}
                </div>
                ${
                  isParticipant && !isPlayed
                    ? `
                    <div class="flex-row gap-3 mt-6 bg-white-03 p-3 rounded-2xl border border-white-05">
                        <input type="text" id="match-chat-in" class="bg-transparent border-none text-[12px] text-white flex-1 px-3 outline-none font-bold" placeholder="Escribe un mensaje táctico...">
                        <button class="btn-close-neon sm" onclick="sendMatchChat('${matchId}', '${col}')"><i class="fas fa-paper-plane text-primary text-xs"></i></button>
                    </div>
                `
                    : ""
                }
            </div>
            
            <div class="flex-row between items-center mb-10 px-2 bg-white-03 p-4 rounded-2xl">
                 <div class="flex-row items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-slate-800 flex-center border border-white/10">
                        <i class="fas fa-user-crown text-primary text-xs"></i>
                    </div>
                    <div class="flex-col">
                        <span class="text-[9px] font-black text-muted uppercase tracking-wider">Creador del Reto</span>
                        <span class="text-[12px] font-black text-white italic">${cName.toUpperCase()}</span>
                    </div>
                 </div>
                 <i class="fas fa-shield-check text-sport-green opacity-40"></i>
            </div>
        </div>

        <div class="modal-footer p-8 pt-0">
            ${renderMatchActions(m, isParticipant, isCreator, currentUser.uid, matchId, col)}
        </div>
    `;
    if (isParticipant) initMatchChat(matchId, col);
  };

  const data = await getDocument(col, matchId);
  render(data);
  subscribeDoc(col, matchId, render);
}

/**
 * Renders the match creation form for a specific date and time.
 * @param {HTMLElement} container - Container to render the form into.
 * @param {string} dateStr - The date string for the session.
 * @param {string} hour - The hour for the session.
 * @param {Object} currentUser - The current user.
 * @param {Object} userData - user data.
 */
export async function renderCreationForm(
  container,
  dateStr,
  hour,
  currentUser,
  userData,
) {
  if (!container) return;

  container.innerHTML = `
        <div class="modal-header border-b border-white-05 pb-6 px-8">
            <div class="flex-col">
                <span class="text-[10px] font-black text-primary tracking-[4px] uppercase mb-2">SISTEMA DE PROGRAMACIÓN</span>
                <h3 class="modal-title italic">${dateStr.toUpperCase()}</h3>
                <div class="flex-row items-center gap-2 mt-2 opacity-70">
                    <i class="fas fa-calendar-check text-white text-[10px]"></i>
                    <span class="text-[11px] font-bold text-white uppercase">${hour} • MISTRAL PADEL CLUB</span>
                </div>
            </div>
            <button class="btn-close-neon" onclick="window.closeMatchModal()">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="modal-body custom-scroll p-8 pb-4">
            <!-- Parameters Preview -->
            <div class="grid grid-cols-2 gap-5 mb-10">
                <div class="bg-white-03 p-5 rounded-3xl border border-white-05">
                    <span class="block text-[9px] text-muted font-black uppercase mb-2 tracking-widest">Bloque Reservado</span>
                    <span class="text-[15px] font-black text-white">90 MINUTOS</span>
                </div>
                <div class="bg-white-03 p-5 rounded-3xl border border-white-05">
                    <span class="block text-[9px] text-muted font-black uppercase mb-2 tracking-widest">Nivel Sugerido</span>
                    <span class="text-[15px] font-black text-primary glow-text" id="lvl-preview">2.0 - 5.5</span>
                </div>
            </div>

            <!-- Match Type -->
            <div class="flex-row items-center gap-3 mb-6 px-1">
                <div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span class="text-[10px] font-black text-white italic uppercase tracking-[3px]">Protocolo de Despliegue</span>
            </div>
            <div class="grid grid-cols-2 gap-5 mb-10">
                <div id="opt-am" class="p-6 rounded-3xl border border-white-05 bg-white-03 text-center cursor-pointer transition-all active hover:bg-white/10" onclick="setMatchType('amistoso')">
                    <i class="fas fa-handshake text-2xl mb-3 block text-muted transition-colors"></i>
                    <span class="text-[11px] font-black block tracking-widest">AMISTOSO</span>
                </div>
                <div id="opt-re" class="p-6 rounded-3xl border border-white-05 bg-white-03 text-center cursor-pointer transition-all hover:bg-white/10" onclick="setMatchType('reto')">
                    <i class="fas fa-bolt-lightning text-2xl mb-3 block text-muted transition-colors"></i>
                    <span class="text-[11px] font-black block tracking-widest uppercase">Liga Pro</span>
                </div>
            </div>

            <!-- Level Restriction -->
            <div class="flex-row items-center justify-between p-6 rounded-3xl bg-white-03 border border-white-05 mb-10 shadow-lg">
                <div class="flex-col">
                    <span class="text-[12px] font-black text-white uppercase italic">Filtrado Por Nivel</span>
                    <span class="text-[10px] text-muted font-bold tracking-tight">BLOQUEAR ACCESO A OTROS RANGOS</span>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer" onchange="toggleLvlInputs(this.checked)">
                    <div class="w-12 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary shadow-glow-sm"></div>
                </label>
            </div>

            <div id="lvl-inputs-container" class="opacity-20 pointer-events-none transition-all duration-300 mb-10">
                <div class="grid grid-cols-2 gap-5">
                    <div class="bg-black/60 p-4 rounded-2xl border border-white-05">
                        <span class="text-[9px] text-primary font-black block mb-2 tracking-widest">MIN RANGO</span>
                        <input type="number" id="inp-min-lvl" value="2.0" step="0.1" class="bg-transparent border-none text-white font-black text-xl w-full outline-none">
                    </div>
                    <div class="bg-black/60 p-4 rounded-2xl border border-white-05">
                        <span class="text-[9px] text-primary font-black block mb-2 tracking-widest">MAX RANGO</span>
                        <input type="number" id="inp-max-lvl" value="5.5" step="0.1" class="bg-transparent border-none text-white font-black text-xl w-full outline-none">
                    </div>
                </div>
            </div>

            <!-- Alineación -->
            <div class="flex-row items-center gap-2 mb-4">
                <div class="w-1.5 h-1.5 bg-accent rounded-full"></div>
                <span class="text-[10px] font-black text-white italic uppercase tracking-widest">Distribución Tactica</span>
            </div>
            <div class="tennis-court-v5 shadow-xl mb-6">
                <div class="net-line"></div>
                <div class="court-half">
                    <div class="court-slots">
                        <div class="player-slot-court filled" id="slot-0-wrap">
                            <img src="${userData.fotoPerfil || userData.fotoURL || "./imagenes/Logojafs.png"}" class="w-full h-full rounded-full object-cover">
                        </div>
                        <div class="player-slot-court empty" id="slot-1-wrap" onclick="window.openPlayerSelector('NEW', 'amistoso', {idx:1})">
                            <i class="fas fa-plus opacity-30"></i>
                        </div>
                    </div>
                </div>
                <div class="vs-circle-v5 sm">VS</div>
                <div class="court-half">
                    <div class="court-slots">
                        <div class="player-slot-court empty" id="slot-2-wrap" onclick="window.openPlayerSelector('NEW', 'amistoso', {idx:2})">
                            <i class="fas fa-plus opacity-30"></i>
                        </div>
                        <div class="player-slot-court empty" id="slot-3-wrap" onclick="window.openPlayerSelector('NEW', 'amistoso', {idx:3})">
                            <i class="fas fa-plus opacity-30"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="modal-footer p-8 pt-0">
            <button class="btn-sync-premium shadow-glow" onclick="executeCreateMatch('${dateStr}', '${hour}')">
                <i class="fas fa-rocket mr-2"></i>
                ACTIVAR RESERVA CENTRAL
            </button>
        </div>
    `;

  // Fetch weather for creation form background preview
  setTimeout(async () => {
    try {
      const { getDetailedWeather } = await import("./external-data.js");
      const w = await getDetailedWeather();
      if (w && w.current) {
        const rain = w.current.rain || 0;
        const weatherBox = document.getElementById("creation-weather");
        if (weatherBox) {
          weatherBox.innerHTML = `
                        <div class="flex-row items-center gap-1 text-[10px] font-bold text-muted">
                            <i class="fas fa-droplet ${rain > 0 ? "text-blue-400" : ""}"></i>
                            <span>${rain}mm</span>
                            <span class="mx-1">•</span>
                            <i class="fas fa-temperature-half text-primary"></i>
                            <span>${Math.round(w.current.temperature_2m)}°C</span>
                        </div>
                    `;
        }
      }
    } catch (e) {}
  }, 100);

  // Temp state for creation
  window._creationType = "amistoso";
  window._initialJugadores = [currentUser.uid, null, null, null];

  /** Internal Match Type Toggle */
  window.setMatchType = (t) => {
    window._creationType = t;
    document
      .getElementById("opt-am")
      .classList.toggle("active", t === "amistoso");
    document.getElementById("opt-re").classList.toggle("active", t === "reto");
    document
      .getElementById("reto-options")
      .classList.toggle("hidden-v5", t !== "reto");
  };

  /** Internal Level Restriction Toggle */
  window.toggleLvlInputs = (on) => {
    document
      .getElementById("lvl-inputs-container")
      .classList.toggle("disabled", !on);
  };
}

/**
 * Fetches refined player data from UID.
 * @private
 */
async function getPlayerData(uid) {
  if (!uid) return null;
  if (uid.startsWith("GUEST_")) {
    const parts = uid.split("_");
    return {
      name: parts[1],
      level: parseFloat(parts[2]),
      id: uid,
      isGuest: true,
    };
  }
  const d = await getDocument("usuarios", uid);
  return d
    ? {
        name: d.nombreUsuario || d.nombre,
        photo: d.fotoPerfil || d.fotoURL,
        level: d.nivel || 2.5,
        id: uid,
      }
    : null;
}

/**
 * Renders a single player slot for the tennis court schema.
 */
function renderPlayerSlot(p, idx, canEdit, mid, col) {
  const isTeamA = idx < 2;
  const accentColor = isTeamA
    ? "rgba(0, 212, 255, 0.4)"
    : "rgba(236, 72, 153, 0.4)";
  const borderColor = isTeamA ? "var(--primary)" : "var(--secondary)";

  if (p) {
    const photo =
      p.photo || p.fotoPerfil || p.fotoURL || "./imagenes/Logojafs.png";
    return `
            <div class="player-slot-court filled animate-pop-in" 
                 onclick="${mid && !p.id.startsWith("GUEST_") ? `window.viewProfile('${p.id}')` : ""}" 
                 style="--slot-accent: ${accentColor}; --slot-border: ${borderColor}">
                <div class="p-avatar-ring">
                    <div class="p-avatar">
                        <img src="${photo}" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                </div>
                <div class="p-info-box">
                    <span class="p-name">${p.name}</span>
                    <div class="p-lvl-badge">NV. ${p.level.toFixed(1)}</div>
                </div>
                ${canEdit && idx > 0 ? `<button class="slot-remove-btn" onclick="event.stopPropagation(); executeMatchAction('remove', '${mid}', '${col}', {idx:${idx}})"><i class="fas fa-times-circle"></i></button>` : ""}
                <div class="slot-pulse"></div>
            </div>
        `;
  }

  return `
        <div class="player-slot-court empty" 
             onclick="${canEdit ? `window.openPlayerSelector('${mid}', '${col}', {idx:${idx}})` : ""}"
             style="--slot-border: rgba(255,255,255,0.1)">
            <div class="p-avatar-add">
                <i class="fas fa-plus"></i>
            </div>
            <span class="p-add-label">AÑADIR JUGADOR</span>
        </div>
    `;
}

/**
 * Determines available actions for a match.
 */
function renderMatchActions(m, isParticipant, isCreator, uid, id, col) {
  const isPlayed = m.estado === "jugado";
  
  if (isPlayed) {
    return `
        <div class="flex-row gap-2 w-full">
            <button class="btn-icon-glass py-4 flex-1 text-[10px] font-black uppercase tracking-widest" onclick="window.closeMatchModal()">Cerrar Vista</button>
            <button class="btn-primary py-4 flex-[1.5] text-[10px] font-black uppercase tracking-widest shadow-glow" onclick="window.location.href='diario.html?matchId=${id}'">
                <i class="fas fa-book-open mr-1"></i> Rellenar Diario AI
            </button>
        </div>
    `;
  }

  if (!isParticipant) {
    return `<button class="btn-primary w-full py-5 font-black text-lg shadow-glow" onclick="executeMatchAction('join', '${id}', '${col}')">
            <i class="fas fa-hand-fist mr-2"></i> UNIRSE AL PARTIDO
        </button>`;
  }

  return `
        <div class="flex-row gap-2 w-full">
            <button class="btn-icon-glass py-4 flex-1 text-[10px] font-black uppercase tracking-widest" onclick="executeMatchAction('leave', '${id}', '${col}')">Abandonar</button>
            ${isCreator ? `<button class="btn-icon-glass py-4 flex-1 text-[10px] font-black uppercase tracking-widest text-red-500 border-red-500/20" onclick="executeMatchAction('delete', '${id}', '${col}')">Cancelar</button>` : ""}
        </div>
        ${m.jugadores?.length === 4 ? `<button class="btn-primary w-full mt-3 py-4 font-black shadow-glow" onclick="openResultForm('${id}', '${col}')">ANOTAR RESULTADO FINAL</button>` : ""}
    `;
}

/**
 * Creates match in Firestore.
 */
window.executeCreateMatch = async (dateStr, hour) => {
  const minInput = document.getElementById("inp-min-lvl");
  const maxInput = document.getElementById("inp-max-lvl");
  const min = minInput ? parseFloat(minInput.value) : 2.0;
  const max = maxInput ? parseFloat(maxInput.value) : 5.5;

  const type = window._creationType || "amistoso";
  const betInput = document.getElementById("inp-bet");
  const bet = type === "reto" && betInput ? parseInt(betInput.value || 0) : 0;
  const col = type === "reto" ? "partidosReto" : "partidosAmistosos";

  const jugs = (window._initialJugadores || [auth.currentUser.uid]).filter(
    (id) => id !== null,
  );
  const matchDate = new Date(`${dateStr}T${hour}`);

  try {
    await addDoc(collection(db, col), {
      creador: auth.currentUser.uid,
      fecha: matchDate,
      jugadores: jugs,
      restriccionNivel: { min, max },
      familyPointsBet: bet,
      estado: "abierto",
      timestamp: serverTimestamp(),
    });

    // Notify added players
    const others = jugs.filter(
      (id) => id !== auth.currentUser.uid && !id.startsWith("GUEST_"),
    );
    if (others.length > 0) {
      await sendNotification(
        others,
        "¡Padeluminatis!",
        `Te han incluido en un partido el ${matchDate.toLocaleDateString()}`,
        "match_join",
        "calendario.html",
      );
    }

    showToast("¡HECHO!", "Reserva confirmada con éxito", "success");
    window.closeMatchModal?.() ||
      document.getElementById("modal-match")?.classList.remove("active");
  } catch (e) {
    showToast("ERROR", "No se pudo crear el partido", "error");
  }
};

/**
 * Universal action handler for match interactions.
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
    if (action === "join") {
      if (jugs.length >= 4)
        return showToast("COMPLETO", "No quedan plazas", "warning");
      const d = await getDoc(doc(db, "usuarios", user.uid));
      const uLvl = d.data().nivel || 2.5;

      if (
        m.restriccionNivel &&
        (uLvl < m.restriccionNivel.min || uLvl > m.restriccionNivel.max)
      ) {
        return showToast(
          "NIVEL",
          "No cumples el requisito de rango para esta pista",
          "warning",
        );
      }

      jugs.push(user.uid);
      await updateDoc(ref, { jugadores: jugs });
      await sendNotification(
        m.creador,
        "Nuevo Padelero",
        `${d.data().nombreUsuario || "Alguien"} se ha unido a tu pista`,
        "match_join",
        "calendario.html",
      );
      showToast("UNIDO", "Ya estás en la pista", "success");
    } else if (action === "leave") {
      jugs = jugs.filter((uid) => uid !== user.uid);
      if (jugs.length === 0) {
        await deleteDoc(ref);
      } else {
        await updateDoc(ref, { jugadores: jugs, creador: jugs[0] });
        const others = jugs.filter((uid) => !uid.startsWith("GUEST_"));
        await sendNotification(
          others,
          "Baja en el equipo",
          `Un jugador ha dejado la partida del ${matchDate.toLocaleTimeString()}`,
          "warning",
          "calendario.html",
        );
      }
      showToast("SALIDO", "Has dejado el partido", "info");
    } else if (action === "delete") {
      if (confirm("¿Seguro que quieres anular esta reserva?")) {
        const others = jugs.filter(
          (uid) => uid !== user.uid && !uid.startsWith("GUEST_"),
        );
        await sendNotification(
          others,
          "Pista Cancelada",
          `El partido del ${matchDate.toLocaleDateString()} ha sido anulado por el creador`,
          "warning",
          "calendario.html",
        );
        await deleteDoc(ref);
        showToast("ELIMINADO", "Reserva cancelada correctamente", "warning");
      }
    } else if (action === "remove") {
      const removedUid = jugs[extra.idx];
      jugs.splice(extra.idx, 1);
      await updateDoc(ref, { jugadores: jugs });
      if (removedUid && !removedUid.startsWith("GUEST_")) {
        await sendNotification(
          removedUid,
          "Retirado",
          `Has sido retirado del partido del ${matchDate.toLocaleTimeString()}`,
          "warning",
        );
      }
    } else if (action === "add") {
      jugs.push(extra.uid);
      await updateDoc(ref, { jugadores: jugs });
      if (!extra.uid.startsWith("GUEST_")) {
        await sendNotification(
          extra.uid,
          "¡A Jugar!",
          `Te han incluido en un partido para el ${matchDate.toLocaleDateString()}`,
          "match_join",
          "calendario.html",
        );
      }
    }
  } catch (e) {
    console.error(e);
    showToast("ERROR", "Acción fallida", "error");
  }
};

/**
 * Initializes real-time chat for a match.
 */
async function initMatchChat(id, col) {
  const box = document.getElementById("match-chat-msgs");
  if (!box) return;
  const q = query(
    collection(db, col, id, "chat"),
    orderBy("timestamp", "asc"),
    limit(30),
  );
  onSnapshot(q, async (snap) => {
    const msgs = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const sender = await getPlayerName(data.uid);
        const isMe = data.uid === auth.currentUser?.uid;
        return `
                <div class="chat-msg-row ${isMe ? "mine" : "theirs"} animate-fade-in">
                    <div class="flex-row gap-1 mb-0.5">
                         <span class="text-[8px] font-black uppercase ${isMe ? "text-primary" : "text-scnd"}">${sender}</span>
                    </div>
                    <div class="chat-bubble">
                        ${data.text}
                    </div>
                </div>
            `;
      }),
    );
    box.innerHTML =
      msgs.length > 0
        ? msgs.join("")
        : '<div class="center opacity-20 text-[10px] py-10">Sin mensajes aún</div>';
    box.scrollTop = box.scrollHeight;
  });
}

/**
 * Sends message to match chat.
 */
window.sendMatchChat = async (id, col) => {
  const inp = document.getElementById("match-chat-in");
  const text = inp.value.trim();
  if (!text || !auth.currentUser) return;
  await addDoc(collection(db, col, id, "chat"), {
    uid: auth.currentUser.uid,
    text,
    timestamp: serverTimestamp(),
  });
  inp.value = "";
};

/**
 * Private Player Name Getter.
 */
async function getPlayerName(uid) {
  if (!uid) return "Anónimo";
  if (uid.startsWith("GUEST_")) return uid.split("_")[1];
  const d = await getDocument("usuarios", uid);
  return d?.nombreUsuario || d?.nombre || "Jugador";
}

/** Close match modal */
window.closeMatchModal = () =>
  document.getElementById("modal-match")?.classList.remove("active");

/** Opens and handles score input form */
window.openResultForm = async (id, col) => {
  const area = document.getElementById("match-detail-area");
  if (!area) return;

  const match = await getDocument(col, id);
  const players = match?.jugadores?.filter(p => p) || [];
  
  if (players.length < 4) {
    return showToast("Bloqueado", "Se requieren 4 jugadores para cerrar el acta. Añade invitados si es necesario.", "warning");
  }

  area.innerHTML = `
        <div class="p-6 animate-up max-w-sm mx-auto">
            <h3 class="font-black text-white text-xl mb-6 italic uppercase">Anotar Resultado</h3>
            <div class="flex-col gap-4 mb-8">
                ${[1, 2, 3]
                  .map(
                    (i) => `
                    <div class="flex-row between items-center bg-black/30 p-4 rounded-3xl border border-white/5" id="set-row-${i}">
                        <span class="text-[10px] font-black text-primary">SET ${i}</span>
                        <div class="flex-row gap-2">
                             <input type="number" id="s${i}-1" class="sport-input w-12 p-3 text-center font-black rounded-xl" placeholder="0" onchange="checkSets()">
                             <input type="number" id="s${i}-2" class="sport-input w-12 p-3 text-center font-black rounded-xl" placeholder="0" onchange="checkSets()">
                        </div>
                    </div>
                `,
                  )
                  .join("")}
            </div>
            <button class="btn-primary w-full py-5 font-black text-sm rounded-3xl" id="btn-save-res">REGISTRAR EN EL RANKING</button>
        </div>
    `;

  window.checkSets = () => {
    const s1_1 = parseInt(document.getElementById("s1-1").value) || 0;
    const s1_2 = parseInt(document.getElementById("s1-2").value) || 0;
    const s2_1 = parseInt(document.getElementById("s2-1").value) || 0;
    const s2_2 = parseInt(document.getElementById("s2-2").value) || 0;

    const w1 = s1_1 > s1_2 ? 1 : s1_2 > s1_1 ? 2 : 0;
    const w2 = s2_1 > s2_2 ? 1 : s2_2 > s2_1 ? 2 : 0;

    const row3 = document.getElementById("set-row-3");
    if (row3) {
      if (w1 !== 0 && w1 === w2) {
        row3.style.opacity = "0.2";
        row3.style.pointerEvents = "none";
        document.getElementById("s3-1").value = "";
        document.getElementById("s3-2").value = "";
      } else {
        row3.style.opacity = "1";
        row3.style.pointerEvents = "auto";
      }
    }
  };

  document.getElementById("btn-save-res").onclick = async () => {
    const res = [];
    for (let i = 1; i <= 3; i++) {
      const i1 = document.getElementById(`s${i}-1`);
      const i2 = document.getElementById(`s${i}-2`);
      if (i1 && i2 && i1.value !== "" && i2.value !== "") {
        res.push(`${i1.value}-${i2.value}`);
      }
    }

    if (res.length < 2)
      return showToast("Error", "Debes anotar al menos 2 sets", "warning");

    try {
      // Show processing state
      const btn = document.getElementById("btn-save-res");
      btn.textContent = "PROCESANDO GALAXIA...";
      btn.disabled = true;

      const resultStr = res.join(" ");

      // 1) Guardar resultado y marcar como jugado
      await updateDoc(doc(db, col, id), {
        resultado: { sets: resultStr },
        estado: "jugado",
      });

      // 2) Actualizar ranking y nivel
      const rankingResult = await processMatchResults(id, col, resultStr);

      if (rankingResult && rankingResult.success) {
         // Find My Impact
         const myChange = rankingResult.changes.find(c => c.uid === auth.currentUser.uid);
         const pointsMsg = myChange 
             ? `<div class="flex-col items-center gap-2 mb-4 animate-pop-in">
                  <span class="text-xs font-bold text-muted uppercase">IMPACTO ELO</span>
                  <div class="flex-row items-baseline gap-1">
                      <span class="text-4xl font-black ${myChange.won ? 'text-sport-green' : 'text-sport-red'}">${myChange.delta > 0 ? '+' : ''}${myChange.delta}</span>
                      <span class="text-xs font-bold text-white">PTS</span>
                  </div>
                  <span class="text-[10px] text-muted uppercase tracking-widest">${myChange.won ? 'VICTORIA' : 'DERROTA'}</span>
                </div>`
             : '';

         // Create Impact Modal Content
         const area = document.getElementById("match-detail-area");
         if (area) {
             area.innerHTML = `
                <div class="flex-col items-center justify-center py-10 animate-up text-center">
                    <div class="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mb-6 shadow-glow">
                        <i class="fas fa-check text-2xl text-white"></i>
                    </div>
                    <h2 class="text-2xl font-black text-white italic uppercase mb-2">¡PARTIDO REGISTRADO!</h2>
                    <span class="text-xs text-muted mb-8 max-w-[200px]">Los datos han sido sincronizados con el servidor central.</span>
                    
                    ${pointsMsg}

                    <div class="w-full bg-white/5 border border-white/10 rounded-2xl p-4 mb-6">
                        <span class="block text-[10px] font-bold text-primary uppercase tracking-widest mb-2">PRÓXIMO PASO</span>
                        <p class="text-xs text-secondary mb-4">Registra tus sensaciones en el Diario Táctico para mejorar tu juego.</p>
                        <button class="btn-primary w-full py-4 font-black" onclick="window.location.href='diario.html?matchId=${id}'">
                            <i class="fas fa-book-open mr-2"></i> IR AL DIARIO
                        </button>
                    </div>

                    <button class="text-xs font-bold text-muted underline" onclick="window.closeMatchModal()">CERRAR Y VOLVER</button>
                </div>
             `;
         }
      } else {
          showToast("Aviso", "Resultado guardado, pero hubo un error calculando puntos.", "warning");
          window.closeMatchModal();
      }

    } catch (e) {
      console.error(e);
      showToast("Fallo", "No se pudo conectar con el servidor", "error");
      const btn = document.getElementById("btn-save-res");
      if(btn) {
          btn.textContent = "REINTENTAR";
          btn.disabled = false;
      }
    }
  };
};


/** Opens the player selector popup */
window.openPlayerSelector = async (mid, col, extra = {}) => {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active z-[1000]";
  overlay.innerHTML = `
        <div class="modal-sheet rounded-t-3xl p-6 bg-cosmic border-t border-white/10">
            <div class="flex-row between mb-6">
                <h3 class="font-black text-white italic">BUSCAR JUGADOR</h3>
                <button class="nav-arrow text-xl" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="flex-col gap-4 max-h-[50vh] overflow-y-auto mb-6" id="player-list-area">
                <div class="center py-10"><div class="spinner-galaxy"></div></div>
            </div>
            <div class="h-px bg-white/5 my-4"></div>
            <div class="flex-col gap-3">
                <span class="text-[10px] font-black text-scnd uppercase tracking-widest">Invitado Externo</span>
                <div class="flex-row gap-2">
                    <input type="text" id="guest-name" class="sport-input p-3 flex-1 rounded-xl" placeholder="Nombre completo">
                    <input type="number" id="guest-lvl" class="sport-input p-3 w-20 text-center rounded-xl" value="2.5" step="0.1">
                    <button class="btn-primary p-3 w-12 rounded-xl" onclick="addGuest('${mid}','${col}',${extra.idx})"><i class="fas fa-plus"></i></button>
                </div>
            </div>
        </div>
    `;
  document.body.appendChild(overlay);

  const users = await getDocs(
    query(collection(db, "usuarios"), orderBy("nombreUsuario", "asc")),
  );
  const list = document.getElementById("player-list-area");
  if (list) {
    list.innerHTML = users.docs
      .map((d) => {
        const u = d.data();
        const photo = u.fotoPerfil || u.fotoURL || "./imagenes/Logojafs.png";
        return `
                <div class="u-item-list-v5" 
                     onclick="selectPlayer('${mid}','${col}','${d.id}','${u.nombreUsuario || u.nombre}',${extra.idx})">
                    <div class="u-item-left">
                        <div class="u-avatar-v5"><img src="${photo}"></div>
                        <div class="flex-col text-left">
                            <span class="u-name-v5">${u.nombreUsuario || u.nombre}</span>
                            <span class="u-lvl-v5">NV. ${(u.nivel || 2.5).toFixed(1)}</span>
                        </div>
                    </div>
                    <div class="u-add-btn"><i class="fas fa-plus"></i></div>
                </div>
            `;
      })
      .join("");
  }

  /** Inner selection logic */
  window.selectPlayer = async (m, c, uid, name, idx) => {
    if (m === "NEW") {
      window._initialJugadores[idx] = uid;
      const wrap = document.getElementById(`slot-${idx}-wrap`);
      if (wrap) {
        const pData = await getPlayerData(uid);
        wrap.innerHTML = renderPlayerSlot(pData, idx, true, null, null);
        wrap.classList.add("active");
      }
      overlay.remove();
    } else {
      await window.executeMatchAction("add", m, c, { uid });
      overlay.remove();
    }
  };

  /** Guest logic */
  window.addGuest = async (m, c, idx) => {
    const nameInput = document.getElementById("guest-name");
    const lvlInput = document.getElementById("guest-lvl");
    const name = nameInput ? nameInput.value.trim() : "";
    const lvl = lvlInput ? lvlInput.value : "2.5";

    if (!name) return showToast("Error", "Nombre obligatorio", "warning");
    const guestId = `GUEST_${name}_${lvl}_${Date.now()}`;

    if (m === "NEW") {
      window._initialJugadores[idx] = guestId;
      const wrap = document.getElementById(`slot-${idx}-wrap`);
      if (wrap) {
        const pData = await getPlayerData(guestId);
        wrap.innerHTML = renderPlayerSlot(pData, idx, true, null, null);
        wrap.classList.add("active");
      }
      overlay.remove();
    } else {
      await window.executeMatchAction("add", m, c, { uid: guestId });
      overlay.remove();
    }
  };
};
