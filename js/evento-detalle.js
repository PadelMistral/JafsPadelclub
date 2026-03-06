// evento-detalle.js — Vista detallada del evento con panel organizador completo y modal para añadir jugador
import { db, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast, showSidePreferenceModal } from './ui-core.js';
import { doc, onSnapshot, collection, query, where, updateDoc, deleteDoc, getDocs, serverTimestamp, addDoc, arrayUnion, arrayRemove, increment, writeBatch } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';
import { computeGroupTable, resolveTeamById } from './event-tournament-engine.js';
import { processMatchResults } from './ranking-service.js';

initAppUI('event-detail');

const eventId = new URLSearchParams(window.location.search).get('id');
const requestedTab = new URLSearchParams(window.location.search).get('tab');
let currentUser = null;
let currentUserData = null;
let currentEvent = null;
let eventMatches = [];
let unsubMatches = null;
let myTeam = null;
let registeredUsers = [];

if (!eventId) window.location.replace('eventos.html');

document.addEventListener('DOMContentLoaded', () => {
  observerAuth(async (user) => {
    if (!user) return window.location.replace('index.html');
    currentUser = user;
    currentUserData = await getDocument('usuarios', user.uid);
    await injectHeader(currentUserData || {});
    injectNavbar('events');
    bindTabs();
    subscribeEvent();
    subscribeMatches();
    if (requestedTab) setTimeout(() => document.querySelector(`.ed-tab[data-tab="${requestedTab}"]`)?.click(), 200);
    
    await loadRegisteredUsers();
    setupAddPlayerModal();
  });
});

async function loadRegisteredUsers() {
  try {
    const snapshot = await getDocs(collection(db, 'usuarios'));
    registeredUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
  } catch (e) {
    console.error('Error cargando usuarios:', e);
  }
}

function setupAddPlayerModal() {
  const typeSelect = document.getElementById('add-player-type-detalle');
  const registeredDiv = document.getElementById('registered-player-select-detalle');
  const guestDiv = document.getElementById('guest-player-input-detalle');
  const selectUser = document.getElementById('select-registered-user-detalle');

  if (!typeSelect) return;

  if (registeredUsers.length) {
    selectUser.innerHTML = '<option value="">Selecciona un usuario</option>' + 
      registeredUsers.map(u => `<option value="${u.uid}">${u.nombreUsuario || u.nombre || u.email}</option>`).join('');
  } else {
    selectUser.innerHTML = '<option value="">No hay usuarios registrados</option>';
  }

  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'registered') {
      registeredDiv.classList.remove('hidden');
      guestDiv.classList.add('hidden');
    } else {
      registeredDiv.classList.add('hidden');
      guestDiv.classList.remove('hidden');
    }
  });

  document.getElementById('btn-confirm-add-player-detalle').addEventListener('click', () => {
    const type = typeSelect.value;
    const preference = document.getElementById('player-preference-detalle').value;
    const pairCode = document.getElementById('player-pair-code-detalle').value.trim();
    const level = parseFloat(document.getElementById('player-level-detalle').value) || 2.5;

    if (type === 'registered') {
      const selectedUid = selectUser.value;
      if (!selectedUid) {
        showToast('Debes seleccionar un usuario', 'warning');
        return;
      }
      const user = registeredUsers.find(u => u.uid === selectedUid);
      addPlayerToEvent({
        uid: user.uid,
        nombre: user.nombreUsuario || user.nombre || 'Jugador',
        nivel: user.nivel || level,
        sidePreference: preference,
        pairCode,
        inscritoEn: new Date().toISOString(),
        manual: true
      });
    } else {
      const nombre = document.getElementById('guest-name-detalle').value.trim();
      if (!nombre) {
        showToast('Debes introducir un nombre para el invitado', 'warning');
        return;
      }
      addPlayerToEvent({
        uid: `invitado_${Date.now()}`,
        nombre,
        nivel: level,
        sidePreference: preference,
        pairCode,
        inscritoEn: new Date().toISOString(),
        manual: true
      });
    }
  });
}

async function addPlayerToEvent(playerData) {
  try {
    await updateDoc(doc(db, 'eventos', eventId), {
      inscritos: arrayUnion(playerData)
    });
    showToast('Jugador añadido', playerData.nombre, 'success');
    document.getElementById('modal-add-player-detalle').classList.remove('active');
    document.getElementById('guest-name-detalle').value = '';
    document.getElementById('player-pair-code-detalle').value = '';
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
}

function canOrganizar() {
  return currentUserData?.rol === 'Admin' || 
         currentEvent?.organizadorId === currentUser?.uid ||
         (currentEvent?.coorganizadores || []).includes(currentUser?.uid);
}

function isInscribed() {
  return (currentEvent?.inscritos || []).some(i => i.uid === currentUser?.uid);
}

function subscribeEvent() {
  onSnapshot(doc(db, 'eventos', eventId), (s) => {
    if (!s.exists()) return window.location.replace('eventos.html');
    currentEvent = { id: s.id, ...s.data() };
    if (isInscribed()) {
      const teams = currentEvent.teams || [];
      myTeam = teams.find(t => t.playerUids?.includes(currentUser.uid));
      if (myTeam && !myTeam.playerNames && currentEvent.inscritos) {
        myTeam.playerNames = myTeam.playerUids.map(uid => {
          const ins = currentEvent.inscritos.find(i => i.uid === uid);
          return ins?.nombre || uid;
        });
      }
    }
    renderPage();
  });
}

function subscribeMatches() {
  if (unsubMatches) unsubMatches();
  unsubMatches = onSnapshot(query(collection(db, 'eventoPartidos'), where('eventoId', '==', eventId)), (s) => {
    eventMatches = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPane(document.querySelector('.ed-tab.active')?.dataset.tab || 'info');
  });
}

function bindTabs() {
  document.querySelectorAll('.ed-tab').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      if (tab === 'organizador' && !canOrganizar()) return;
      document.querySelectorAll('.ed-tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.ed-pane').forEach(x => x.classList.add('hidden'));
      b.classList.add('active');
      document.getElementById(`pane-${tab}`)?.classList.remove('hidden');
      renderPane(tab);
    };
  });
  if (canOrganizar()) document.getElementById('organizador-tab').style.display = 'block';
}

function renderPage() {
  const ev = currentEvent || {};
  const fmt = { league: 'Liga', knockout: 'Eliminatoria', league_knockout: 'Liga + Eliminatoria' };
  document.getElementById('ed-hero-content').innerHTML = `
    <div class="ed-badge ${ev.formato === 'knockout' ? 'knockout' : 'league'}">
      <i class="fas fa-trophy"></i> ${fmt[ev.formato] || 'Evento'}
    </div>
    <h1 class="ed-title">${ev.nombre || 'Evento'}</h1>
    <div class="ed-organizer">Organiza: ${ev.organizadorNombre || 'Club'}</div>
  `;

  const inscritos = (ev.inscritos || []).length;
  const teams = (ev.teams || []).length;
  document.getElementById('ed-stats-strip').innerHTML = `
    <div class="ed-stat-box"><span class="ed-stat-val">${inscritos}/${Number(ev.plazasMax || 16)}</span><span class="ed-stat-lbl">Inscritos</span></div>
    <div class="ed-stat-box"><span class="ed-stat-val">${teams}</span><span class="ed-stat-lbl">Equipos</span></div>
    <div class="ed-stat-box"><span class="ed-stat-val">${String(ev.estado || 'draft').toUpperCase()}</span><span class="ed-stat-lbl">Estado</span></div>
  `;

  renderActionBar();
  renderPane(document.querySelector('.ed-tab.active')?.dataset.tab || 'info');
}

function renderPane(tab) {
  const pane = document.getElementById(`pane-${tab}`);
  if (!pane || !currentEvent) return;
  if (tab === 'info') renderInfo(pane);
  else if (tab === 'clasificacion') renderClasificacion(pane);
  else if (tab === 'partidos') renderPartidos(pane);
  else if (tab === 'bracket') renderBracket(pane);
  else if (tab === 'organizador') renderOrganizador(pane);
}

function renderInfo(pane) {
  const ev = currentEvent;
  let myTeamHtml = '';
  if (myTeam) {
    const grupo = Object.entries(ev.groups || {}).find(([g, ids]) => ids.includes(myTeam.id))?.[0] || '?';
    myTeamHtml = `
      <div class="my-team-card">
        <h3><i class="fas fa-user-friends"></i> Mi equipo: ${escapeHtml(myTeam.name)}</h3>
        <p>Grupo: <strong>${grupo}</strong></p>
        <p>Jugadores: ${myTeam.playerNames?.join(' + ') || myTeam.playerUids?.map(uid => {
          const ins = ev.inscritos?.find(i => i.uid === uid);
          return ins?.nombre || uid;
        }).join(' + ')}</p>
      </div>
    `;
  }
  pane.innerHTML = `
    <div class="ed-info-card">
      ${myTeamHtml}
      <h3 class="ed-info-title"><i class="fas fa-circle-info"></i> Detalles del evento</h3>
      <p class="ed-info-text">${ev.descripcion || 'Sin descripción.'}</p>
      <div class="ed-info-grid">
        <div class="ed-info-item"><i class="fas fa-calendar"></i><div><span class="ed-info-label">Inicio</span><span class="ed-info-val">${fmtDate(ev.fechaInicio)}</span></div></div>
        <div class="ed-info-item"><i class="fas fa-hourglass-half"></i><div><span class="ed-info-label">Cierre inscripción</span><span class="ed-info-val">${fmtDate(ev.fechaInscripcion)}</span></div></div>
        <div class="ed-info-item"><i class="fas fa-user-group"></i><div><span class="ed-info-label">Modalidad</span><span class="ed-info-val">${ev.modalidad || 'parejas'}</span></div></div>
        <div class="ed-info-item"><i class="fas fa-diagram-project"></i><div><span class="ed-info-label">Formato</span><span class="ed-info-val">${ev.formato || 'league_knockout'}</span></div></div>
        ${ev.homeAway === 'double' ? `<div class="ed-info-item"><i class="fas fa-exchange-alt"></i><div><span class="ed-info-label">Ida y vuelta</span><span class="ed-info-val">Sí</span></div></div>` : ''}
      </div>
      <a class="btn-ed-primary" href="evento-sorteo.html?id=${ev.id}" style="display:inline-block; margin-top:16px;"><i class="fas fa-dice"></i> Ver sorteo</a>
    </div>`;
}

function renderClasificacion(pane) {
  const ev = currentEvent;
  const teams = ev.teams || [];
  if (!teams.length) {
    pane.innerHTML = '<div class="empty-state">No hay equipos formados aún.</div>';
    return;
  }

  const teamMap = new Map(teams.map(t => [t.id, t]));
  const cfg = { win: Number(ev.puntosVictoria || 3), draw: Number(ev.puntosEmpate || 1), loss: Number(ev.puntosDerrota || 0) };

  if (ev.formato === 'league') {
    const table = computeGroupTable(eventMatches.filter(m => m.phase === 'league'), teams, cfg);
    pane.innerHTML = tableHtml('Clasificación general', table, teamMap, myTeam);
  } else if (ev.formato === 'league_knockout') {
    const groups = ev.groups || {};
    const groupKeys = Object.keys(groups).sort();
    let html = '';
    for (const g of groupKeys) {
      const gTeams = (groups[g] || []).map(id => teamMap.get(id)).filter(Boolean);
      const table = computeGroupTable(eventMatches.filter(m => m.phase === 'group' && m.group === g), gTeams, cfg);
      html += tableHtml(`Grupo ${g}`, table, teamMap, myTeam);
    }
    pane.innerHTML = html || '<div class="empty-state">No hay grupos definidos.</div>';
  } else {
    pane.innerHTML = '<div class="empty-state">No hay clasificación para este formato.</div>';
  }
}

function tableHtml(title, rows, teamMap, myTeam) {
  return `
    <div class="ed-info-card" style="margin-bottom:12px;">
      <h3 class="ed-info-title">${title}</h3>
      <table class="ed-standing-table">
        <thead>
          <tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>Pts</th></tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => {
            const isMyTeam = myTeam && r.teamId === myTeam.id;
            return `<tr class="${isMyTeam ? 'my-team-row' : ''}">
              <td>${i+1}</td>
              <td>${escapeHtml(r.teamName)}</td>
              <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.p}</td>
              <td><strong>${r.pts}</strong></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderPartidos(pane) {
  const list = [...eventMatches].sort((a, b) => (a.phase || '').localeCompare(b.phase || '') || (a.round || 1) - (b.round || 1));
  if (!list.length) {
    pane.innerHTML = '<div class="empty-state">No hay partidos generados.</div>';
    return;
  }

  pane.innerHTML = `<div class="matches-list">${list.map(m => {
    const isMyMatch = myTeam && (m.teamAId === myTeam.id || m.teamBId === myTeam.id);
    return `
      <div class="match-card ${isMyMatch ? 'my-match' : ''}">
        <div class="match-header">${matchPhaseLabel(m)}</div>
        <div class="match-teams">
          <span class="${m.ganadorTeamId === m.teamAId ? 'winner' : ''}">${m.teamAName || 'TBD'}</span>
          <span class="vs">vs</span>
          <span class="${m.ganadorTeamId === m.teamBId ? 'winner' : ''}">${m.teamBName || 'TBD'}</span>
        </div>
        <div class="match-result">${m.resultado || 'Pendiente'}</div>
        <div class="match-date">${m.fecha ? fmtDate(m.fecha) : 'Sin fecha'}</div>
        ${canOrganizar() ? `
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn-micro" onclick="window.editarResultado('${m.id}')"><i class="fas fa-pen"></i> Resultado</button>
          <button class="btn-micro" onclick="window.reiniciarPartido('${m.id}')"><i class="fas fa-undo"></i> Reiniciar</button>
        </div>` : ''}
      </div>`;
  }).join('')}</div>`;
}

function matchPhaseLabel(m) {
  if (m.phase === 'league') return `Jornada ${m.round}`;
  if (m.phase === 'group') return `Grupo ${m.group} - J${m.round}`;
  if (m.phase === 'semi') return 'Semifinal';
  if (m.phase === 'final') return 'Final';
  if (m.phase === 'knockout') return `Ronda ${m.round}`;
  return 'Partido';
}

function renderBracket(pane) {
  const ev = currentEvent;
  const teams = ev.teams || [];
  const teamMap = new Map(teams.map(t => [t.id, t]));
  const matches = eventMatches;

  if (ev.formato === 'league') {
    pane.innerHTML = '<div class="empty-state">Este evento es de liga, no tiene bracket.</div>';
    return;
  }

  let html = '<div class="bracket-container"><div class="bracket">';

  if (ev.formato === 'league_knockout') {
    const semis = matches.filter(m => m.phase === 'semi').sort((a, b) => a.matchCode?.localeCompare(b.matchCode || ''));
    const final = matches.filter(m => m.phase === 'final');
    html += `<div class="bracket-round"><div class="bracket-round-label">Semifinales</div>`;
    semis.forEach(m => {
      const a = teamMap.get(m.teamAId)?.name || m.teamAName || 'TBD';
      const b = teamMap.get(m.teamBId)?.name || m.teamBName || 'TBD';
      html += `<div class="bracket-match"><div class="bracket-team ${m.ganadorTeamId === m.teamAId ? 'winner' : ''}">${escapeHtml(a)}</div><div class="bracket-vs">VS</div><div class="bracket-team ${m.ganadorTeamId === m.teamBId ? 'winner' : ''}">${escapeHtml(b)}</div>${m.resultado ? `<div class="bracket-result">${m.resultado}</div>` : ''}</div>`;
    });
    html += `</div><div class="bracket-round"><div class="bracket-round-label">Final</div>`;
    final.forEach(m => {
      const a = teamMap.get(m.teamAId)?.name || m.teamAName || 'Ganador SF1';
      const b = teamMap.get(m.teamBId)?.name || m.teamBName || 'Ganador SF2';
      html += `<div class="bracket-match"><div class="bracket-team ${m.ganadorTeamId === m.teamAId ? 'winner' : ''}">${escapeHtml(a)}</div><div class="bracket-vs">VS</div><div class="bracket-team ${m.ganadorTeamId === m.teamBId ? 'winner' : ''}">${escapeHtml(b)}</div>${m.resultado ? `<div class="bracket-result">${m.resultado}</div>` : ''}</div>`;
    });
    html += '</div>';
  } else {
    const rounds = [...new Set(matches.filter(m => m.phase === 'knockout').map(m => m.round))].sort((a, b) => a - b);
    rounds.forEach(r => {
      html += `<div class="bracket-round"><div class="bracket-round-label">Ronda ${r}</div>`;
      matches.filter(m => m.phase === 'knockout' && m.round === r).sort((a, b) => (a.slot || 1) - (b.slot || 1)).forEach(m => {
        const a = teamMap.get(m.teamAId)?.name || m.teamAName || 'TBD';
        const b = teamMap.get(m.teamBId)?.name || m.teamBName || 'TBD';
        html += `<div class="bracket-match"><div class="bracket-team ${m.ganadorTeamId === m.teamAId ? 'winner' : ''}">${escapeHtml(a)}</div><div class="bracket-vs">VS</div><div class="bracket-team ${m.ganadorTeamId === m.teamBId ? 'winner' : ''}">${escapeHtml(b)}</div>${m.resultado ? `<div class="bracket-result">${m.resultado}</div>` : ''}</div>`;
      });
      html += '</div>';
    });
  }
  html += '</div></div>';
  pane.innerHTML = html;
}

function renderOrganizador(pane) {
  const ev = currentEvent;
  pane.innerHTML = `
    <div class="admin-panel">
      <h3><i class="fas fa-crown"></i> Panel del organizador</h3>
      <div class="form-group">
        <label>Estado del evento</label>
        <select id="org-ev-state" class="input">
          <option value="inscripcion" ${ev.estado === 'inscripcion' ? 'selected' : ''}>Inscripción</option>
          <option value="activo" ${ev.estado === 'activo' ? 'selected' : ''}>Activo</option>
          <option value="finalizado" ${ev.estado === 'finalizado' ? 'selected' : ''}>Finalizado</option>
          <option value="cancelado" ${ev.estado === 'cancelado' ? 'selected' : ''}>Cancelado</option>
        </select>
      </div>
      <div class="form-group">
        <label>Puntos por victoria</label>
        <input type="number" id="org-pts-win" class="input" value="${ev.puntosVictoria || 3}">
      </div>
      <div class="form-group">
        <label>Formato (no editable tras inicio)</label>
        <input type="text" class="input" value="${ev.formato || 'league_knockout'}" disabled>
      </div>
      <div class="form-group">
        <label>Grupos: ${ev.groupCount || 2} | Pasan: ${ev.equiposPorGrupo || 2}</label>
      </div>
      ${ev.estado === 'inscripcion' ? `
      <div class="form-group">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-add-player-detalle').classList.add('active')">
          <i class="fas fa-user-plus"></i> Añadir jugador (registrado/invitado)
        </button>
      </div>` : ''}
      <div class="form-group">
        <button class="btn btn-warning" onclick="window.reiniciarTorneo()">
          <i class="fas fa-redo-alt"></i> Reiniciar torneo (vuelve a inscripción)
        </button>
      </div>
      <div class="form-group">
        <button class="btn btn-danger" onclick="window.deleteEvent()">
          <i class="fas fa-trash"></i> Eliminar evento
        </button>
      </div>
      <button class="btn btn-primary" onclick="window.guardarConfigOrganizador()">Guardar cambios</button>
    </div>`;
}

window.guardarConfigOrganizador = async () => {
  const estado = document.getElementById('org-ev-state').value;
  const ptsWin = Number(document.getElementById('org-pts-win').value);
  try {
    await updateDoc(doc(db, 'eventos', eventId), { estado: estado, puntosVictoria: ptsWin });
    showToast('Configuración guardada', '', 'success');
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
};

window.reiniciarTorneo = async () => {
  if (!confirm('¿Reiniciar el torneo? Se perderán todos los resultados y se volverá a estado de inscripción.')) return;
  try {
    const matchesSnap = await getDocs(query(collection(db, 'eventoPartidos'), where('eventoId', '==', eventId)));
    await Promise.all(matchesSnap.docs.map(d => deleteDoc(doc(db, 'eventoPartidos', d.id))));
    await updateDoc(doc(db, 'eventos', eventId), {
      estado: 'inscripcion',
      teams: [],
      groups: {},
      bracket: null,
      drawState: { status: 'pending', steps: [], version: 0 },
      updatedAt: serverTimestamp()
    });
    showToast('Torneo reiniciado', 'Volviendo a inscripción', 'success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
};

window.deleteEvent = async () => {
  if (!confirm('¿Eliminar evento permanentemente?')) return;
  try {
    await deleteDoc(doc(db, 'eventos', eventId));
    showToast('Evento eliminado', '', 'info');
    setTimeout(() => window.location.href = 'eventos.html', 700);
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
};

window.editarResultado = async (matchId) => {
  const match = eventMatches.find(m => m.id === matchId);
  if (!match) return;
  const nuevoResultado = prompt('Introduce el resultado (ej: 6-3 6-4):', match.resultado || '');
  if (!nuevoResultado) return;
  const ganador = prompt('¿Quién ganó? (A o B):', match.ganador === 'A' ? 'A' : (match.ganador === 'B' ? 'B' : '')).toUpperCase();
  if (ganador !== 'A' && ganador !== 'B') return showToast('Ganador inválido', 'Escribe A o B', 'warning');
  try {
    await updateDoc(doc(db, 'eventoPartidos', matchId), {
      resultado: nuevoResultado,
      ganador: ganador,
      ganadorTeamId: ganador === 'A' ? match.teamAId : match.teamBId,
      estado: 'jugado',
      updatedAt: serverTimestamp()
    });
    showToast('Resultado guardado', '', 'success');
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
};

window.reiniciarPartido = async (matchId) => {
  if (!confirm('¿Reiniciar este partido? Se borrará el resultado.')) return;
  try {
    await updateDoc(doc(db, 'eventoPartidos', matchId), {
      resultado: null,
      ganador: null,
      ganadorTeamId: null,
      estado: 'pendiente',
      updatedAt: serverTimestamp()
    });
    showToast('Partido reiniciado', '', 'info');
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
};

function renderActionBar() {
  const bar = document.getElementById('ed-action-bar');
  const content = document.getElementById('ed-action-content');
  if (!bar || !content || !currentEvent) return;

  if (currentEvent.estado === 'inscripcion' && !isInscribed()) {
    bar.classList.remove('hidden');
    content.innerHTML = `<button class="btn-ed-primary" onclick="window.inscribirseEventoED()"><i class="fas fa-bolt"></i> INSCRIBIRSE</button>`;
  } else if (isInscribed() || canOrganizar()) {
    bar.classList.remove('hidden');
    content.innerHTML = `<div class="inscribed-badge"><i class="fas fa-check-circle"></i> ${isInscribed() ? 'Inscrito' : 'Modo organizador'}</div>`;
  } else {
    bar.classList.add('hidden');
  }
}

window.inscribirseEventoED = async () => {
  if (!currentUser) { showToast('Acceso requerido', 'Inicia sesión', 'warning'); return; }
  const ev = currentEvent;
  if (!ev) return;

  if (ev.inscritos?.some(i => i.uid === currentUser.uid)) {
    showToast('Ya inscrito', 'Ya estás en este evento', 'info');
    return;
  }
  if ((ev.inscritos?.length || 0) >= (ev.plazasMax || 16)) {
    showToast('Completo', 'No quedan plazas', 'warning');
    return;
  }
  if (ev.estado !== 'inscripcion') {
    showToast('Inscripción cerrada', 'Este evento ya no acepta inscripciones.', 'warning');
    return;
  }

  const myLevel = Number(currentUserData?.nivel || 2.5);
  if (ev.nivelMin && myLevel < Number(ev.nivelMin)) {
    showToast('Nivel insuficiente', `Necesitas nivel ${ev.nivelMin} o superior`, 'warning');
    return;
  }
  if (ev.nivelMax && myLevel > Number(ev.nivelMax)) {
    showToast('Nivel superior', `Este evento es para nivel hasta ${ev.nivelMax}`, 'warning');
    return;
  }

  try {
    const pref = await showSidePreferenceModal();
    if (pref == null) return;

    let pairCode = '';
    if (ev.modalidad === 'parejas' && ev.companeroObligatorio) {
      const code = prompt('Código de pareja (igual para ambos)', 'pareja-1');
      if (code === null) return;
      pairCode = code.trim().toLowerCase();
      if (!pairCode) { showToast('Pareja', 'Debes indicar código de pareja.', 'warning'); return; }
    }

    const newInscripto = {
      uid: currentUser.uid,
      nombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Jugador',
      nivel: myLevel,
      sidePreference: pref,
      pairCode,
      inscritoEn: new Date().toISOString(),
    };

    const evRef = doc(db, 'eventos', eventId);
    await updateDoc(evRef, { inscritos: arrayUnion(newInscripto) });

    showToast('¡Inscrito!', `Te has unido a "${ev.nombre}"`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Error', 'No se pudo completar la inscripción', 'error');
  }
};

function fmtDate(d) {
  if (!d) return '-';
  const date = d.toDate ? d.toDate() : new Date(d);
  return isNaN(date) ? '-' : date.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return m;
  });
}