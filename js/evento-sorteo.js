// evento-sorteo.js - Versión con forzado de parejas fijas mediante composición
import { db, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { doc, onSnapshot, collection, query, where, updateDoc, addDoc, deleteDoc, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';
import { buildEventTeams, runTournamentDraw, resolveTeamById } from './event-tournament-engine.js';

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
let builtData = null;

// Elementos del DOM
let card = document.getElementById('card');
let playerNameDisplay = document.getElementById('playerNameDisplay');
let startBtn = document.getElementById('btn-start-draw');
let nextBtn = document.getElementById('btn-next-step');
let groupsContainer = document.getElementById('groups-container');
let cardContainer = document.getElementById('cardContainer');
let riggingBtn = document.getElementById('btn-rigging');
let riggingModal = document.getElementById('modal-rigging');
let rigPlayer1 = document.getElementById('rig-player1');
let rigPlayer2 = document.getElementById('rig-player2');
let addRiggedBtn = document.getElementById('btn-add-rigged-pair');
let riggedPairsList = document.getElementById('rigged-pairs-list');
let clearRiggedBtn = document.getElementById('btn-clear-rigged');

// Almacén local de parejas fijas
let fixedPairs = [];
let fixedPairsMap = new Map();

if (!eventId) window.location.replace('eventos.html');

document.addEventListener('DOMContentLoaded', () => {
    observerAuth(async (user) => {
        if (!user) return window.location.replace('index.html');
        currentUser = user;
        currentUserData = await getDocument('usuarios', user.uid);
        await injectHeader(currentUserData || {});
        injectNavbar('events');
        subscribeEvent();

        if (startBtn) startBtn.addEventListener('click', window.iniciarSorteo);
        if (nextBtn) nextBtn.addEventListener('click', window.siguientePaso);
    });
});

function subscribeEvent() {
    unsubEvent = onSnapshot(doc(db, 'eventos', eventId), (snap) => {
        if (!snap.exists()) {
            showToast('Evento no encontrado', 'error');
            setTimeout(() => window.location.href = 'eventos.html', 700);
            return;
        }
        currentEvent = { id: snap.id, ...snap.data() };
        render();
        if (currentUserData?.rol === 'Admin') {
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
    } else {
        if (groupsContainer) groupsContainer.innerHTML = '';
        startBtn?.classList.remove('hidden');
        nextBtn?.classList.add('hidden');
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
    const inscritos = currentEvent?.inscritos || [];
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
            <span>${user1?.nombre || pair.player1} + ${user2?.nombre || pair.player2}</span>
            <button class="btn-micro danger" onclick="window.removeRiggedPair(${index})"><i class="fas fa-times"></i></button>
        </li>`;
    }).join('');
}

window.addRiggedPair = () => {
    const p1 = rigPlayer1?.value;
    const p2 = rigPlayer2?.value;
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
    fixedPairs.push({ player1: p1, player2: p2 });
    fixedPairsMap.set(p1, p2);
    fixedPairsMap.set(p2, p1);
    updateRiggedPairsList();
    rigPlayer1.value = '';
    rigPlayer2.value = '';
};

window.removeRiggedPair = (index) => {
    const pair = fixedPairs[index];
    fixedPairs.splice(index, 1);
    fixedPairsMap.delete(pair.player1);
    fixedPairsMap.delete(pair.player2);
    updateRiggedPairsList();
};

window.clearRiggedPairs = () => {
    fixedPairs = [];
    fixedPairsMap.clear();
    updateRiggedPairsList();
};

// Función para formar equipos manualmente respetando parejas fijas
function formarEquiposConParejasFijas(inscritos, fixedPairs) {
    // Copia de la lista de inscritos
    let disponibles = [...inscritos];
    let equipos = [];

    // Mapa para saber qué jugadores están en parejas fijas
    let enPareja = new Set();
    fixedPairs.forEach(p => {
        enPareja.add(p.player1);
        enPareja.add(p.player2);
    });

    // Primero, procesar las parejas fijas
    fixedPairs.forEach(pair => {
        const jug1 = disponibles.find(j => j.uid === pair.player1);
        const jug2 = disponibles.find(j => j.uid === pair.player2);
        if (jug1 && jug2) {
            // Crear equipo
            equipos.push({
                id: `team_${pair.player1}_${pair.player2}`,
                name: `${jug1.nombre} + ${jug2.nombre}`,
                playerUids: [pair.player1, pair.player2],
                playerNames: [jug1.nombre, jug2.nombre]
            });
            // Eliminar de disponibles
            disponibles = disponibles.filter(j => j.uid !== pair.player1 && j.uid !== pair.player2);
        }
    });

    // Mezclar los restantes
    disponibles = disponibles.sort(() => Math.random() - 0.5);
    // Formar parejas aleatorias con los restantes
    for (let i = 0; i < disponibles.length; i += 2) {
        if (i + 1 < disponibles.length) {
            const jug1 = disponibles[i];
            const jug2 = disponibles[i + 1];
            equipos.push({
                id: `team_${jug1.uid}_${jug2.uid}`,
                name: `${jug1.nombre} + ${jug2.nombre}`,
                playerUids: [jug1.uid, jug2.uid],
                playerNames: [jug1.nombre, jug2.nombre]
            });
        } else {
            // Jugador impar (individual) - en pádel no debería ocurrir, pero por si acaso
            console.warn('Número impar de jugadores, el último se queda solo');
            const jug = disponibles[i];
            equipos.push({
                id: `team_${jug.uid}`,
                name: jug.nombre,
                playerUids: [jug.uid],
                playerNames: [jug.nombre]
            });
        }
    }
    return equipos;
}

// Iniciar sorteo
window.iniciarSorteo = async () => {
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

        const inscritos = ev.inscritos || [];
        if (inscritos.length < 2) throw new Error('No hay suficientes jugadores');

        // Formar equipos manualmente con las parejas fijas
        teams = formarEquiposConParejasFijas(inscritos, fixedPairs);

        // Ahora necesitamos generar la estructura del torneo (grupos, partidos) a partir de estos equipos
        // Para simplificar, usaremos runTournamentDraw pero con una lista de "inscritos" modificada
        // No podemos pasarle equipos directamente, así que vamos a simular que cada equipo es un solo jugador
        // Eso no nos sirve. En lugar de eso, construiremos manualmente los grupos y partidos según el formato.

        // Por ahora, para que funcione, haremos una simulación: crearemos grupos ficticios y partidos de liga
        // Esto es un parche, pero al menos las parejas fijas se respetarán.

        // Eliminar partidos anteriores
        const prevSnap = await getDocs(query(collection(db, 'eventoPartidos'), where('eventoId', '==', ev.id)));
        await Promise.all(prevSnap.docs.map(d => deleteDoc(doc(db, 'eventoPartidos', d.id))));

        const f = String(ev.formato || 'league_knockout');
        const groupCount = (f === 'league_knockout') ? Math.min(4, Math.max(2, Number(ev.groupCount || 2))) : 1;
        const equiposPorGrupo = (f === 'league_knockout') ? Number(ev.equiposPorGrupo || 2) : teams.length;

        // Asignar equipos a grupos aleatoriamente
        groups = {};
        for (let i = 0; i < groupCount; i++) {
            groups[String.fromCharCode(65 + i)] = []; // A, B, C...
        }

        // Mezclar equipos y asignar a grupos
        let shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
        shuffledTeams.forEach((team, index) => {
            const groupKey = String.fromCharCode(65 + (index % groupCount));
            groups[groupKey].push(team.id);
        });

        // Generar partidos de liga si corresponde
        if (f === 'league' || f === 'league_knockout') {
            for (let g in groups) {
                const teamIds = groups[g];
                for (let i = 0; i < teamIds.length; i++) {
                    for (let j = i + 1; j < teamIds.length; j++) {
                        const ta = teams.find(t => t.id === teamIds[i]);
                        const tb = teams.find(t => t.id === teamIds[j]);
                        await addDoc(collection(db, 'eventoPartidos'), {
                            eventoId: ev.id,
                            tipo: 'evento',
                            phase: 'group',
                            group: g,
                            round: 1,
                            teamAId: teamIds[i],
                            teamBId: teamIds[j],
                            teamAName: ta?.name || 'TBD',
                            teamBName: tb?.name || 'TBD',
                            playerUids: [...new Set([...(ta?.playerUids || []), ...(tb?.playerUids || [])])],
                            resultado: null,
                            ganadorTeamId: null,
                            estado: 'pendiente',
                            fecha: null,
                            createdAt: serverTimestamp()
                        });
                    }
                }
            }
        }

        // Generar eliminatorias si corresponde
        if (f === 'knockout' || f === 'league_knockout') {
            // Por simplicidad, no generamos bracket aquí, solo ponemos un placeholder
            // En una implementación real, deberías generar el bracket según los resultados de grupos
            // Pero para la animación, no es necesario tener partidos de eliminatoria aún.
        }

        // Construir pasos de animación
        drawSteps = [];
        teams.forEach(team => {
            team.playerNames.forEach((player, idx) => {
                drawSteps.push({
                    type: 'player',
                    playerName: player,
                    teamId: team.id,
                    isSecond: idx === 1
                });
            });
            let grupo = '?';
            for (let [g, ids] of Object.entries(groups)) {
                if (ids.includes(team.id)) {
                    grupo = g;
                    break;
                }
            }
            drawSteps.push({
                type: 'assign',
                teamId: team.id,
                group: grupo,
                teamName: team.name
            });
        });

        // Inicializar grupos vacíos
        const groupNames = Object.keys(groups);
        if (groupsContainer) {
            groupsContainer.innerHTML = groupNames.map(g => `
                <div class="group-box" data-group="${g}">
                    <h3>Grupo ${g}</h3>
                    <div class="group-teams" id="group-${g}"></div>
                </div>
            `).join('');
        }

        currentStepIndex = 0;
        startBtn.classList.add('hidden');
        nextBtn.classList.remove('hidden');
        nextBtn.disabled = false;
        procesarPaso();
    } catch (e) {
        console.error('Error en iniciarSorteo:', e);
        showToast('Error', e.message || 'No se pudo preparar el sorteo', 'error');
    }
};

function procesarPaso() {
    if (currentStepIndex >= drawSteps.length) {
        finalizarSorteo();
        return;
    }

    const step = drawSteps[currentStepIndex];
    if (step.type === 'player') {
        mostrarJugador(step.playerName, step.isSecond);
    } else if (step.type === 'assign') {
        asignarEquipoAGrupo(step.teamId, step.group, step.teamName);
    }
}

function mostrarJugador(nombre, esSegundo) {
    nextBtn.disabled = true;

    if (card) {
        card.style.transform = 'rotateY(0deg)';
        card.classList.add('spinning');
    }
    document.body.classList.add('lightning');

    setTimeout(() => {
        if (card) {
            card.classList.remove('spinning');
            card.style.transform = 'rotateY(180deg)';
        }
        if (playerNameDisplay) playerNameDisplay.textContent = nombre;
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    }, 4000);

    setTimeout(() => {
        document.body.classList.remove('lightning');
        nextBtn.disabled = false;
    }, 5000);
}

function asignarEquipoAGrupo(teamId, grupo, teamName) {
    nextBtn.disabled = true;

    const cardRect = cardContainer.getBoundingClientRect();
    const groupBox = document.getElementById(`group-${grupo}`);
    if (!groupBox) {
        console.error('No se encontró el grupo', grupo);
        nextBtn.disabled = false;
        return;
    }

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
        const groupTeams = document.getElementById(`group-${grupo}`);
        if (groupTeams) {
            const teamDiv = document.createElement('div');
            teamDiv.className = 'group-team';
            teamDiv.textContent = teamName;
            groupTeams.appendChild(teamDiv);
        }
        confetti({ particleCount: 100, spread: 100, origin: { y: 0.5 } });
        nextBtn.disabled = false;
    }, 2100);
}

window.siguientePaso = () => {
    currentStepIndex++;
    procesarPaso();
};

async function finalizarSorteo() {
    const ev = currentEvent;
    if (!ev) return;

    function deepSanitize(obj) {
        if (Array.isArray(obj)) {
            return obj.map(item => deepSanitize(item));
        } else if (obj && typeof obj === 'object') {
            const newObj = {};
            for (const [key, value] of Object.entries(obj)) {
                if (Array.isArray(value) && value.some(v => Array.isArray(v))) {
                    const arrObj = {};
                    value.forEach((v, idx) => {
                        arrObj[idx] = deepSanitize(v);
                    });
                    newObj[key] = arrObj;
                } else if (Array.isArray(value)) {
                    newObj[key] = value.map(v => deepSanitize(v));
                } else if (value && typeof value === 'object') {
                    newObj[key] = deepSanitize(value);
                } else {
                    newObj[key] = value;
                }
            }
            return newObj;
        }
        return obj;
    }

    const stepsForStorage = drawSteps.map(s => ({
        type: s.type,
        playerName: s.playerName,
        group: s.group
    }));

    const teamsForStorage = teams.map(t => ({
        id: t.id,
        name: t.name,
        playerUids: t.playerUids || [],
        playerNames: t.playerNames || []
    }));

    const updateData = {
        estado: 'activo',
        teams: teamsForStorage,
        groups: deepSanitize(groups),
        drawState: {
            status: 'completed',
            steps: stepsForStorage,
            completedAt: new Date().toISOString(),
            executedBy: currentUser?.uid || 'system',
            version: Date.now()
        },
        unmatched: (builtData?.unmatched || []).map(u => u.uid || u),
        updatedAt: serverTimestamp()
    };
    if (bracket) updateData.bracket = deepSanitize(bracket);

    await updateDoc(doc(db, 'eventos', ev.id), deepSanitize(updateData));

    const version = updateData.drawState.version;
    if (currentUser) {
        localStorage.setItem(`drawSeen_${ev.id}_${version}_${currentUser.uid}`, 'true');
    }

    nextBtn.classList.add('hidden');
    showToast('¡Sorteo completado!', 'Disfruta del torneo', 'success');
    renderGroupsFromData();
}

// Event listeners para el modal de amañar
if (riggingBtn) {
    riggingBtn.addEventListener('click', () => {
        loadInscritosToSelects();
        updateRiggedPairsList();
        riggingModal?.classList.add('active');
    });
}
if (addRiggedBtn) {
    addRiggedBtn.addEventListener('click', window.addRiggedPair);
}
if (clearRiggedBtn) {
    clearRiggedBtn.addEventListener('click', window.clearRiggedPairs);
}

// Exponer funciones globales
window.addRiggedPair = window.addRiggedPair;
window.clearRiggedPairs = window.clearRiggedPairs;
window.removeRiggedPair = window.removeRiggedPair;