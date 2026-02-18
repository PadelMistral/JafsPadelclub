import { db, auth, observerAuth, getDocument } from './firebase-service.js';
import { collection, query, orderBy } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';
import { buildPlacementRanking, getPlacementMatchesCount } from './provisional-ranking-logic.js';

let canLoadData = false;

document.addEventListener('DOMContentLoaded', () => {
  initAppUI('admin');

  const refreshBtn = document.getElementById('placement-refresh-btn');
  if (refreshBtn) refreshBtn.onclick = () => loadPlacementSnapshot();

  observerAuth(async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    const me = await getDocument('usuarios', user.uid);
    const isAdmin = me?.rol === 'Admin' || user.email === 'Juanan221091@gmail.com';
    if (!isAdmin) {
      showToast('Acceso denegado', 'Solo administradores', 'error');
      setTimeout(() => {
        window.location.href = 'home.html';
      }, 1200);
      return;
    }

    canLoadData = true;
    await loadPlacementSnapshot();
  });
});

function renderSummary(rows) {
  const summaryEl = document.getElementById('placement-summary');
  if (!summaryEl) return;

  const total = rows.length;
  const provisional = rows.filter((r) => r.projection.isProvisional).length;
  const avgLevel = total
    ? (rows.reduce((acc, r) => acc + Number(r.projection.suggestedLevel || 0), 0) / total).toFixed(2)
    : '0.00';

  summaryEl.innerHTML = `
    <div class="placement-kpi">
      <span class="lbl">Usuarios</span>
      <span class="val">${total}</span>
    </div>
    <div class="placement-kpi">
      <span class="lbl">Provisionales</span>
      <span class="val">${provisional}</span>
    </div>
    <div class="placement-kpi">
      <span class="lbl">Nivel Medio IA</span>
      <span class="val">${avgLevel}</span>
    </div>
  `;
}

function renderRows(rows) {
  const listEl = document.getElementById('placement-list');
  if (!listEl) return;

  if (!rows.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-user-slash"></i>
        <span>Sin usuarios para analizar</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = rows.map((row) => {
    const u = row.user || {};
    const p = row.projection;
    const name = (u.nombreUsuario || u.nombre || 'Jugador').toUpperCase();
    const deltaPts = p.deltaPoints > 0 ? `+${p.deltaPoints}` : `${p.deltaPoints}`;
    const deltaLvl = p.deltaLevel > 0 ? `+${p.deltaLevel.toFixed(2)}` : p.deltaLevel.toFixed(2);

    return `
      <article class="placement-row">
        <div class="placement-row-head">
          <div class="flex-col">
            <span class="placement-name">#${row.suggestedRank} - ${name}</span>
            <span class="text-[9px] text-muted font-bold uppercase">${p.summary}</span>
          </div>
          <span class="placement-mode ${p.isProvisional ? 'provisional' : ''}">
            ${p.modeLabel}
          </span>
        </div>
        <div class="placement-row-grid">
          <div class="placement-cell">
            <span class="k">Nivel</span>
            <span class="v">${p.currentLevel.toFixed(2)} -> ${p.suggestedLevel.toFixed(2)} (${deltaLvl})</span>
          </div>
          <div class="placement-cell">
            <span class="k">Puntos</span>
            <span class="v">${p.currentPoints} -> ${p.suggestedPoints} (${deltaPts})</span>
          </div>
          <div class="placement-cell">
            <span class="k">Muestra</span>
            <span class="v">${p.played} PJ - ${p.wins} W - ${(p.winRate * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div class="placement-footer">
          <span>Confianza: ${p.confidence}%</span>
          <span>ID: ${u.id || '-'}</span>
        </div>
      </article>
    `;
  }).join('');
}

async function loadPlacementSnapshot() {
  if (!canLoadData) return;
  const subtitleEl = document.getElementById('placement-subtitle');
  const listEl = document.getElementById('placement-list');
  if (subtitleEl) subtitleEl.textContent = 'Actualizando datos...';
  if (listEl) {
    listEl.innerHTML = `
      <div class="loading-state small">
        <div class="spinner-neon xs"></div>
      </div>
    `;
  }

  try {
    const snap = await window.getDocsSafe(
      query(collection(db, 'usuarios'), orderBy('puntosRanking', 'desc')),
      'placement-ranking-snapshot',
    );
    const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const rows = buildPlacementRanking(users);
    renderSummary(rows);
    renderRows(rows);

    if (subtitleEl) {
      subtitleEl.textContent = `Modo prueba - ${getPlacementMatchesCount()} partidos para consolidar nivel`;
    }
  } catch (err) {
    console.error(err);
    if (subtitleEl) subtitleEl.textContent = 'Error de carga';
    if (listEl) listEl.innerHTML = '<div class="empty-state text-danger">No se pudo cargar la simulacion</div>';
  }
}

window.debugPlacementForCurrent = async () => {
  if (!auth.currentUser?.uid) return null;
  const me = await getDocument('usuarios', auth.currentUser.uid);
  return me ? buildPlacementRanking([me])[0] : null;
};

