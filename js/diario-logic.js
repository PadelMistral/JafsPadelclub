// diario-logic.js - Premium Diary V9.0 (Advanced Data & Wizard)
import {
  auth,
  db,
  subscribeDoc,
  updateDocument,
  getDocument,
} from "./firebase-service.js";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { getDetailedWeather } from "./external-data.js";

initAppUI("profile");

document.addEventListener("DOMContentLoaded", async () => {
  let currentStep = 1;
  const totalSteps = 5;
  let currentUser = null;
  let userData = null;
  let wizardData = {};
  let entryMode = "match";

  function syncEntryModeUI() {
    const matchBlock = document.getElementById("match-selector-block");
    const linkedInfo = document.getElementById("linked-match-info");
    const modeBtns = document.querySelectorAll(
      "#entry-mode-selector .seg-node-v9",
    );

    modeBtns.forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.val === entryMode),
    );
    if (matchBlock) matchBlock.classList.toggle("hidden", entryMode === "note");
    if (linkedInfo && entryMode === "note") linkedInfo.classList.add("hidden");

    if (entryMode === "note") {
      const hiddenMatch = document.getElementById("inp-match-id");
      const selector = document.getElementById("inp-match-selector");
      const typeSel = document.getElementById("inp-tipo");
      if (hiddenMatch) hiddenMatch.value = "";
      if (selector) selector.value = "";
      if (typeSel) typeSel.value = "Entrenamiento";
    }
  }

  // --- WIZARD LOGIC ---
  window.openWizard = (matchId = null) => {
    const modal = document.getElementById("modal-entry");
    modal.classList.add("active");
    currentStep = 1;
    entryMode = "match";
    updateWizardUI();
    loadAvailableMatches(); // Always try to load played matches
    syncEntryModeUI();
    if (matchId) loadLinkedMatch(matchId);
  };

  window.closeWizard = () => {
    document.getElementById("modal-entry").classList.remove("active");
  };

  window.unlinkMatch = () => {
    const hiddenMatch = document.getElementById("inp-match-id");
    const selector = document.getElementById("inp-match-selector");
    const linkedInfo = document.getElementById("linked-match-info");
    if (hiddenMatch) hiddenMatch.value = "";
    if (selector) selector.value = "";
    if (linkedInfo) linkedInfo.classList.add("hidden");
  };

  // --- DETAILS MODAL ---
  window.showEntryDetails = (entryId) => {
    const entry = userData.diario.find((e) => e.id === entryId);
    if (!entry) return;

    const date = new Date(entry.fecha);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay active";
    overlay.style.zIndex = "11000";

    overlay.innerHTML = `
            <div class="modal-card glass-strong animate-up p-0 overflow-hidden" style="max-width:420px; border-radius: 30px !important;">
                <div class="modal-header relative overflow-hidden p-6">
                    <div class="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-50"></div>
                    <div class="relative z-10 flex-col">
                        <span class="text-[9px] font-black text-primary tracking-[4px] uppercase mb-1">Análisis Táctico</span>
                        <h2 class="text-2xl font-black italic text-white leading-none">${date.toLocaleDateString("es-ES", { day: "numeric", month: "long" }).toUpperCase()}</h2>
                        <span class="text-[10px] font-bold text-muted mt-2 uppercase">${entry.tipo} | ${entry.posicion.toUpperCase()} | ${entry.hora.toUpperCase()}</span>
                    </div>
                    <button class="close-btn absolute top-6 right-6" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="modal-body custom-scroll p-6">
                    <!-- Stats Grid -->
                    <div class="grid grid-cols-2 gap-4 mb-6">
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col center">
                            <span class="text-xs font-black text-sport-green">${entry.stats?.winners || 0}</span>
                            <span class="text-[8px] font-bold text-muted uppercase tracking-widest mt-1">WINNERS</span>
                        </div>
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5 flex-col center">
                            <span class="text-xs font-black text-sport-red">${entry.stats?.ue || 0}</span>
                            <span class="text-[8px] font-bold text-muted uppercase tracking-widest mt-1">ERRORES</span>
                        </div>
                    </div>

                    <!-- Tactical Insights -->
                    <div class="flex-col gap-4 mb-6">
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h4 class="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Clave del Partido</h4>
                            <p class="text-xs text-white/80 italic">"${entry.tactica?.clave || "No registrada"}"</p>
                        </div>
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h4 class="text-[9px] font-black text-sport-red uppercase tracking-widest mb-2">Daño Recibido</h4>
                            <p class="text-xs text-white/80">${entry.tactica?.dañoRecibido || "N/A"}</p>
                        </div>
                        <div class="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h4 class="text-[9px] font-black text-sport-green uppercase tracking-widest mb-2">Daño Infligido</h4>
                            <p class="text-xs text-white/80">${entry.tactica?.dañoInfligido || "N/A"}</p>
                        </div>
                    </div>

                    <!-- Mood & Biometrics -->
                    <div class="p-5 bg-gradient-to-br from-primary/5 to-transparent rounded-3xl border border-primary/10">
                        <div class="flex-row between items-center mb-4">
                            <span class="text-[9px] font-black text-white/40 uppercase tracking-widest">Estado Biométrico</span>
                            <span class="badge-premium-v7 sm neutral" style="font-size: 8px;">${entry.biometria?.mood?.toUpperCase()}</span>
                        </div>
                        <div class="flex-row gap-3">
                             <div class="flex-1 flex-col center p-2 bg-black/20 rounded-xl">
                                <span class="text-sm font-black text-white">${entry.biometria?.fisico}/10</span>
                                <span class="text-[7px] text-muted font-bold uppercase mt-1">Físico</span>
                             </div>
                             <div class="flex-1 flex-col center p-2 bg-black/20 rounded-xl">
                                <span class="text-sm font-black text-white">${entry.biometria?.mental}/10</span>
                                <span class="text-[7px] text-muted font-bold uppercase mt-1">Mental</span>
                             </div>
                             <div class="flex-1 flex-col center p-2 bg-black/20 rounded-xl">
                                <span class="text-sm font-black text-white">${entry.biometria?.confianza}/10</span>
                                <span class="text-[7px] text-muted font-bold uppercase mt-1">Confianza</span>
                             </div>
                        </div>
                    </div>

                    <!-- Notes -->
                    ${
                      (entry.memoryNote || entry.tactica?.notas)
                        ? `
                        <div class="mt-6 p-4 bg-primary/5 rounded-2xl border border-primary/10">
                            <h4 class="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Recordatorio Personal</h4>
                            <p class="text-xs text-white/80 leading-relaxed">${entry.memoryNote || "Sin recuerdo personal"}</p>
                            ${entry.tactica?.notas ? `<p class="text-xs text-white/65 leading-relaxed mt-3 border-t border-white/10 pt-3">${entry.tactica.notas}</p>` : ""}
                        </div>
                    `
                        : ""
                    }
                </div>
                
                <div class="p-6 bg-black/20 border-t border-white/5 flex-row center">
                    <button class="btn btn-primary btn-sm w-full" onclick="this.closest('.modal-overlay').remove()">CERRAR ANÁLISIS</button>
                </div>
            </div>
        `;
    document.body.appendChild(overlay);
  };

  window.wizardNext = async () => {
    // Validation for step 1
    if (currentStep === 1) {
      if (entryMode !== "note") {
        const mId =
          document.getElementById("inp-match-id").value ||
          document.getElementById("inp-match-selector").value;
        if (!mId) {
          showToast(
            "ACCIÓN REQUERIDA",
            "Debes seleccionar un partido completado para crear un reporte.",
            "warning",
          );
          return;
        }

        // Verify match is played
        try {
          const match =
            (await getDocument("partidosReto", mId)) ||
            (await getDocument("partidosAmistosos", mId));
          if (!match || !match.resultado) {
            showToast(
              "PARTIDO PENDIENTE",
              "El partido seleccionado aún no tiene resultado registrado. Juega primero, analiza después.",
              "warning",
            );
            return;
          }
        } catch (e) {
          showToast(
            "ERROR",
            "No se pudo verificar el estado del partido.",
            "error",
          );
          return;
        }
      }
    }

    if (currentStep < totalSteps) {
      currentStep++;
      updateWizardUI();
    } else {
      await saveEntry();
    }
  };

  window.wizardPrev = () => {
    if (currentStep > 1) {
      currentStep--;
      updateWizardUI();
    }
  };

  function updateWizardUI() {
    // Hide all steps
    document
      .querySelectorAll(".wizard-step")
      .forEach((el) => el.classList.remove("active"));
    // Show current
    document.getElementById(`step-${currentStep}`).classList.add("active");

    // Update Progress Bar
    for (let i = 1; i <= totalSteps; i++) {
      const bar = document.getElementById(`wb-${i}`);
      if (i <= currentStep) bar.classList.add("active");
      else bar.classList.remove("active");
    }

    // Update Buttons
    const btnPrev = document.getElementById("btn-prev");
    const btnNext = document.getElementById("btn-next");
    const nextText = document.getElementById("btn-next-text");
    const nextIcon = document.getElementById("btn-next-icon");
    const title = document.getElementById("wizard-title");

    if (currentStep === 1) {
      btnPrev.style.display = "none";
      title.textContent = "CONTEXTO GLOBAL";
    } else {
      btnPrev.style.display = "block";
      if (currentStep === 2) title.textContent = "ALINEACIÓN TÁCTICA";
      if (currentStep === 3) title.textContent = "MÉTRICAS DE RENDIMIENTO";
      if (currentStep === 4) title.textContent = "BIOMETRÍA Y EMOCIÓN";
      if (currentStep === 5) title.textContent = "ANÁLISIS FINAL";
    }

    if (currentStep === totalSteps) {
      nextText.textContent = "GUARDAR EN MATRIX";
      nextIcon.className = "fas fa-save";
      btnNext.classList.add("btn-finish");
    } else {
      nextText.textContent = "SIGUIENTE";
      nextIcon.className = "fas fa-chevron-right";
      btnNext.classList.remove("btn-finish");
    }
  }

  // --- FIELD HANDLERS ---

  // Segmented Buttons
  document.querySelectorAll(".segmented-v9 button").forEach((btn) => {
    btn.onclick = function () {
      this.parentElement
        .querySelectorAll("button")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
    };
  });

  document
    .querySelectorAll("#entry-mode-selector .seg-node-v9")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        entryMode = btn.dataset.val === "note" ? "note" : "match";
        syncEntryModeUI();
      });
    });

  // Mood Matrix
  document.querySelectorAll(".mood-face").forEach((btn) => {
    btn.onclick = function () {
      document
        .querySelectorAll(".mood-face")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
    };
  });

  // Range Sliders display update
  document.querySelectorAll("input[type=range]").forEach((rng) => {
    rng.addEventListener("input", function () {
      const valId = this.id.replace("inp-", "val-").replace("rng-", "val-");
      const disp = document.getElementById(valId);
      if (disp) disp.innerText = this.value;
    });
  });

  // --- DATA LOADING & AUTH ---

  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      subscribeDoc("usuarios", user.uid, (data) => {
        if (data) {
          userData = data;
          renderJournalList(data.diario || []);
          updateStats(data.diario || []);
        }
      });
    }
  });

  // Check URL params for match linking
  const urlParams = new URLSearchParams(window.location.search);
  const mId = urlParams.get("matchId");
  const openMode = urlParams.get("open");
  if (mId) {
    window.openWizard();
    loadLinkedMatch(mId);
  }
  if (openMode === "note") {
    window.openWizard();
    entryMode = "note";
    syncEntryModeUI();
  }

  async function loadAvailableMatches() {
    if (!currentUser) return;
    const selector = document.getElementById("inp-match-selector");
    if (!selector) return;

    try {
      const { query, collection, where, getDocs } =
        await import("https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js");

      // Avoid composite-index dependency: fetch by player and filter/sort client-side
      const qA = query(
        collection(db, "partidosAmistosos"),
        where("jugadores", "array-contains", currentUser.uid),
      );
      const qR = query(
        collection(db, "partidosReto"),
        where("jugadores", "array-contains", currentUser.uid),
      );

      const [snapA, snapR] = await Promise.all([getDocs(qA), getDocs(qR)]);

      let all = [
        ...snapA.docs.map((d) => ({ id: d.id, ...d.data(), type: "Amistoso" })),
        ...snapR.docs.map((d) => ({ id: d.id, ...d.data(), type: "Reto" })),
      ]
        .filter((m) => m.estado === "jugado")
        .sort(
          (a, b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0),
        );

      selector.innerHTML =
        '<option value="">-- Selecciona un partido --</option>';
      all.forEach((m) => {
        const date = m.fecha?.toDate
          ? m.fecha.toDate().toLocaleDateString()
          : "---";
        const res = m.resultado?.sets || "Sin resultado";
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${date} - ${m.type} [${res}]`;
        selector.appendChild(opt);
      });
    } catch (e) {
      console.error("Error loading matches for diary:", e);
    }
  }

  window.onMatchSelectChange = (id) => {
    if (id) loadLinkedMatch(id);
    else window.unlinkMatch();
  };

  async function loadLinkedMatch(id) {
    const match =
      (await getDocument("partidosReto", id)) ||
      (await getDocument("partidosAmistosos", id));
    if (match) {
      const infoBox = document.getElementById("linked-match-info");
      if (infoBox) {
        infoBox.classList.remove("hidden");
        document.getElementById("txt-match-date").textContent = match.fecha
          ?.toDate
          ? match.fecha.toDate().toLocaleDateString()
          : "Partido Anterior";
        document.getElementById("txt-result").textContent = match.resultado
          ? `RESULTADO: ${match.resultado.sets}`
          : "PENDIENTE";
        document.getElementById("inp-match-id").value = id;

        // Pre-fill context if available
        if (match.surface) {
          document.querySelectorAll("#surface-selector button").forEach((b) => {
            if (b.dataset.val === match.surface) b.click();
          });
        }

        // Pre-fill players & Render evaluation grid
        if (match.jugadores) {
          const myIdx = match.jugadores.indexOf(currentUser.uid);
          if (myIdx !== -1) {
            const partnerIdx =
              myIdx < 2 ? (myIdx === 0 ? 1 : 0) : myIdx === 2 ? 3 : 2;
            const partId = match.jugadores[partnerIdx];
            const rivalsIds = myIdx < 2 ? match.jugadores.slice(2, 4) : match.jugadores.slice(0, 2);
            
            // Render Evaluator Steps
            renderPlayerEvaluations(match.jugadores, currentUser.uid);

            if (partId) {
              getDocument("usuarios", partId).then((u) => {
                if (u)
                  document.getElementById("inp-partner").value =
                    u.nombreUsuario || u.nombre;
              });
            }
          }
        }
      }
    }
  }

  async function renderPlayerEvaluations(uids, myUid) {
      const container = document.getElementById("player-eval-container");
      if (!container) return;

      container.innerHTML = '<div class="center py-10"><i class="fas fa-circle-notch fa-spin text-primary"></i></div>';

      try {
          const players = await Promise.all(uids.map(async (uid) => {
              if (!uid) return { id: null, name: "Invitado", isMe: false };
              if (uid.startsWith('GUEST_')) return { id: uid, name: uid.split('_')[1], isMe: false };
              if (uid === myUid) return { id: uid, name: "Yo (Mismo)", isMe: true };
              const u = await getDocument('usuarios', uid);
              return { id: uid, name: u?.nombreUsuario || "Jugador", isMe: false };
          }));

          container.innerHTML = players.map((p, idx) => `
              <div class="p-5 bg-white/5 rounded-3xl border border-white/10 player-eval-card" data-uid="${p.id}">
                  <div class="flex-row between items-center mb-4">
                      <div class="flex-row items-center gap-2">
                          <div class="w-8 h-8 rounded-full bg-primary/20 flex center text-[10px] font-black">${p.name[0]}</div>
                          <span class="text-xs font-black uppercase text-white">${p.name} ${p.isMe ? '<span class="text-[8px] text-primary">(ME)</span>' : ''}</span>
                      </div>
                      <label class="flex-row items-center gap-2 cursor-pointer">
                          <span class="text-[8px] font-bold text-muted uppercase">MVP</span>
                          <input type="radio" name="match-mvp" value="${p.id}" class="mvp-radio">
                      </label>
                  </div>
                  
                  <div class="grid grid-cols-2 gap-4">
                      <div class="flex-col gap-1">
                          <div class="flex-row between text-[8px] font-black text-muted uppercase">
                              <span>Rendimiento</span>
                              <span class="val-rend-${idx}">5</span>
                          </div>
                          <input type="range" class="eval-range performance" min="1" max="10" value="5" oninput="this.previousElementSibling.children[1].innerText=this.value">
                      </div>
                      <div class="flex-col gap-1">
                          <div class="flex-row between text-[8px] font-black text-muted uppercase">
                              <span>Control (Liderazgo)</span>
                              <span class="val-cont-${idx}">5</span>
                          </div>
                          <input type="range" class="eval-range control" min="1" max="10" value="5" oninput="this.previousElementSibling.children[1].innerText=this.value">
                      </div>
                      <div class="flex-col gap-1">
                          <div class="flex-row between text-[8px] font-black text-muted uppercase">
                              <span>Relajación (Flojera)</span>
                              <span class="val-floj-${idx}">3</span>
                          </div>
                          <input type="range" class="eval-range weakness" min="1" max="10" value="3" oninput="this.previousElementSibling.children[1].innerText=this.value">
                      </div>
                      <div class="flex-col gap-1">
                          <div class="flex-row between text-[8px] font-black text-muted uppercase">
                              <span>Incomodidad</span>
                              <span class="val-inco-${idx}">2</span>
                          </div>
                          <input type="range" class="eval-range discomfort" min="1" max="10" value="2" oninput="this.previousElementSibling.children[1].innerText=this.value">
                      </div>
                  </div>
              </div>
          `).join('');

      } catch (e) {
          container.innerHTML = '<div class="center py-10 text-xs text-red-500">Error al cargar jugadores</div>';
      }
  }

  function getTeamIndexByResult(resultSets) {
    const sets = String(resultSets || "").trim().split(/\s+/).filter(Boolean);
    let t1 = 0;
    let t2 = 0;
    sets.forEach((setScore) => {
      const parts = setScore.split("-").map(Number);
      if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
      if (parts[0] > parts[1]) t1 += 1;
      else if (parts[1] > parts[0]) t2 += 1;
    });
    if (t1 === t2) return 0;
    return t1 > t2 ? 1 : 2;
  }

  function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
  }

  function computeDiaryPeerBonuses(entry, matchData, authorUid) {
    const bonuses = [];
    const players = matchData?.jugadores || [];
    if (!players.length || !Array.isArray(entry.evaluations)) return bonuses;

    const myIdx = players.indexOf(authorUid);
    if (myIdx === -1) return bonuses;
    const isAuthorTeam1 = myIdx < 2;
    const winnerTeam = getTeamIndexByResult(matchData?.resultado?.sets || "");

    entry.evaluations.forEach((ev) => {
      const uid = ev?.uid;
      if (!uid || uid === authorUid || String(uid).startsWith("GUEST_")) return;

      const pIdx = players.indexOf(uid);
      const sameTeam = pIdx !== -1 ? (pIdx < 2) === isAuthorTeam1 : false;
      const isMvp = ev.isMvp === true;

      let delta = 0;
      delta += (Number(ev.performance || 5) - 5) * 0.8;
      delta += (Number(ev.control || 5) - 5) * 0.45;
      delta -= Math.max(0, Number(ev.weakness || 0) - 6) * 0.3;
      delta -= Math.max(0, Number(ev.discomfort || 0) - 6) * 0.2;

      if (isMvp) delta += 4;
      if (!sameTeam && Number(ev.performance || 0) >= 7) delta += 1;

      if (winnerTeam && pIdx !== -1) {
        const playerTeam = pIdx < 2 ? 1 : 2;
        if (winnerTeam === playerTeam) delta += 0.6;
      }

      const finalDelta = clampInt(delta, -2, 6);
      if (finalDelta === 0) return;

      bonuses.push({
        uid,
        diff: finalDelta,
        reason: isMvp
          ? "MVP del partido (evaluacion de diario)"
          : sameTeam
            ? "Evaluacion positiva de companero"
            : "Evaluacion tactica de rival",
      });
    });

    const dedup = new Map();
    bonuses.forEach((b) => dedup.set(b.uid, b));
    return Array.from(dedup.values());
  }

  function showDiaryRecapModal(entry) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay active";
    overlay.style.zIndex = "12000";

    const shotKeys = ["serve", "volley", "bandeja", "vibora", "smash", "lob"];
    const avg = shotKeys.reduce((acc, k) => acc + Number(entry?.shots?.[k] || 0), 0) / shotKeys.length;
    const memory = entry?.memoryNote || entry?.tactica?.notas || "Sin nota personal en esta entrada.";

    overlay.innerHTML = `
      <div class="modal-card glass-strong animate-up p-0 overflow-hidden" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title font-black italic tracking-widest">RECORDATORIO DEL PARTIDO</span>
          <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body custom-scroll p-5 flex-col gap-4">
          <div class="p-4 rounded-2xl border border-white/10 bg-white/5">
            <span class="text-[9px] uppercase tracking-widest text-muted font-black">Resumen IA</span>
            <p class="text-xs text-white mt-2">${entry.aiSummary || "Sin resumen"}</p>
          </div>
          <div class="p-4 rounded-2xl border border-white/10 bg-white/5">
            <span class="text-[9px] uppercase tracking-widest text-muted font-black">Tu recuerdo personal</span>
            <p class="text-xs text-white/90 mt-2">${memory}</p>
          </div>
          <div class="p-4 rounded-2xl border border-white/10 bg-black/30 flex-row between items-center">
            <span class="text-[10px] font-black uppercase text-muted">Sensacion media en golpes</span>
            <span class="text-lg font-black text-primary">${avg.toFixed(1)}/10</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }
  // --- SAVE LOGIC ---

  async function saveEntry() {
    if (!currentUser) return;

    const btn = document.getElementById("btn-next");
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    showToast("Guardando...", "Sincronizando entrada del diario.", "info");

    try {
      // 1. Gather Data
      const selectedMatchId =
        entryMode === "match"
          ? document.getElementById("inp-match-id").value || null
          : null;

      const entry = {
        id: Date.now().toString(),
        fecha: new Date().toISOString(),
        matchId: selectedMatchId,
        sessionMode: entryMode,

        // Context
        tipo:
          entryMode === "note"
            ? "Nota Libre"
            : document.getElementById("inp-tipo")?.value || "Sesión",
        hora: document.getElementById("inp-hora")?.value || "N/A",
        surface:
          document.querySelector("#surface-selector .active")?.dataset?.val ||
          "indoor",
        pista: document.getElementById("inp-court-type")?.value || "cristal",

        // Alignment
        posicion:
          document.querySelector("#pos-selector .active")?.dataset?.val ||
          "reves",
        rivalStyle: Array.from(
          document.querySelectorAll("#rival-tags .active"),
        ).map((el) => el.innerText),
        partner: document.getElementById("inp-partner")?.value || "",
        rivals: [
          document.getElementById("inp-rival1")?.value || "",
          document.getElementById("inp-rival2")?.value || "",
        ],

        // Player Evaluations (Private)
        evaluations: Array.from(document.querySelectorAll('.player-eval-card')).map(card => ({
            uid: card.dataset.uid,
            performance: parseInt(card.querySelector('.performance').value),
            control: parseInt(card.querySelector('.control').value),
            weakness: parseInt(card.querySelector('.weakness').value),
            discomfort: parseInt(card.querySelector('.discomfort').value),
            isMvp: card.querySelector('.mvp-radio').checked
        })),
        mvpId: document.querySelector('input[name="match-mvp"]:checked')?.value || null,

        // Technical Sensations by shot (1-10)
        shots: {
          serve: parseInt(document.getElementById("inp-shot-serve")?.value || 5),
          volley: parseInt(document.getElementById("inp-shot-volley")?.value || 5),
          bandeja: parseInt(document.getElementById("inp-shot-bandeja")?.value || 5),
          vibora: parseInt(document.getElementById("inp-shot-vibora")?.value || 5),
          smash: parseInt(document.getElementById("inp-shot-smash")?.value || 5),
          lob: parseInt(document.getElementById("inp-shot-lob")?.value || 5),
        },

        // Legacy/Basic Stats (Derived)
        stats: {
          netPoints: parseInt(document.getElementById("rng-net")?.value || 50),
          backPoints: parseInt(document.getElementById("rng-back")?.value || 50),
        },

        // Biometrics & Mood
        biometria: {
          fisico: parseInt(document.getElementById("inp-fisico").value),
          mental: parseInt(document.getElementById("inp-mental").value),
          confianza: parseInt(document.getElementById("inp-confianza").value),
          mood:
            document.querySelector("#mood-box .active")?.dataset.mood ||
            "Normal",
        },

        // Analysis
        tactica: {
          clave: document.getElementById("inp-key-moment").value,
          dañoRecibido: document.getElementById("inp-damage-received").value,
          dañoInfligido: document.getElementById("inp-damage-inflicted").value,
          notas: document.getElementById("entry-notes").value,
        },

        memoryNote: document.getElementById("entry-memory")?.value || "",
      };

      // 2. Weather Snapshot
      try {
        const w = await getDetailedWeather();
        if (w && w.current) {
          entry.weather = {
            temp: w.current.temperature_2m,
            rain: w.current.rain,
            wind: w.current.wind_speed_10m,
          };
        }
      } catch (e) {}

      // 3. AI Summary (Simulated for now)
      entry.aiSummary = generateSmartSummary(entry);

      // --- PHASE 3.5: PREDICTION VALIDATION & BRAIN SYNC ---
      if (entry.matchId) {
        try {
          const colName = entry.matchId.startsWith('reto') ? 'partidosReto' : 'partidosAmistosos'; 
          // Note: Since collection name is not always obvious from ID, we try both
          let mRef = doc(db, "partidosAmistosos", entry.matchId);
          let mSnap = await getDoc(mRef);
          let finalCol = "partidosAmistosos";
          
          if (!mSnap.exists()) {
            mRef = doc(db, "partidosReto", entry.matchId);
            mSnap = await getDoc(mRef);
            finalCol = "partidosReto";
          }

          if (mSnap.exists()) {
            const mData = mSnap.data();
            entry.resultSnapshot = mData.resultado || null;
            if (mData.preMatchPrediction) entry.predictionSnapshot = mData.preMatchPrediction;
            if (Array.isArray(mData.jugadores)) {
              const players = mData.jugadores.filter((id) => id && !String(id).startsWith("GUEST_"));
              const myIdx = players.indexOf(currentUser.uid);
              if (myIdx >= 0) {
                const mine = myIdx < 2 ? players.slice(0, 2) : players.slice(2, 4);
                const rivals = myIdx < 2 ? players.slice(2, 4) : players.slice(0, 2);
                entry.matchContext = {
                  allPlayerIds: players,
                  teammateIds: mine.filter((id) => id !== currentUser.uid),
                  rivalIds: rivals,
                };
              }
            }

            // CRITICAL: If the match has a result but ranking was NOT processed, trigger it now!
            if (mData.resultado?.sets && !mData.rankingProcessedAt) {
               console.log("SAFETY TRIGGER: Processing match ranking from Diary flow...");
               const { processMatchResults } = await import("./ranking-service.js");
               await processMatchResults(entry.matchId, finalCol, mData.resultado.sets);
            }
          }
        } catch (err) {
          console.warn("Prediction/Ranking sync error", err);
        }
      }

      // --- PHASE 4: Save to Firebase (Atomically via Transaction) ---
      // Notify the Brain about this subjective data
      try {
        const { AIOrchestrator } = await import("./ai-orchestrator.js");
        // Dispatch event (Async, don't block save)
        AIOrchestrator.dispatch("DIARY_SAVED", {
          uid: currentUser.uid,
          diaryEntry: entry,
        }).catch((e) => console.warn("Orchestrator sync warning:", e));
      } catch (e) {
        console.warn("Orchestrator module not found:", e);
      }

      // 4. Save to Firebase (Legacy + New System)

      // 4. Save to Firebase (Atomically via Transaction)
      const { runTransaction } = await import("https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js");
      
      await runTransaction(db, async (transaction) => {
        // --- STEP 1: READS (Must be first) ---
        const userRef = doc(db, "usuarios", currentUser.uid);
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw "User not found";

        let matchRef = null;
        let matchData = null;
        let peerSnaps = [];
        let peersToRead = [];

        const uData = userSnap.data();
        const currentJournal = uData.diario || [];
        const alreadyLoggedThisMatch = !!(entry.matchId && currentJournal.some((d) => d.matchId === entry.matchId));

        if (entry.matchId && !alreadyLoggedThisMatch) {
            const matchRefA = doc(db, "partidosAmistosos", entry.matchId);
            const matchRefR = doc(db, "partidosReto", entry.matchId);
            const matchSnapA = await transaction.get(matchRefA);
            const matchSnapR = await transaction.get(matchRefR);

            if (matchSnapA.exists()) {
                matchRef = matchRefA;
                matchData = matchSnapA.data();
            } else if (matchSnapR.exists()) {
                matchRef = matchRefR;
                matchData = matchSnapR.data();
            }

            if (matchData) {
                const diaryImpactBy = matchData.diaryImpactBy || {};
                if (!diaryImpactBy[currentUser.uid]) {
                     const peerBonuses = computeDiaryPeerBonuses(entry, matchData, currentUser.uid);
                     peersToRead = peerBonuses;
                     for (const peer of peerBonuses) {
                         const pRef = doc(db, "usuarios", peer.uid);
                         const pSnap = await transaction.get(pRef);
                         peerSnaps.push({ uid: peer.uid, snap: pSnap, bonus: peer });
                     }
                }
            }
        }

        // --- STEP 2: WRITES ---
        const bonus = alreadyLoggedThisMatch ? 0 : (entryMode === "note" ? 5 : 10);
        const currentPoints = Number(uData.puntosRanking || 1000);
        const newRankingPoints = currentPoints + bonus;

        const stats = uData.advancedStats || { matches: 0 };
        if (!alreadyLoggedThisMatch && entry.sessionMode !== "note") {
            stats.matches = (stats.matches || 0) + 1;
        } else if (!alreadyLoggedThisMatch) {
            stats.notes = (stats.notes || 0) + 1;
        }

        transaction.update(userRef, {
            diario: [...currentJournal, entry],
            puntosRanking: newRankingPoints,
            advancedStats: stats,
        });

        const logRef = doc(collection(db, "rankingLogs"));
        transaction.set(logRef, {
            uid: currentUser.uid,
            timestamp: serverTimestamp(),
            diff: bonus,
            newTotal: newRankingPoints,
            type: "DIARY_BONUS",
            reason: alreadyLoggedThisMatch
              ? "Entrada adicional del mismo partido (sin bonus duplicado)"
              : entryMode === "note"
                ? "Sincronizacion de Nota"
                : "Analisis de Partido",
            matchId: entry.matchId || null,
            details: {
              shotAverage: Number(((entry.shots?.serve + entry.shots?.volley + entry.shots?.bandeja + entry.shots?.vibora + entry.shots?.smash + entry.shots?.lob) / 6).toFixed(2)),
              mood: entry.biometria?.mood || "Normal",
            },
        });

        if (matchRef && matchData && peersToRead.length > 0) {
            const diaryImpactBy = { ...(matchData.diaryImpactBy || {}) };
            
             for (const item of peerSnaps) {
                 if (!item.snap.exists()) continue;
                 
                 const pData = item.snap.data();
                 const pRef = item.snap.ref;
                 const peerCurrent = Number(pData.puntosRanking || 1000);
                 const peerNew = Math.max(0, peerCurrent + Number(item.bonus.diff || 0));

                 transaction.update(pRef, {
                    puntosRanking: peerNew,
                    lastDiaryImpact: {
                        fromUid: currentUser.uid,
                        matchId: entry.matchId,
                        diff: Number(item.bonus.diff || 0),
                        reason: item.bonus.reason,
                        at: serverTimestamp(),
                    }
                 });

                 const peerLogRef = doc(collection(db, "rankingLogs"));
                 transaction.set(peerLogRef, {
                    uid: item.uid,
                    timestamp: serverTimestamp(),
                    diff: Number(item.bonus.diff || 0),
                    newTotal: peerNew,
                    type: "DIARY_PEER_BONUS",
                    reason: item.bonus.reason,
                    matchId: entry.matchId,
                    fromUid: currentUser.uid,
                    details: {
                        mvpId: entry.mvpId || null,
                        evaluations: entry.evaluations || [],
                    },
                 });
             }

             diaryImpactBy[currentUser.uid] = serverTimestamp();
             transaction.update(matchRef, { diaryImpactBy });
        }
      });

      // Feedback handled by submitTechnicalEntry mostly, but global toast here too
      showToast(
        "ANOTACIÓN GUARDADA",
        "Tu diario táctico se ha sincronizado correctamente.",
        "success",
      );
      window.closeWizard();
      showDiaryRecapModal(entry);
      resetWizard();
    } catch (e) {
      console.error(e);
      showToast("ERROR", "Fallo en la sincronización", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  function resetWizard() {
    currentStep = 1;
    entryMode = "match";
    syncEntryModeUI();
    document.getElementById("inp-key-moment").value = "";
    document.getElementById("inp-damage-received").value = "";
    document.getElementById("inp-damage-inflicted").value = "";
    document.getElementById("entry-notes").value = "";
    const memoryEl = document.getElementById("entry-memory");
    if (memoryEl) memoryEl.value = "";
    document.getElementById("inp-match-id").value = "";
    document.getElementById("inp-match-selector").value = "";

    ["serve", "volley", "bandeja", "vibora", "smash", "lob"].forEach((k) => {
      const input = document.getElementById(`inp-shot-${k}`);
      const val = document.getElementById(`val-shot-${k}`);
      if (input) input.value = "5";
      if (val) val.innerText = "5";
    });
  }

  // --- RENDER JOURNAL LIST ---
  function renderJournalList(entries) {
    const list = document.getElementById("journal-list");
    if (!list) return;

    if (entries.length === 0) {
      list.innerHTML = `<div class="opacity-30 text-center py-10 font-mono text-xs">NO DATA STREAMS FOUND</div>`;
      return;
    }

    list.innerHTML = [...entries]
      .reverse()
      .map((e) => {
        const date = new Date(e.fecha);
        const isNote = e.sessionMode === "note" || !e.matchId;
        const moodColor = {
          Frustrado: "text-red-400",
          Cansado: "text-orange-400",
          Normal: "text-gray-400",
          Motivado: "text-blue-400",
          Fluido: "text-green-400",
        }[e.biometria?.mood || "Normal"];

        return `
                <div class="journal-card-v10 animate-fade-in mb-4 cursor-pointer hover:bg-white/5 transition-all" 
                     onclick="window.showEntryDetails('${e.id}')">
                    <div class="card-header-v10 flex-row between items-center mb-3">
                        <div class="flex-col">
                            <span class="text-[9px] font-black uppercase tracking-widest text-primary">${e.tipo || "SESIÓN"}</span>
                            <span class="text-xs font-black text-white">${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>
                        </div>
                        <div class="mood-badge ${isNote ? "text-cyan-300" : moodColor} border border-white/10 px-3 py-1 rounded-full bg-black/40">
                            <span class="text-[10px] font-black uppercase">${isNote ? "NOTA" : e.biometria?.mood || "N/A"}</span>
                        </div>
                    </div>

                    ${
                      e.aiSummary
                        ? `
                        <div class="ai-insight-box mb-4 p-3 bg-white/5 rounded-xl border border-white/5">
                            <i class="fas fa-brain text-purple-400 text-[10px] mr-2"></i>
                            <span class="text-[10px] italic text-gray-300">"${e.aiSummary}"</span>
                        </div>
                    `
                        : ""
                    }

                    <div class="stat-mini-grid">
                        <div class="sm-item flex-col">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">Media golpes</span>
                            <b class="text-sport-green text-sm">${((((e.shots?.serve || 5) + (e.shots?.volley || 5) + (e.shots?.bandeja || 5) + (e.shots?.vibora || 5) + (e.shots?.smash || 5) + (e.shots?.lob || 5)) / 6).toFixed(1))}</b>
                        </div>
                        <div class="sm-item flex-col">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">MVP elegido</span>
                            <b class="text-sport-gold text-sm">${e.mvpId ? "SI" : "NO"}</b>
                        </div>
                        <div class="sm-item flex-col">
                            <span class="text-[8px] font-black text-muted uppercase tracking-widest">Posicion</span>
                            <b class="text-white text-sm">${(e.posicion || "-").toUpperCase()}</b>
                        </div>
                    </div>
                </div>
            `;
      })
      .join("");
  }

  function updateStats(entries) {
    document.getElementById("stat-entries").innerText = entries.length;
    if (userData) {
        document.getElementById("stat-streak").innerText = userData.puntosRanking || 1000;
    }
  }

  function generateSmartSummary(e) {
    // Simple rule-based generation
    const feels = e.biometria?.mood || "Normal";
    const ratio = (e.stats?.winners || 0) / (e.stats?.ue || 1);

    let txt = "";
    if (ratio > 1.5) txt += "Gran eficiencia ofensiva. ";
    else if (ratio < 0.5) txt += "Exceso de errores no forzados. ";

    if (feels === "Frustrado")
      txt += "La gestión emocional limitó el rendimiento. ";
    if (feels === "Fluido") txt += "Estado de flow alcanzado. ";

    if (e.tactica?.clave) txt += `Clave: ${e.tactica.clave}.`;

    return txt || "Sesión registrada sin incidencias mayores.";
  }

  // Export global functions
  window.showAIAnalysis = async () => {
    const { initVecinaChat, toggleChat } =
      await import("./modules/vecina-chat.js?v=6.5");
    initVecinaChat();
    toggleChat();
  };
});
