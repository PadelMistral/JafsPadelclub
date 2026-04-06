// evento-sorteo.js - Versión definitiva con carga predefinida y guardado seguro
import { db, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { doc, onSnapshot, collection, query, where, updateDoc, addDoc, deleteDoc, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';
import { buildEventTeams, generateRoundRobin, generateKnockoutTree } from './event-tournament-engine.js';

initAppUI('events');

const eventId = new URLSearchParams(window.location.search).get('id');
let currentUser = null;
let currentUserData = null;
let currentEvent = null;
let unsubEvent = null;

let drawSteps = [];
let currentStepIndex = 0;
let teams = [];
let groups = {};
let bracket = null;
let fixedPairs = [];

// Elementos DOM
const card = document.getElementById('card');
const playerNameDisplay = document.getElementById('playerNameDisplay');
const startBtn = document.getElementById('btn-start-draw');
const nextBtn = document.getElementById('btn-next-step');
const groupsContainer = document.getElementById('groups-container');
const cardContainer = document.getElementById('cardContainer');
const riggingBtn = document.getElementById('btn-rigging');
const riggingModal = document.getElementById('modal-rigging');
const rigPlayer1 = document.getElementById('rig-player1');
const rigPlayer2 = document.getElementById('rig-player2');
const rigGroup = document.getElementById('rig-group');
const addRiggedBtn = document.getElementById('btn-add-rigged-pair');
const riggedPairsList = document.getElementById('rigged-pairs-list');
const clearRiggedBtn = document.getElementById('btn-clear-rigged');
const loadPresetBtn = document.getElementById('btn-load-preset');

if (!eventId) window.location.replace('eventos.html');

// Confetti casero
function simpleConfetti({ particleCount = 50, spread = 70, origin = { y: 0.6 } } = {}) {
    for (let i = 0; i < particleCount; i++) {
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.width = '8px';
        el.style.height = '8px';
        el.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 60%)`;
        el.style.borderRadius = '50%';
        el.style.left = `${origin.x !== undefined ? origin.x * 100 : 50}%`;
        el.style.top = `${origin.y * 100}%`;
        el.style.pointerEvents = 'none';
        el.style.zIndex = '9999';
        el.style.transform = 'translate(-50%, -50%)';
        document.body.appendChild(el);

        const angle = (Math.random() - 0.5) * spread;
        const velocity = 5 + Math.random() * 5;
        const x = Math.sin(angle) * velocity;
        const y = -Math.cos(angle) * velocity - 2;
        let opacity = 1;
        const animate = () => {
            const left = parseFloat(el.style.left);
            const top = parseFloat(el.style.top);
            el.style.left = `${left + x * 0.1}%`;
            el.style.top = `${top + y * 0.1}%`;
            opacity -= 0.01;
            el.style.opacity = opacity;
            if (opacity > 0) {
                requestAnimationFrame(animate);
            } else {
                el.remove();
            }
        };
        requestAnimationFrame(animate);
    }
}
const confetti = simpleConfetti;

document.addEventListener('DOMContentLoaded', () => {
    observerAuth(async (user) => {
        if (!user) return window.location.replace('index.html');
        currentUser = user;
        currentUserData = await getDocument('usuarios', user.uid);
        await injectHeader(currentUserData || {});
        injectNavbar('events');
        subscribeEvent();

        if (startBtn) startBtn.addEventListener('click', window.iniciarSorteo);
        if (nextBtn) nextBtn.addEventListener('click', siguientePasoHandler);
        if (riggingBtn) riggingBtn.addEventListener('click', abrirModalRigging);
        if (addRiggedBtn) addRiggedBtn.addEventListener('click', addRiggedPair);
        if (clearRiggedBtn) clearRiggedBtn.addEventListener('click', clearRiggedPairs);
        if (loadPresetBtn) loadPresetBtn.addEventListener('click', cargarConfiguracionPredefinida);
    });
});

function siguientePasoHandler() {
    if (nextBtn.textContent === 'Guardar') {
        finalizarSorteo();
    } else {
        window.siguientePaso();
    }
}

function subscribeEvent() {
    unsubEvent = onSnapshot(doc(db, 'eventos', eventId), (snap) => {
        if (!snap.exists()) {
            showToast('Evento no encontrado', 'error');
            setTimeout(() => window.location.href = 'eventos.html', 700);
            return;
        }
        currentEvent = { id: snap.id, ...snap.data() };
        render();
        if (currentUserData?.rol === 'Admin' || currentEvent?.organizadorId === currentUser?.uid) {
            riggingBtn?.classList.remove('hidden');
        } else {
            riggingBtn?.classList.add('hidden');
        }
    });
}

function render() {
    const ev = currentEvent || {};
    if (ev.drawState?.status === 'completed') {
        groups = ev.groups || {};
        teams = ev.teams || [];
        renderGroupsFromData();
        startBtn?.classList.add('hidden');
        nextBtn?.classList.add('hidden');
        document.getElementById('draw-message')?.classList.remove('hidden');
    } else {
        if (groupsContainer) groupsContainer.innerHTML = '';
        startBtn?.classList.remove('hidden');
        nextBtn?.classList.add('hidden');
        document.getElementById('draw-message')?.classList.add('hidden');
    }
}

function renderGroupsFromData() {
    const groupNames = ['A', 'B', 'C', 'D'].slice(0, currentEvent?.groupCount || 2);
    if (!groupsContainer) return;
    groupsContainer.innerHTML = groupNames.map(g => `
        <div class="group-box" data-group="${g}">
            <h3>Grupo ${g}</h3>
            <div class="group-teams" id="group-${g}"></div>
        </div>
    `).join('');
    groupNames.forEach(g => {
        const container = document.getElementById(`group-${g}`);
        if (container) {
            (groups[g] || []).forEach(teamId => {
                const team = teams.find(t => t.id === teamId);
                if (team) {
                    const div = document.createElement('div');
                    div.className = 'group-team';
                    div.textContent = team.name;
                    container.appendChild(div);
                }
            });
        }
    });
}

function loadInscritosToSelects() {
    const inscritos = (currentEvent?.inscritos || []).filter(i => i.aprobado === true);
    const options = inscritos.map(ins => `<option value="${ins.uid}">${ins.nombre}</option>`).join('');
    if (rigPlayer1) rigPlayer1.innerHTML = '<option value="">Selecciona</option>' + options;
    if (rigPlayer2) rigPlayer2.innerHTML = '<option value="">Selecciona</option>' + options;
}

function updateRiggedPairsList() {
    if (!riggedPairsList) return;
    riggedPairsList.innerHTML = fixedPairs.map((pair, index) => {
        const user1 = currentEvent?.inscritos?.find(i => i.uid === pair.player1);
        const user2 = currentEvent?.inscritos?.find(i => i.uid === pair.player2);
        return `<li>
            <span>${user1?.nombre || pair.player1} + ${user2?.nombre || pair.player2} ${pair.group ? `→ Grupo ${pair.group}` : ''}</span>
            <button class="btn-micro danger" onclick="window.removeRiggedPair(${index})"><i class="fas fa-times"></i></button>
        </li>`;
    }).join('');
}

function abrirModalRigging() {
    loadInscritosToSelects();
    updateRiggedPairsList();
    riggingModal?.classList.add('active');
}

function addRiggedPair() {
    const p1 = rigPlayer1?.value;
    const p2 = rigPlayer2?.value;
    const group = rigGroup?.value;
    if (!p1 || !p2) {
        showToast('Selecciona dos jugadores', 'warning');
        return;
    }
    if (p1 === p2) {
        showToast('No puedes seleccionar el mismo jugador', 'warning');
        return;
    }
    const already = fixedPairs.some(p => p.player1 === p1 || p.player1 === p2 || p.player2 === p1 || p.player2 === p2);
    if (already) {
        showToast('Uno de los jugadores ya está en una pareja fija', 'warning');
        return;
    }
    fixedPairs.push({ player1: p1, player2: p2, group: group || null });
    updateRiggedPairsList();
    rigPlayer1.value = '';
    rigPlayer2.value = '';
    rigGroup.value = '';
}

window.removeRiggedPair = (index) => {
    fixedPairs.splice(index, 1);
    updateRiggedPairsList();
};

function clearRiggedPairs() {
    fixedPairs = [];
    updateRiggedPairsList();
}

// Configuración predefinida
const presetPairs = [
    { player1Name: 'Juan Luis de la rosa', player2Name: 'Santi', group: 'B' },
    { player1Name: 'Ángelo', player2Name: 'Manco Man', group: 'A' },
    { player1Name: 'Ja1me_05', player2Name: 'Peri', group: 'A' },
    { player1Name: 'Manu', player2Name: 'Adri', group: 'B' },
    { player1Name: 'Vissen', player2Name: 'Jose Manuel', group: 'B' },
    { player1Name: 'David A6', player2Name: 'José J', group: 'A' },
    { player1Name: 'Juanan', player2Name: 'Asen', group: 'B' },
    { player1Name: 'Andres', player2Name: 'ZurdoJoputa', group: 'A' },
    { player1Name: 'cmarch', player2Name: 'Luis', group: 'B' },
    { player1Name: 'Javi A6', player2Name: 'Sergio', group: 'A' },
    { player1Name: 'David M A5', player2Name: 'JoseLuis', group: 'B' }
];

function cargarConfiguracionPredefinida() {
    if (!currentEvent) {
        showToast('Evento no cargado', 'error');
        return;
    }
    const inscritos = (currentEvent.inscritos || []).filter(i => i.aprobado === true);
    if (inscritos.length === 0) {
        showToast('No hay jugadores aprobados', 'warning');
        return;
    }

    fixedPairs = [];
    const normalize = (str) => str.trim().toLowerCase().replace(/\s+/g, ' ');

    presetPairs.forEach(preset => {
        const p1Norm = normalize(preset.player1Name);
        const p2Norm = normalize(preset.player2Name);
        const jugador1 = inscritos.find(i => normalize(i.nombre).includes(p1Norm) || p1Norm.includes(normalize(i.nombre)));
        const jugador2 = inscritos.find(i => normalize(i.nombre).includes(p2Norm) || p2Norm.includes(normalize(i.nombre)));
        if (jugador1 && jugador2) {
            fixedPairs.push({ player1: jugador1.uid, player2: jugador2.uid, group: preset.group });
        } else {
            console.warn('No se encontraron jugadores para:', preset.player1Name, preset.player2Name);
        }
    });

    updateRiggedPairsList();
    showToast('Configuración cargada', `Se añadieron ${fixedPairs.length} parejas`, 'success');
}

function formarEquiposConRigging(inscritos, fixedPairs) {
    const copy = inscritos.map(i => ({ ...i }));
    fixedPairs.forEach((pair, idx) => {
        const code = `rigged_${idx}`;
        const p1 = copy.find(i => i.uid === pair.player1);
        const p2 = copy.find(i => i.uid === pair.player2);
        if (p1) p1.pairCode = code;
        if (p2) p2.pairCode = code;
    });
    const { teams: generated } = buildEventTeams({
        modalidad: currentEvent.modalidad || 'parejas',
        inscritos: copy,
        seed: currentEvent.id + '_draw'
    });
    return generated.map(team => ({
        ...team,
        playerNames: team.players ? team.players.map(p => p.nombre) : []
    }));
}

window.iniciarSorteo = async () => {
    if (!currentUserData || (currentUserData.rol !== 'Admin' && currentEvent?.organizadorId !== currentUser.uid)) {
        showToast('Solo el organizador puede iniciar el sorteo', 'error');
        return;
    }
    const ev = currentEvent;
    if (!ev) {
        showToast('Evento no cargado', 'error');
        return;
    }
    if (ev.drawState?.status === 'completed') {
        showToast('Este evento ya ha sido sorteado', 'info');
        return;
    }

    try {
        showToast('Generando sorteo...', 'info');

        const inscritosAprobados = (ev.inscritos || []).filter(i => i.aprobado === true);
        if (inscritosAprobados.length < 2) throw new Error('No hay suficientes jugadores aprobados');

        teams = formarEquiposConRigging(inscritosAprobados, fixedPairs);

        const playerToTeam = {};
        teams.forEach(team => team.playerUids.forEach(uid => playerToTeam[uid] = team.id));

        const groupCount = ev.groupCount || 2;
        groups = {};
        for (let i = 0; i < groupCount; i++) groups[String.fromCharCode(65 + i)] = [];

        const equiposSinGrupo = new Set(teams.map(t => t.id));
        fixedPairs.forEach(pair => {
            if (pair.group && groups[pair.group]) {
                const teamId = playerToTeam[pair.player1] || playerToTeam[pair.player2];
                if (teamId && equiposSinGrupo.has(teamId)) {
                    groups[pair.group].push(teamId);
                    equiposSinGrupo.delete(teamId);
                }
            }
        });

        const restantes = Array.from(equiposSinGrupo);
        restantes.sort(() => Math.random() - 0.5);
        restantes.forEach((teamId, idx) => groups[String.fromCharCode(65 + (idx % groupCount))].push(teamId));

        drawSteps = [];
        teams.forEach(team => {
            if (team.playerNames && team.playerNames.length) {
                team.playerNames.forEach((name, idx) => drawSteps.push({ type: 'player', playerName: name || '', teamId: team.id, isSecond: idx === 1 }));
            } else {
                drawSteps.push({ type: 'player', playerName: team.name || '', teamId: team.id, isSecond: false });
            }
        });
        teams.forEach(team => {
            let grupo = '?';
            for (let [g, ids] of Object.entries(groups)) if (ids.includes(team.id)) { grupo = g; break; }
            drawSteps.push({ type: 'assign', teamId: team.id, group: grupo, teamName: team.name || '' });
        });

        drawSteps.sort(() => Math.random() - 0.5);

        if (groupsContainer) {
            groupsContainer.innerHTML = Object.keys(groups).map(g => `
                <div class="group-box" data-group="${g}"><h3>Grupo ${g}</h3><div class="group-teams" id="group-${g}"></div></div>
            `).join('');
        }

        currentStepIndex = 0;
        startBtn.classList.add('hidden');
        nextBtn.classList.remove('hidden');
        nextBtn.disabled = false;
        nextBtn.textContent = 'Siguiente';
        procesarPaso();
    } catch (e) {
        console.error('Error iniciarSorteo:', e);
        showToast('Error', e.message, 'error');
    }
};

function procesarPaso() {
    if (currentStepIndex >= drawSteps.length) {
        nextBtn.textContent = 'Guardar';
        nextBtn.disabled = false;
        return;
    }
    const step = drawSteps[currentStepIndex];
    step.type === 'player' ? mostrarJugador(step.playerName) : asignarEquipoAGrupo(step.teamId, step.group, step.teamName);
}

function mostrarJugador(nombre) {
    nextBtn.disabled = true;
    if (card) {
        card.style.animation = 'none';
        card.offsetHeight;
        card.style.animation = 'spinSlowDown 8s ease-out forwards';
        card.classList.add('spinning');
    }
    setTimeout(() => {
        if (card) { card.classList.remove('spinning'); card.style.animation = 'none'; }
        if (playerNameDisplay) playerNameDisplay.textContent = nombre;
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    }, 8000);
    setTimeout(() => { nextBtn.disabled = false; }, 8500);
}

function asignarEquipoAGrupo(teamId, grupo, teamName) {
    nextBtn.disabled = true;
    const cardRect = cardContainer.getBoundingClientRect();
    const groupBox = document.getElementById(`group-${grupo}`);
    if (!groupBox) { console.error('Grupo no encontrado', grupo); nextBtn.disabled = false; return; }
    const groupRect = groupBox.getBoundingClientRect();

    const clone = cardContainer.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.top = cardRect.top + 'px';
    clone.style.left = cardRect.left + 'px';
    clone.style.width = cardRect.width + 'px';
    clone.style.height = cardRect.height + 'px';
    clone.style.zIndex = '2000';
    clone.style.transition = 'all 2s ease-in-out';
    clone.style.margin = '0';
    clone.style.opacity = '1';
    document.body.appendChild(clone);
    cardContainer.style.opacity = '0';

    setTimeout(() => {
        clone.style.top = groupRect.top + 'px';
        clone.style.left = groupRect.left + groupRect.width/2 - cardRect.width/2 + 'px';
        clone.style.transform = 'scale(0.3)';
        clone.style.opacity = '0';
    }, 100);

    setTimeout(() => {
        clone.remove();
        cardContainer.style.opacity = '1';
        const container = document.getElementById(`group-${grupo}`);
        if (container) {
            const div = document.createElement('div');
            div.className = 'group-team';
            div.textContent = teamName;
            container.appendChild(div);
        }
        confetti({ particleCount: 100, spread: 100, origin: { y: 0.5 } });
        nextBtn.disabled = false;
    }, 2100);
}

window.siguientePaso = () => { currentStepIndex++; procesarPaso(); };

async function finalizarSorteo() {
    const ev = currentEvent;
    if (!ev) return;

    try {
        showToast('Guardando sorteo y generando partidos...', 'info');

        const teamsForStorage = teams.map(t => ({
            id: t.id || '',
            name: t.name || '',
            playerUids: t.playerUids || [],
            playerNames: t.playerNames || []
        }));

        const stepsForStorage = drawSteps.map(s => ({
            type: s.type || '',
            playerName: s.playerName || '',
            group: s.group || '',
            teamName: s.teamName || ''
        }));

        const updateData = {
            estado: 'activo',
            teams: teamsForStorage,
            groups: groups,
            drawState: {
                status: 'completed',
                steps: stepsForStorage,
                completedAt: new Date().toISOString(),
                executedBy: currentUser?.uid || 'system',
                version: Date.now()
            },
            updatedAt: serverTimestamp()
        };

        await updateDoc(doc(db, 'eventos', ev.id), updateData);

        // Eliminar partidos anteriores de forma segura
        const partidosRef = collection(db, 'eventoPartidos');
        const q = query(partidosRef, where('eventoId', '==', ev.id));
        const oldMatches = await getDocs(q);
        if (!oldMatches.empty) {
            const deletePromises = oldMatches.docs.map(docSnap => deleteDoc(doc(db, 'eventoPartidos', docSnap.id)));
            await Promise.all(deletePromises);
        }

        const teamMap = new Map(teams.map(t => [t.id, t.name]));

        if (ev.formato === 'league' || ev.formato === 'league_knockout') {
            for (const [grupo, teamIds] of Object.entries(groups)) {
                const roundRobin = generateRoundRobin(teamIds);
                for (let idx = 0; idx < roundRobin.length; idx++) {
                    const match = roundRobin[idx];
                    await addDoc(partidosRef, {
                        eventoId: ev.id,
                        tipo: 'evento',
                        phase: 'group',
                        group: grupo,
                        round: idx + 1,
                        teamAId: match.teamAId || '',
                        teamBId: match.teamBId || '',
                        teamAName: teamMap.get(match.teamAId) || 'TBD',
                        teamBName: teamMap.get(match.teamBId) || 'TBD',
                        playerUids: [],
                        resultado: null,
                        ganadorTeamId: null,
                        estado: 'pendiente',
                        fecha: null,
                        createdAt: serverTimestamp()
                    });
                }
            }
        }

        if (ev.formato === 'knockout' || ev.formato === 'league_knockout') {
            const bracketRounds = generateKnockoutTree(teams, ev.id + '_ko');
            for (let r = 0; r < bracketRounds.length; r++) {
                const round = bracketRounds[r];
                for (let s = 0; s < round.length; s++) {
                    const match = round[s];
                    await addDoc(partidosRef, {
                        eventoId: ev.id,
                        tipo: 'evento',
                        phase: 'knockout',
                        round: r + 1,
                        slot: s + 1,
                        matchCode: match.matchCode || '',
                        sourceA: match.sourceA || null,
                        sourceB: match.sourceB || null,
                        teamAId: match.teamAId || null,
                        teamBId: match.teamBId || null,
                        teamAName: match.teamAId ? (teamMap.get(match.teamAId) || null) : null,
                        teamBName: match.teamBId ? (teamMap.get(match.teamBId) || null) : null,
                        playerUids: [],
                        resultado: null,
                        ganadorTeamId: null,
                        estado: 'pendiente',
                        fecha: null,
                        createdAt: serverTimestamp()
                    });
                }
            }
            await updateDoc(doc(db, 'eventos', ev.id), { bracket: bracketRounds });
        }

        const version = updateData.drawState.version;
        if (currentUser) localStorage.setItem(`drawSeen_${ev.id}_${version}_${currentUser.uid}`, 'true');

        nextBtn.classList.add('hidden');
        showToast('¡Sorteo completado!', 'Partidos generados', 'success');
        renderGroupsFromData();
    } catch (e) {
        console.error('Error finalizarSorteo:', e);
        showToast('Error', 'No se pudieron guardar los datos: ' + e.message, 'error');
    }
}

// Estilo animación
const style = document.createElement('style');
style.textContent = `
@keyframes spinSlowDown {
    0% { transform: rotateY(0deg); }
    20% { transform: rotateY(720deg); }
    40% { transform: rotateY(1440deg); }
    60% { transform: rotateY(2160deg); }
    80% { transform: rotateY(2880deg); }
    100% { transform: rotateY(3600deg); }
}
.spinning { animation: spinSlowDown 8s ease-out forwards; }
`;
document.head.appendChild(style);

// Exponer funciones globales
window.removeRiggedPair = removeRiggedPair;
window.clearRiggedPairs = clearRiggedPairs;
window.cargarConfiguracionPredefinida = cargarConfiguracionPredefinida;