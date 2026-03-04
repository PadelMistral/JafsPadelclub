/* js/palas.js - Padel Lab Core V5.0 */
import { auth, db } from "./firebase-service.js";
import { initAppUI, showToast } from "./ui-core.js";
import { collection, addDoc, query } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

initAppUI("palas");

const TOP_PALAS_2026 = [
  { brand: "Bullpadel", name: "Vertex 04", power: 96, control: 84, sweet: 80, comfort: 76, hardness: 90, balance: "High", style: "ATAQUE" },
  { brand: "Bullpadel", name: "Hack 03", power: 97, control: 82, sweet: 78, comfort: 74, hardness: 92, balance: "High", style: "POTENCIA" },
  { brand: "Bullpadel", name: "Neuron", power: 88, control: 92, sweet: 90, comfort: 88, hardness: 76, balance: "Mid", style: "HIBRIDO" },
  { brand: "Bullpadel", name: "Elite W", power: 86, control: 91, sweet: 89, comfort: 90, hardness: 72, balance: "Mid", style: "CONTROL" },
  { brand: "Bullpadel", name: "Flow", power: 85, control: 90, sweet: 88, comfort: 89, hardness: 71, balance: "Mid", style: "CONTROL" },
  { brand: "Nox", name: "AT10 Genius 18K", power: 92, control: 90, sweet: 90, comfort: 84, hardness: 82, balance: "Mid", style: "HIBRIDO" },
  { brand: "Nox", name: "AT10 Genius 12K", power: 91, control: 89, sweet: 90, comfort: 86, hardness: 80, balance: "Mid", style: "HIBRIDO" },
  { brand: "Nox", name: "ML10 Pro Cup Luxury", power: 84, control: 95, sweet: 96, comfort: 93, hardness: 65, balance: "Low", style: "CONTROL" },
  { brand: "Nox", name: "TL10 Future", power: 90, control: 88, sweet: 86, comfort: 84, hardness: 81, balance: "Mid", style: "HIBRIDO" },
  { brand: "Nox", name: "Nerbo WPT", power: 95, control: 83, sweet: 79, comfort: 78, hardness: 88, balance: "High", style: "ATAQUE" },
  { brand: "Adidas", name: "Metalbone 3.3", power: 98, control: 81, sweet: 76, comfort: 72, hardness: 95, balance: "High", style: "POTENCIA" },
  { brand: "Adidas", name: "Adipower CTRL 3.3", power: 84, control: 95, sweet: 92, comfort: 90, hardness: 70, balance: "Low", style: "CONTROL" },
  { brand: "Adidas", name: "Cross It", power: 93, control: 86, sweet: 82, comfort: 80, hardness: 86, balance: "High", style: "ATAQUE" },
  { brand: "Adidas", name: "Metalbone HRD+", power: 99, control: 78, sweet: 72, comfort: 66, hardness: 98, balance: "High", style: "POTENCIA" },
  { brand: "Adidas", name: "RX Carbon", power: 82, control: 88, sweet: 90, comfort: 91, hardness: 64, balance: "Low", style: "CONTROL" },
  { brand: "Head", name: "Extreme Pro", power: 95, control: 83, sweet: 80, comfort: 79, hardness: 88, balance: "High", style: "ATAQUE" },
  { brand: "Head", name: "Speed Pro X", power: 91, control: 89, sweet: 86, comfort: 84, hardness: 82, balance: "Mid", style: "HIBRIDO" },
  { brand: "Head", name: "Delta Pro", power: 96, control: 82, sweet: 79, comfort: 76, hardness: 90, balance: "High", style: "POTENCIA" },
  { brand: "Head", name: "Gravity Pro", power: 87, control: 93, sweet: 91, comfort: 89, hardness: 72, balance: "Mid", style: "CONTROL" },
  { brand: "Head", name: "Radical Pro", power: 89, control: 90, sweet: 88, comfort: 86, hardness: 77, balance: "Mid", style: "HIBRIDO" },
  { brand: "Babolat", name: "Technical Viper", power: 97, control: 80, sweet: 75, comfort: 70, hardness: 96, balance: "High", style: "POTENCIA" },
  { brand: "Babolat", name: "Air Viper", power: 92, control: 86, sweet: 84, comfort: 82, hardness: 85, balance: "Mid", style: "ATAQUE" },
  { brand: "Babolat", name: "Counter Viper", power: 88, control: 92, sweet: 90, comfort: 88, hardness: 76, balance: "Mid", style: "CONTROL" },
  { brand: "Babolat", name: "Technical Veron", power: 91, control: 85, sweet: 83, comfort: 82, hardness: 84, balance: "High", style: "HIBRIDO" },
  { brand: "Babolat", name: "Counter Veron", power: 86, control: 90, sweet: 89, comfort: 90, hardness: 70, balance: "Low", style: "CONTROL" },
  { brand: "Siux", name: "Electra ST3", power: 94, control: 85, sweet: 82, comfort: 81, hardness: 87, balance: "High", style: "ATAQUE" },
  { brand: "Siux", name: "Fenix 4", power: 96, control: 81, sweet: 77, comfort: 74, hardness: 92, balance: "High", style: "POTENCIA" },
  { brand: "Siux", name: "Diablo Revolution", power: 90, control: 89, sweet: 88, comfort: 86, hardness: 79, balance: "Mid", style: "HIBRIDO" },
  { brand: "Siux", name: "Trilogy Control", power: 84, control: 94, sweet: 92, comfort: 91, hardness: 68, balance: "Low", style: "CONTROL" },
  { brand: "Siux", name: "Pegasus", power: 89, control: 88, sweet: 87, comfort: 86, hardness: 78, balance: "Mid", style: "HIBRIDO" },
  { brand: "StarVie", name: "Metheora Dual", power: 89, control: 92, sweet: 90, comfort: 88, hardness: 76, balance: "Mid", style: "CONTROL" },
  { brand: "StarVie", name: "Triton Pro", power: 95, control: 83, sweet: 80, comfort: 77, hardness: 89, balance: "High", style: "ATAQUE" },
  { brand: "StarVie", name: "Basalto Soft", power: 86, control: 91, sweet: 89, comfort: 90, hardness: 69, balance: "Low", style: "CONTROL" },
  { brand: "StarVie", name: "Raptor Evolution", power: 92, control: 86, sweet: 84, comfort: 82, hardness: 84, balance: "Mid", style: "HIBRIDO" },
  { brand: "StarVie", name: "Astrum Eris", power: 90, control: 88, sweet: 86, comfort: 84, hardness: 80, balance: "Mid", style: "HIBRIDO" },
  { brand: "Wilson", name: "Bela Pro V2.5", power: 95, control: 84, sweet: 81, comfort: 79, hardness: 88, balance: "High", style: "ATAQUE" },
  { brand: "Wilson", name: "Bela LT", power: 90, control: 88, sweet: 86, comfort: 86, hardness: 78, balance: "Mid", style: "HIBRIDO" },
  { brand: "Wilson", name: "Blade Pro V2", power: 91, control: 90, sweet: 87, comfort: 84, hardness: 81, balance: "Mid", style: "HIBRIDO" },
  { brand: "Wilson", name: "Ultra Elite", power: 88, control: 87, sweet: 86, comfort: 87, hardness: 75, balance: "Mid", style: "CONTROL" },
  { brand: "Wilson", name: "Carbon Force", power: 87, control: 88, sweet: 88, comfort: 88, hardness: 74, balance: "Mid", style: "CONTROL" },
  { brand: "Kuikma", name: "PR Carbon Hybrid", power: 89, control: 88, sweet: 87, comfort: 86, hardness: 78, balance: "Mid", style: "HIBRIDO" },
  { brand: "Kuikma", name: "PR 990 Power", power: 94, control: 82, sweet: 79, comfort: 78, hardness: 88, balance: "High", style: "POTENCIA" },
  { brand: "Kuikma", name: "PR 990 Precision", power: 85, control: 93, sweet: 91, comfort: 90, hardness: 68, balance: "Low", style: "CONTROL" },
  { brand: "Kuikma", name: "PR 560", power: 82, control: 86, sweet: 88, comfort: 90, hardness: 62, balance: "Low", style: "CONTROL" },
  { brand: "Kuikma", name: "LS Pro", power: 90, control: 87, sweet: 85, comfort: 83, hardness: 82, balance: "Mid", style: "HIBRIDO" },
  { brand: "Drop Shot", name: "Conqueror 12", power: 94, control: 84, sweet: 82, comfort: 80, hardness: 87, balance: "High", style: "ATAQUE" },
  { brand: "Drop Shot", name: "Explorer Pro", power: 90, control: 89, sweet: 87, comfort: 85, hardness: 80, balance: "Mid", style: "HIBRIDO" },
  { brand: "Drop Shot", name: "Canyon Pro", power: 92, control: 86, sweet: 84, comfort: 83, hardness: 83, balance: "Mid", style: "HIBRIDO" },
  { brand: "Lok", name: "Maxx Hype", power: 93, control: 85, sweet: 82, comfort: 80, hardness: 86, balance: "High", style: "ATAQUE" },
  { brand: "Oxdog", name: "Ultimate Pro", power: 91, control: 88, sweet: 86, comfort: 84, hardness: 81, balance: "Mid", style: "HIBRIDO" },
];

document.addEventListener("DOMContentLoaded", async () => {
  const s1 = document.getElementById("pala-1");
  const s2 = document.getElementById("pala-2");
  const container = document.getElementById("comparison-results");
  const modalRegister = document.getElementById("modal-register-pala");

  let allPalas = [];
  let currentUser = null;

  const toNum = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, toNum(v)));

  function normalizeBalance(raw) {
    const val = String(raw || "").toLowerCase();
    if (["low", "bajo", "control", "round", "redonda"].includes(val)) return "Low";
    if (["high", "alto", "potencia", "diamond", "diamante"].includes(val)) return "High";
    return "Mid";
  }

  function normalizePala(item, id, source = "palas") {
    const brand = String(item.brand || item.marca || "Marca").trim();
    const name = String(item.name || item.modelo || "Modelo").trim();
    const power = clamp(item.power ?? item.potencia, 40, 100);
    const control = clamp(item.control ?? item.controlPct, 40, 100);
    const sweet = clamp(item.sweet ?? item.puntoDulce ?? (power + control) / 2, 40, 100);
    const hardness = clamp(item.hardness ?? item.dureza ?? (55 + (power - control) * 0.45), 40, 100);
    const comfort = clamp(item.comfort ?? item.confort ?? (110 - hardness), 40, 100);
    const balance = normalizeBalance(item.balance || item.forma);
    const style = String(item.style || item.estilo || (power >= control ? "ATAQUE" : "CONTROL")).toUpperCase();

    return {
      id: `${source}_${id}`,
      source,
      brand,
      name,
      power: Math.round(power),
      control: Math.round(control),
      sweet: Math.round(sweet),
      comfort: Math.round(comfort),
      hardness: Math.round(hardness),
      balance,
      style,
    };
  }

  function dedupePalas(list) {
    const seen = new Set();
    return list.filter((p) => {
      const key = `${p.brand}__${p.name}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function safeCollectionDocs(colName) {
    try {
      const snap = await window.getDocsSafe(collection(db, colName));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      return [];
    }
  }

  async function seedTopCatalogIfNeeded(currentPalas) {
    if (currentPalas.length >= 45) return false;
    const existingKeys = new Set(
      currentPalas.map((p) => `${String(p.brand || p.marca || "").trim()}__${String(p.name || p.modelo || "").trim()}`.toLowerCase()),
    );

    const missing = TOP_PALAS_2026.filter((p) => {
      const key = `${p.brand}__${p.name}`.toLowerCase();
      return !existingKeys.has(key);
    });

    if (!missing.length) return false;
    for (const p of missing) {
      await addDoc(collection(db, "palas"), {
        ...p,
        source: "seed_top_2026",
        createdAt: new Date().toISOString(),
      });
    }
    return true;
  }

  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      loadPalas();
    }
  });

  async function loadPalas() {
    try {
      let rawPalas = await safeCollectionDocs("palas");
      const seeded = await seedTopCatalogIfNeeded(rawPalas);
      if (seeded) rawPalas = await safeCollectionDocs("palas");
      const rawCatalog = await safeCollectionDocs("palasCatalogo");

      const merged = [
        ...rawPalas.map((p) => normalizePala(p, p.id, "palas")),
        ...rawCatalog.map((p) => normalizePala(p, p.id, "catalogo")),
      ];

      allPalas = dedupePalas(merged).sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`, "es"));

      populateSelects();
    } catch (e) {
      console.error(e);
      container.innerHTML = `
        <div class="results-placeholder">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Error cargando palas</span>
        </div>
      `;
    }
  }

  function populateSelects() {
    if (!s1 || !s2) return;

    const defaultOption = '<option value="">Selecciona pala...</option>';
    const options = allPalas.map((p) => `<option value="${p.id}">${p.brand} - ${p.name}</option>`).join("");
    s1.innerHTML = defaultOption + options;
    s2.innerHTML = defaultOption + options;

    if (allPalas.length >= 2) {
      s1.value = allPalas[0].id;
      s2.value = allPalas[1].id;
    }

    s1.onchange = updateComparison;
    s2.onchange = updateComparison;
    updateComparison();
  }

  window.updateComparison = async () => {
    const p1 = allPalas.find((p) => p.id === s1?.value);
    const p2 = allPalas.find((p) => p.id === s2?.value);

    if (!p1 || !p2) {
      container.innerHTML = `
        <div class="results-placeholder">
          <i class="fas fa-chart-bar"></i>
          <span>Selecciona dos palas para comparar</span>
        </div>
      `;
      return;
    }

    const metrics = [
      { key: "power", label: "Potencia", icon: "fa-bolt" },
      { key: "control", label: "Control", icon: "fa-crosshairs" },
      { key: "sweet", label: "Punto Dulce", icon: "fa-bullseye" },
      { key: "hardness", label: "Dureza", icon: "fa-shield-halved" },
      { key: "comfort", label: "Confort", icon: "fa-heart" },
    ];

    const [sense1, sense2] = await Promise.all([fetchSensations(p1.name), fetchSensations(p2.name)]);

    container.innerHTML = `
      <div class="comparison-header">
        <div class="pala-header pala-a">
          <span class="pala-brand">${p1.brand}</span>
          <span class="pala-name">${p1.name}</span>
          <span class="pala-balance">${getBalanceLabel(p1.balance)}</span>
        </div>
        <div class="vs-badge">VS</div>
        <div class="pala-header pala-b">
          <span class="pala-brand">${p2.brand}</span>
          <span class="pala-name">${p2.name}</span>
          <span class="pala-balance">${getBalanceLabel(p2.balance)}</span>
        </div>
      </div>

      <div class="comparison-metrics">
        ${metrics.map((m) => `
          <div class="spec-row">
            <span class="spec-label"><i class="fas ${m.icon}"></i> ${m.label}</span>
            <div class="spec-track"><div class="spec-fill fill-a" style="width: ${p1[m.key]}%"></div></div>
            <div class="spec-values">
              <span class="spec-val val-a">${p1[m.key]}</span>
              <span class="spec-separator">-</span>
              <span class="spec-val val-b">${p2[m.key]}</span>
            </div>
            <div class="spec-track"><div class="spec-fill fill-b" style="width: ${p2[m.key]}%"></div></div>
          </div>
        `).join("")}
      </div>

      <div class="feedback-section">
        <div class="feedback-card pala-a">
          <h4 class="feedback-title"><i class="fas fa-users"></i> Comunidad</h4>
          <div class="feedback-list">
            ${sense1.length ? sense1.map((s) => `<p class="feedback-quote">"${s}"</p>`).join("") : '<span class="feedback-empty">Sin registros</span>'}
          </div>
        </div>
        <div class="feedback-card pala-b">
          <h4 class="feedback-title"><i class="fas fa-users"></i> Comunidad</h4>
          <div class="feedback-list">
            ${sense2.length ? sense2.map((s) => `<p class="feedback-quote">"${s}"</p>`).join("") : '<span class="feedback-empty">Sin registros</span>'}
          </div>
        </div>
      </div>
    `;
  };

  function getBalanceLabel(balance) {
    const labels = { Low: "Bajo", Mid: "Medio", High: "Alto" };
    return labels[balance] || String(balance || "Medio");
  }

  async function fetchSensations(palaName) {
    try {
      const snap = await window.getDocsSafe(query(collection(db, "usuarios")));
      const sens = [];
      snap.forEach((docSnap) => {
        const journal = docSnap.data()?.diario || [];
        journal.forEach((e) => {
          const byName = `${e?.pala || ""} ${e?.gear?.marca || ""} ${e?.gear?.modelo || ""}`.toLowerCase();
          const note = e?.comentarios || e?.tactica?.notas || e?.memoryNote || e?.aiSummary || "";
          if (byName.includes(String(palaName).toLowerCase()) && note) sens.push(String(note));
        });
      });
      return sens.slice(0, 3);
    } catch (e) {
      return [];
    }
  }

  window.saveNewPala = async () => {
    const name = document.getElementById("reg-pala-name")?.value.trim();
    const brand = document.getElementById("reg-pala-brand")?.value.trim();

    if (!name || !brand) {
      showToast("Nombre y marca obligatorios", "error");
      return;
    }

    const data = {
      name,
      brand,
      power: parseInt(document.getElementById("reg-pala-power")?.value || 80, 10),
      control: parseInt(document.getElementById("reg-pala-control")?.value || 80, 10),
      sweet: parseInt(document.getElementById("reg-pala-sweet")?.value || 80, 10),
      hardness: parseInt(document.getElementById("reg-pala-hardness")?.value || 70, 10),
      comfort: parseInt(document.getElementById("reg-pala-comfort")?.value || 80, 10),
      balance: document.getElementById("reg-pala-balance")?.value || "Mid",
      style: "N/A",
      createdBy: currentUser?.uid || "anonymous",
      createdAt: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, "palas"), data);
      showToast("Pala registrada", "success");
      modalRegister?.classList.remove("active");
      document.getElementById("reg-pala-name").value = "";
      document.getElementById("reg-pala-brand").value = "";
      loadPalas();
    } catch (e) {
      showToast("Error al guardar", "error");
    }
  };
});
