import { db, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';

initAppUI('events');

const eventId = new URLSearchParams(window.location.search).get('id');
let currentUser = null;
let currentUserData = null;
let currentEvent = null;
let drawAnimating = false;

if (!eventId) window.location.replace('eventos.html');

document.addEventListener('DOMContentLoaded', () => {
  observerAuth(async (user) => {
    if (!user) return window.location.replace('index.html');
    currentUser = user;
    currentUserData = await getDocument('usuarios', user.uid);
    await injectHeader(currentUserData || {});
    injectNavbar('events');

    document.getElementById('btn-back-event').href = `evento-detalle.html?id=${eventId}`;
    bindActions();
    subscribeEvent();
  });
});

function bindActions() {
  const runBtn = document.getElementById('btn-run-draw');
  if (runBtn) {
    runBtn.onclick = () => {
      window.location.href = `evento-detalle.html?id=${eventId}&admin=1`;
    };
  }
}

function canAdmin(ev = {}) {
  return currentUserData?.rol === 'Admin' || ev.organizadorId === currentUser?.uid;
}

function isAllowedViewer(ev = {}) {
  if (canAdmin(ev)) return true;
  return (ev.inscritos || []).some((i) => i.uid === currentUser?.uid);
}

function subscribeEvent() {
  onSnapshot(doc(db, 'eventos', eventId), (snap) => {
    if (!snap.exists()) {
      showToast('Evento', 'No encontrado', 'error');
      setTimeout(() => window.location.href = 'eventos.html', 700);
      return;
    }
    currentEvent = { id: snap.id, ...snap.data() };
    render();
  });
}

function render() {
  const ev = currentEvent || {};
  const subtitle = document.getElementById('sorteo-subtitle');
  subtitle.textContent = ev.nombre || 'Evento';

  const runBtn = document.getElementById('btn-run-draw');
  if (runBtn) {
    runBtn.classList.toggle('hidden', !(canAdmin(ev) && ev.drawState?.status !== 'completed'));
  }

  if (!isAllowedViewer(ev)) {
    document.getElementById('draw-live').textContent = 'Debes estar inscrito para ver el sorteo.';
    return;
  }

  if (ev.drawState?.status !== 'completed') {
    document.getElementById('draw-live').textContent = 'Inscripción abierta. Esperando sorteo del organizador...';
    renderGroups(ev, []);
    renderBracket(ev, []);
    return;
  }

  const version = Number(ev.drawState?.version || 1);
  const key = `drawSeen_${ev.id}_${version}_${currentUser.uid}`;
  const seen = localStorage.getItem(key) === '1';

  if (!seen && !drawAnimating) {
    animateDraw(ev.drawState.steps || [], () => {
      localStorage.setItem(key, '1');
      renderGroups(ev, ev.teams || []);
      renderBracket(ev, ev.teams || []);
    });
  } else {
    renderSteps(ev.drawState.steps || []);
    renderGroups(ev, ev.teams || []);
    renderBracket(ev, ev.teams || []);
    document.getElementById('draw-live').textContent = 'Sorteo completado';
  }
}

async function animateDraw(steps = [], done) {
  drawAnimating = true;
  const orb = document.getElementById('draw-orb');
  const live = document.getElementById('draw-live');
  const stepsBox = document.getElementById('draw-steps');
  orb?.classList.add('spinning');
  stepsBox.innerHTML = '';

  for (const s of steps) {
    live.textContent = `Extrayendo bola ${s.order}...`;
    await delay(700);
    const row = document.createElement('div');
    row.className = 'draw-step';
    row.innerHTML = `<span>${escapeHtml(s.teamName)}</span><span class="g">Grupo ${s.group}</span>`;
    stepsBox.prepend(row);
    live.textContent = `${s.teamName} al Grupo ${s.group}`;
  }

  orb?.classList.remove('spinning');
  live.textContent = 'Sorteo completado';
  drawAnimating = false;
  done?.();
}

function renderSteps(steps = []) {
  const box = document.getElementById('draw-steps');
  box.innerHTML = steps.slice().reverse().map((s) => `<div class="draw-step"><span>${escapeHtml(s.teamName)}</span><span class="g">Grupo ${s.group}</span></div>`).join('');
}

function renderGroups(ev, teams) {
  const teamMap = new Map((teams || []).map((t) => [t.id, t]));
  ['A', 'B'].forEach((g) => {
    const wrap = document.querySelector(`#group-${g} .group-list`);
    if (!wrap) return;
    const ids = ev?.groups?.[g] || [];
    wrap.innerHTML = ids.length
      ? ids.map((id) => `<div class="group-team">${escapeHtml(teamMap.get(id)?.name || id)}</div>`).join('')
      : '<div class="group-team">Sin equipos</div>';
  });
}

function renderBracket(ev, teams) {
  const box = document.getElementById('knockout-bracket');
  const rounds = ev?.bracket?.rounds || [];
  if (!rounds.length) {
    box.innerHTML = '<div class="k-col"><h4>Semifinales</h4><div class="k-match">Pendiente de sorteo</div></div>';
    return;
  }
  const teamMap = new Map((teams || []).map((t) => [t.id, t]));

  box.innerHTML = rounds.map((round, idx) => `
    <div class="k-col">
      <h4>${idx === 0 ? 'Semifinales' : 'Final'}</h4>
      ${round.map((m) => {
        const a = m.teamAId ? (teamMap.get(m.teamAId)?.name || m.teamAId) : refLabel(m.teamARef);
        const b = m.teamBId ? (teamMap.get(m.teamBId)?.name || m.teamBId) : refLabel(m.teamBRef);
        return `<div class="k-match"><div class="k-team">${escapeHtml(a || 'TBD')}</div><div class="k-team">${escapeHtml(b || 'TBD')}</div></div>`;
      }).join('')}
    </div>
  `).join('');
}

function refLabel(ref) {
  if (!ref) return 'TBD';
  if (ref.group) return `${ref.group}${ref.pos}`;
  if (ref.from) return `Ganador ${ref.from}`;
  return 'TBD';
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function escapeHtml(raw = '') {
  return String(raw)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
