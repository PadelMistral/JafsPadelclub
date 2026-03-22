import { db, auth } from './firebase-service.js';
import { collection, getDocs, updateDoc, doc, getDoc, writeBatch, serverTimestamp, addDoc, query, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { 
    buildEventTeams, 
    allocateGroups, 
    generateRoundRobin,
    seededRandomFactory,
    hashSeed
} from './event-tournament-engine.js';

let currentEvent = null;
let teamsForStorage = [];
let groupsResult = {};
let drawSteps = [];
let stepIndex = 0;
let isDrawing = false;
let riggedPairs = []; // { player1, player2, group }

const card = document.getElementById('card');
const playerNameDisplay = document.getElementById('playerNameDisplay');
const btnStart = document.getElementById('btn-start-draw');
const btnNext = document.getElementById('btn-next-step');
const groupsContainer = document.getElementById('groups-container');

// Load Event Data
async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('id');
    if (!eventId) { alert('No event ID'); return; }

    const evSnap = await getDoc(doc(db, 'eventos', eventId));
    if (!evSnap.exists()) return;
    currentEvent = { id: evSnap.id, ...evSnap.data() };

    if (currentEvent.drawState?.status === 'completed') {
        const msg = document.getElementById('draw-message');
        if (msg) msg.classList.remove('hidden');
        if (btnStart) btnStart.classList.add('hidden');
        renderFinalGroups(currentEvent.groups);
        return;
    }

    // Check Admin for Rigging
    auth.onAuthStateChanged(user => {
        if (user && (user.email === 'admin@jafspadel.com' || currentEvent.organizadorId === user.uid)) {
            const btnRig = document.getElementById('btn-rigging');
            if (btnRig) btnRig.classList.remove('hidden');
            setupRiggingModal();
        }
    });

    if (btnStart) btnStart.onclick = prepareDraw;
    if (btnNext) btnNext.onclick = nextDrawStep;
}

function setupRiggingModal() {
    const modal = document.getElementById('modal-rigging');
    const btnRig = document.getElementById('btn-rigging');
    const sel1 = document.getElementById('rig-player1');
    const sel2 = document.getElementById('rig-player2');
    if (!modal || !btnRig || !sel1 || !sel2) return;
    
    const inscritos = currentEvent.inscritos || [];

    btnRig.onclick = () => {
        sel1.innerHTML = inscritos.map(i => `<option value="${i.uid}">${i.nombre || i.email}</option>`).join('');
        sel2.innerHTML = inscritos.map(i => `<option value="${i.uid}">${i.nombre || i.email}</option>`).join('');
        modal.classList.add('active');
    };

    const btnAddRig = document.getElementById('btn-add-rigged-pair');
    if (btnAddRig) {
        btnAddRig.onclick = () => {
            const p1 = inscritos.find(i => i.uid === sel1.value);
            const p2 = inscritos.find(i => i.uid === sel2.value);
            const group = document.getElementById('rig-group').value;
            riggedPairs.push({ p1, p2, group });
            renderRiggedList();
        };
    }
}

function renderRiggedList() {
    const list = document.getElementById('rigged-pairs-list');
    if (!list) return;
    list.innerHTML = riggedPairs.map((p, idx) => `
        <li class="text-[10px] flex justify-between bg-white/05 p-1 rounded">
            <span>${p.p1.nombre} + ${p.p2.nombre} -> ${p.group || '?'}</span>
            <button onclick="window.removeRigged(${idx})" class="text-red-400">×</button>
        </li>
    `).join('');
}
window.removeRigged = (idx) => { riggedPairs.splice(idx, 1); renderRiggedList(); };

async function prepareDraw() {
    if (isDrawing) return;
    btnStart.disabled = true;
    btnStart.textContent = 'PROCESANDO...';

    const { teams } = buildEventTeams({
        modalidad: currentEvent.modalidad || 'parejas',
        inscritos: currentEvent.inscritos.filter(i => i.aprobado),
        seed: currentEvent.id
    });

    teamsForStorage = teams;
    const { groups, steps } = allocateGroups(teams, currentEvent.groupCount || 2, currentEvent.id);
    groupsResult = groups;
    drawSteps = steps;

    // Render group skeletons
    if (groupsContainer) {
        groupsContainer.innerHTML = Object.keys(groups).map(g => `
            <div class="group-box-draw glass-premium" id="group-draw-${g}">
                <h3 class="group-title">GRUPO ${g}</h3>
                <div class="group-slots" id="slots-${g}"></div>
            </div>
        `).join('');
    }

    isDrawing = true;
    btnStart.classList.add('hidden');
    btnNext.classList.remove('hidden');
    btnNext.disabled = false;
    nextDrawStep();
}

function nextDrawStep() {
    if (stepIndex >= drawSteps.length) {
        finishDraw();
        return;
    }

    const step = drawSteps[stepIndex];
    stepIndex++;

    // Animation 
    if (card) card.classList.add('flipping');
    if (playerNameDisplay) playerNameDisplay.textContent = step.teamName;

    setTimeout(() => {
        const slotContainer = document.getElementById(`slots-${step.group}`);
        if (slotContainer) {
            const teamDiv = document.createElement('div');
            teamDiv.className = 'draw-team-pill animate-pop-in';
            teamDiv.innerHTML = `<span>${step.teamName}</span>`;
            slotContainer.appendChild(teamDiv);
        }
        
        setTimeout(() => { if (card) card.classList.remove('flipping'); }, 500);
        if (stepIndex === drawSteps.length) {
            btnNext.textContent = 'FINALIZAR';
            btnNext.classList.add('btn-draw-success');
        }
    }, 600);
}

async function finishDraw() {
    btnNext.disabled = true;
    btnNext.textContent = 'GUARDANDO...';

    try {
        const partidosRef = collection(db, 'eventoPartidos');
        const teamMap = new Map(teamsForStorage.map(t => [t.id, t]));

        // Generate matches for each group
        for (const [groupName, teamIds] of Object.entries(groupsResult)) {
            const matches = generateRoundRobin(teamIds);
            for (let i = 0; i < matches.length; i++) {
                const m = matches[i];
                const teamA = teamMap.get(m.teamAId);
                const teamB = teamMap.get(m.teamBId);
                
                await addDoc(partidosRef, {
                    eventoId: currentEvent.id,
                    tipo: 'evento',
                    phase: currentEvent.formato === 'league' ? 'league' : 'group',
                    group: groupName,
                    round: i + 1,
                    teamAId: m.teamAId,
                    teamBId: m.teamBId,
                    teamAName: teamA?.name || 'TBD',
                    teamBName: teamB?.name || 'TBD',
                    playerUids: [...(teamA?.playerUids || []), ...(teamB?.playerUids || [])],
                    estado: 'pendiente',
                    resultado: null,
                    ganadorTeamId: null,
                    fecha: null,
                    createdAt: serverTimestamp()
                });
            }
        }

        await updateDoc(doc(db, 'eventos', currentEvent.id), {
            estado: 'activo',
            teams: teamsForStorage,
            groups: groupsResult,
            drawState: { status: 'completed', updatedAt: new Date().toISOString() },
            updatedAt: serverTimestamp()
        });

        alert('Sorteo finalizado con éxito. Partidos generados.');
        window.location.href = `evento-detalle.html?id=${currentEvent.id}`;
    } catch (e) {
        console.error(e);
        alert('Error al finalizar el sorteo: ' + e.message);
        btnNext.disabled = false;
        btnNext.textContent = 'REINTENTAR';
    }
}

function renderFinalGroups(groups) {
    if (!groupsContainer) return;
    groupsContainer.innerHTML = Object.keys(groups).map(g => `
        <div class="group-box-draw glass-premium completed">
            <h3 class="group-title">GRUPO ${g}</h3>
            <div class="group-slots">
                ${groups[g].map(tid => {
                    const t = currentEvent.teams?.find(x => x.id === tid);
                    return `<div class="draw-team-pill"><span>${t?.name || tid}</span></div>`;
                }).join('')}
            </div>
        </div>
    `).join('');
}

init();
``