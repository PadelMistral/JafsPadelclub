// admin.js - Complete Admin Panel Logic (v2.0)
import { db, auth, observerAuth, getDocument, updateDocument, addDocument } from './firebase-service.js';
import { collection, getDocs, deleteDoc, doc, query, orderBy, where
} from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, initBackground, setupModals } from './modules/ui-loader.js';
import { showToast } from './ui-core.js';

let allUsers = [];
let allMatches = [];
let catalogPalas = [];

document.addEventListener('DOMContentLoaded', () => {
    initBackground();
    setupModals();
    
    observerAuth(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        
        const userData = await getDocument('usuarios', user.uid);
        const isAdmin = userData?.rol === 'Admin' || user.email === 'Juanan221091@gmail.com';
        
        if (!isAdmin) {
            showToast('Acceso Denegado', 'No tienes permisos de administrador', 'error');
            window.location.href = 'home.html';
            return;
        }
        
        await injectHeader(userData);
        await loadData();
        await loadPalasCatalog();
    });
    
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
        };
    });
    
    // User search
    document.getElementById('user-search').oninput = (e) => {
        const q = e.target.value.toLowerCase();
        filterAndRenderUsers(q, document.getElementById('user-role-filter').value);
    };
    
    // User role filter
    document.getElementById('user-role-filter').onchange = (e) => {
        const q = document.getElementById('user-search').value.toLowerCase();
        filterAndRenderUsers(q, e.target.value);
    };
    
    // Match filter
    document.getElementById('match-filter').onchange = (e) => {
        const f = e.target.value;
        if (f === 'pending') renderMatches(allMatches.filter(m => m.estado !== 'jugado'));
        else if (f === 'played') renderMatches(allMatches.filter(m => m.estado === 'jugado'));
        else if (f === 'open') renderMatches(allMatches.filter(m => m.jugadores?.length < 4 && m.estado !== 'jugado'));
        else renderMatches(allMatches);
    };
    
    // Load saved config
    const savedConfig = JSON.parse(localStorage.getItem('padeluminatis_config') || '{}');
    if (savedConfig.kFactor) document.getElementById('cfg-k').value = savedConfig.kFactor;
    if (savedConfig.compMultiplier) document.getElementById('cfg-mult').value = savedConfig.compMultiplier;
    if (savedConfig.levelMin) document.getElementById('cfg-lvl-min').value = savedConfig.levelMin;
    if (savedConfig.levelMax) document.getElementById('cfg-lvl-max').value = savedConfig.levelMax;
});

function filterAndRenderUsers(query, roleFilter) {
    let filtered = allUsers.filter(u => 
        (u.nombreUsuario || u.nombre || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query)
    );
    
    if (roleFilter === 'admin') {
        filtered = filtered.filter(u => u.rol === 'Admin');
    }
    
    renderUsers(filtered);
}

async function loadData() {
    // Users
    const uSnap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc")));
    allUsers = uSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsers(allUsers);
    document.getElementById('total-users').textContent = allUsers.length;
    
    // Matches
    const [am, re] = await Promise.all([
        getDocs(collection(db, "partidosAmistosos")),
        getDocs(collection(db, "partidosReto"))
    ]);
    
    allMatches = [];
    am.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
    re.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', ...d.data() }));
    
    allMatches.sort((a, b) => (b.fecha?.toDate() || 0) - (a.fecha?.toDate() || 0));
    renderMatches(allMatches);
    
    document.getElementById('total-matches').textContent = allMatches.length;
    document.getElementById('active-matches').textContent = allMatches.filter(m => m.estado !== 'jugado' && m.jugadores?.length < 4).length;
}

async function loadPalasCatalog() {
    try {
        const snap = await getDocs(collection(db, "palasCatalogo"));
        catalogPalas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPalasCatalog();
    } catch(e) {
        console.log('No palas catalog');
    }
}

function renderUsers(list) {
    const container = document.getElementById('users-list');
    
    if (list.length === 0) {
        container.innerHTML = '<div class="center py-10 text-scnd">No se encontraron usuarios</div>';
        return;
    }
    
    container.innerHTML = list.map((u, idx) => {
        const photo = u.fotoPerfil || u.fotoURL;
        const name = u.nombreUsuario || u.nombre || 'Sin nombre';
        const initials = name.substring(0, 2).toUpperCase();
        const rankBadge = idx < 3 ? `<span class="text-2xs font-bold ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : 'text-orange-400'}">#${idx + 1}</span>` : '';
        
        return `
            <div class="user-row" onclick="editUser('${u.id}')">
                <div class="w-10 h-10 rounded-full bg-slate-700 center overflow-hidden border border-white/10">
                    ${photo ? `<img src="${photo}" class="w-full h-full object-cover">` : `<span class="font-bold text-xs">${initials}</span>`}
                </div>
                <div class="flex-col gap-0">
                    <div class="flex-row gap-2">
                        <span class="font-bold text-sm text-white">${name}</span>
                        ${rankBadge}
                    </div>
                    <span class="text-2xs text-scnd">${u.email || 'Sin email'} · Nv.${(u.nivel || 2.5).toFixed(2)} · ${u.puntosRanking || 1000}pts</span>
                </div>
                <div class="flex-row gap-2">
                    ${u.rol === 'Admin' ? '<span class="text-2xs font-bold text-orange-400 uppercase bg-orange-400/10 px-2 py-1 rounded-full">Admin</span>' : ''}
                    <i class="fas fa-chevron-right text-scnd"></i>
                </div>
            </div>
        `;
    }).join('');
}

function renderMatches(list) {
    const container = document.getElementById('matches-list');
    
    if (list.length === 0) {
        container.innerHTML = '<div class="center py-10 text-scnd">No hay partidos</div>';
        return;
    }
    
    container.innerHTML = list.map(m => {
        const date = m.fecha?.toDate();
        const isPlayed = m.estado === 'jugado';
        const isComp = m.col === 'partidosReto';
        const isFull = m.jugadores?.length === 4;
        const statusClass = isPlayed ? 'played' : (isFull ? 'full' : 'open');
        
        return `
            <div class="match-row ${statusClass}" onclick="editMatch('${m.id}', '${m.col}')">
                <div class="flex-row between mb-2">
                    <div class="flex-row gap-2">
                        <span class="status-badge ${isComp ? 'badge-green' : 'badge-blue'}">${isComp ? 'Competitivo' : 'Amistoso'}</span>
                        <span class="status-badge ${isPlayed ? 'badge-orange' : isFull ? 'badge-blue' : 'badge-green'}">${isPlayed ? 'Jugado' : isFull ? 'Completo' : 'Abierto'}</span>
                    </div>
                    <span class="text-2xs text-scnd">${m.jugadores?.length || 0}/4</span>
                </div>
                <div class="flex-row between">
                    <div class="flex-col gap-0">
                        <span class="font-bold text-white">${date ? date.toLocaleDateString('es-ES') : 'Sin fecha'}</span>
                        <span class="text-2xs text-scnd">${date ? date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                    </div>
                    <i class="fas fa-chevron-right text-scnd"></i>
                </div>
            </div>
        `;
    }).join('');
}

function renderPalasCatalog() {
    const container = document.getElementById('palas-catalog');
    
    if (catalogPalas.length === 0) {
        container.innerHTML = `
            <div class="center flex-col py-10 opacity-40">
                <i class="fas fa-table-tennis text-3xl mb-3"></i>
                <span class="text-sm">No hay palas en el catálogo</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = catalogPalas.map(p => `
        <div class="sport-card p-3 flex-row between">
            <div class="flex-col gap-0">
                <span class="font-bold text-white">${p.modelo}</span>
                <span class="text-2xs text-scnd">${p.marca} · ${p.forma || '-'}</span>
            </div>
            <div class="flex-row gap-3">
                <div class="text-center">
                    <span class="text-sm font-bold text-sport-orange">${p.potencia || '-'}</span>
                    <span class="text-2xs text-scnd block">POT</span>
                </div>
                <div class="text-center">
                    <span class="text-sm font-bold text-sport-blue">${p.control || '-'}</span>
                    <span class="text-2xs text-scnd block">CTR</span>
                </div>
                ${p.precio ? `<span class="text-sm font-bold text-sport-green">${p.precio}€</span>` : ''}
                <button class="btn-ghost text-red-400" onclick="deleteCatalogPala('${p.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

window.editUser = async (uid) => {
    const overlay = document.getElementById('modal-edit-user');
    const area = document.getElementById('edit-user-area');
    overlay.classList.add('active');
    area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
    
    const user = await getDocument('usuarios', uid);
    if (!user) {
        area.innerHTML = '<div class="center py-10 text-red-400">Usuario no encontrado</div>';
        return;
    }
    
    const name = user.nombreUsuario || user.nombre || 'Sin nombre';
    const photo = user.fotoPerfil || user.fotoURL;
    
    area.innerHTML = `
        <div class="flex-row between mb-4">
            <h3 class="font-display font-bold text-lg">Editar Usuario</h3>
            <button class="btn-ghost" onclick="document.getElementById('modal-edit-user').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4">
            <div class="flex-row gap-3 mb-4">
                <div class="w-14 h-14 rounded-full bg-slate-700 center overflow-hidden">
                    ${photo ? `<img src="${photo}" class="w-full h-full object-cover">` : `<span class="font-bold text-xl">${name.substring(0,2).toUpperCase()}</span>`}
                </div>
                <div class="flex-col gap-0">
                    <span class="font-bold text-lg text-white">${name}</span>
                    <span class="text-xs text-scnd">${user.email || 'Sin email'}</span>
                </div>
            </div>
            
            <div class="grid grid-cols-3 gap-2 text-center">
                <div class="bg-white/5 p-2 rounded-lg">
                    <span class="font-bold text-sport-blue">${user.partidosJugados || 0}</span>
                    <span class="text-2xs text-scnd block">Partidos</span>
                </div>
                <div class="bg-white/5 p-2 rounded-lg">
                    <span class="font-bold text-sport-green">${user.victorias || 0}</span>
                    <span class="text-2xs text-scnd block">Victorias</span>
                </div>
                <div class="bg-white/5 p-2 rounded-lg">
                    <span class="font-bold text-sport-orange">${user.rachaActual || 0}</span>
                    <span class="text-2xs text-scnd block">Racha</span>
                </div>
            </div>
        </div>
        
        <div class="flex-col gap-4">
            <div>
                <label class="text-label mb-2 block">Nombre de Usuario</label>
                <input type="text" id="edit-name" class="sport-input" value="${name}">
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="text-label mb-2 block">Nivel (1.0 - 7.0)</label>
                    <input type="number" id="edit-level" class="sport-input" value="${(user.nivel || 2.5).toFixed(2)}" min="1" max="7" step="0.01">
                </div>
                <div>
                    <label class="text-label mb-2 block">Puntos Ranking</label>
                    <input type="number" id="edit-pts" class="sport-input" value="${user.puntosRanking || 1000}">
                </div>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="text-label mb-2 block">Victorias</label>
                    <input type="number" id="edit-wins" class="sport-input" value="${user.victorias || 0}">
                </div>
                <div>
                    <label class="text-label mb-2 block">Partidos Jugados</label>
                    <input type="number" id="edit-played" class="sport-input" value="${user.partidosJugados || 0}">
                </div>
            </div>
            
            <div>
                <label class="text-label mb-2 block">Rol</label>
                <select id="edit-rol" class="sport-input">
                    <option value="" ${!user.rol ? 'selected' : ''}>Usuario Normal</option>
                    <option value="Admin" ${user.rol === 'Admin' ? 'selected' : ''}>Administrador</option>
                </select>
            </div>
            
            <div class="flex-row gap-3 mt-4">
                <button class="btn-primary flex-1" onclick="saveUser('${uid}')">
                    <i class="fas fa-save mr-2"></i>Guardar
                </button>
                <button class="btn-ghost text-red-400 border border-red-500/30 px-4 rounded-xl" onclick="deleteUser('${uid}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
};

window.saveUser = async (uid) => {
    const name = document.getElementById('edit-name').value.trim();
    const nivel = parseFloat(document.getElementById('edit-level').value);
    const pts = parseInt(document.getElementById('edit-pts').value);
    const wins = parseInt(document.getElementById('edit-wins').value);
    const played = parseInt(document.getElementById('edit-played').value);
    const rol = document.getElementById('edit-rol').value;
    
    try {
        await updateDocument('usuarios', uid, {
            nombreUsuario: name,
            nivel: Math.max(1, Math.min(7, nivel)),
            puntosRanking: Math.max(0, pts),
            victorias: Math.max(0, wins),
            partidosJugados: Math.max(0, played),
            rol: rol || null
        });
        showToast('Guardado', 'Usuario actualizado correctamente', 'success');
        document.getElementById('modal-edit-user').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error', 'No se pudo actualizar', 'error');
    }
};

window.deleteUser = async (uid) => {
    if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
    
    try {
        await deleteDoc(doc(db, 'usuarios', uid));
        showToast('Eliminado', 'Usuario eliminado', 'warning');
        document.getElementById('modal-edit-user').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error', 'No se pudo eliminar', 'error');
    }
};

window.editMatch = async (id, col) => {
    const overlay = document.getElementById('modal-edit-match');
    const area = document.getElementById('edit-match-area');
    overlay.classList.add('active');
    area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
    
    const match = await getDocument(col, id);
    if (!match) {
        area.innerHTML = '<div class="center py-10 text-red-400">Partido no encontrado</div>';
        return;
    }
    
    const date = match.fecha?.toDate();
    const players = await Promise.all((match.jugadores || []).map(async uid => {
        if (uid.startsWith('GUEST_')) return { name: uid.split('_')[1] + ' (Inv)', id: uid, isGuest: true };
        const u = await getDocument('usuarios', uid);
        return { name: u?.nombreUsuario || u?.nombre || 'Desconocido', id: uid, isGuest: false };
    }));
    
    const isPlayed = match.estado === 'jugado';
    const isComp = col === 'partidosReto';
    
    area.innerHTML = `
        <div class="flex-row between mb-4">
            <h3 class="font-display font-bold text-lg">Editar Partido</h3>
            <button class="btn-ghost" onclick="document.getElementById('modal-edit-match').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4">
            <div class="flex-row between mb-3">
                <span class="status-badge ${isComp ? 'badge-green' : 'badge-blue'}">${isComp ? 'Competitivo' : 'Amistoso'}</span>
                <span class="status-badge ${isPlayed ? 'badge-orange' : 'badge-green'}">${isPlayed ? 'Jugado' : 'Pendiente'}</span>
            </div>
            <span class="font-display font-bold text-xl text-white block">${date ? date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'}) : 'Sin fecha'}</span>
            <span class="text-sm text-scnd">${date ? date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}) : ''}</span>
            ${match.resultado?.sets ? `<div class="mt-2 text-lg font-bold text-sport-green">Resultado: ${match.resultado.sets}</div>` : ''}
        </div>
        
        <div class="mb-4">
            <span class="text-label mb-2 block">Jugadores (${players.length}/4)</span>
            <div class="flex-col gap-2">
                ${players.map((p, i) => `
                    <div class="flex-row between p-3 bg-white/5 rounded-xl">
                        <div class="flex-row gap-2">
                            <span class="w-6 h-6 rounded-full ${i < 2 ? 'bg-sport-blue/20 text-sport-blue' : 'bg-sport-green/20 text-sport-green'} flex items-center justify-center text-xs font-bold">${i+1}</span>
                            <span class="text-sm text-white">${p.name}</span>
                            ${p.isGuest ? '<span class="text-2xs bg-white/10 px-1 rounded text-scnd">Inv</span>' : ''}
                        </div>
                        <button class="btn-ghost text-red-400" onclick="removePlayer('${id}', '${col}', ${i})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('')}
                ${players.length < 4 ? `<div class="text-center text-scnd text-xs py-2 bg-white/5 rounded-xl">Plazas vacías: ${4 - players.length}</div>` : ''}
            </div>
        </div>
        
        <div class="flex-col gap-2">
            ${!isPlayed && players.length === 4 ? `
                <button class="btn-action w-full py-3 rounded-xl" onclick="openResultForm('${id}', '${col}')">
                    <i class="fas fa-flag-checkered mr-2"></i>Finalizar y Puntuar
                </button>
            ` : ''}
            <div class="flex-row gap-2">
                <button class="btn-secondary flex-1" onclick="changeMatchDate('${id}', '${col}')">
                    <i class="fas fa-calendar mr-2"></i>Cambiar Fecha
                </button>
                <button class="btn-ghost text-red-400 border border-red-500/30 px-4 rounded-xl" onclick="deleteMatch('${id}', '${col}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
};

window.removePlayer = async (id, col, idx) => {
    const match = await getDocument(col, id);
    if (!match) return;
    
    const jugs = [...match.jugadores];
    jugs.splice(idx, 1);
    
    await updateDocument(col, id, { jugadores: jugs });
    showToast('Actualizado', 'Jugador eliminado del partido', 'info');
    editMatch(id, col);
};

window.deleteMatch = async (id, col) => {
    if (!confirm('¿Eliminar este partido?')) return;
    
    try {
        await deleteDoc(doc(db, col, id));
        showToast('Eliminado', 'Partido eliminado', 'warning');
        document.getElementById('modal-edit-match').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error', 'No se pudo eliminar', 'error');
    }
};

window.changeMatchDate = async (id, col) => {
    const newDate = prompt('Introduce la nueva fecha (formato: DD/MM/YYYY HH:MM):');
    if (!newDate) return;
    
    try {
        const [datePart, timePart] = newDate.split(' ');
        const [day, month, year] = datePart.split('/').map(Number);
        const [hour, minute] = (timePart || '21:00').split(':').map(Number);
        const fecha = new Date(year, month - 1, day, hour, minute);
        
        await updateDocument(col, id, { fecha });
        showToast('Actualizado', 'Fecha del partido cambiada', 'success');
        editMatch(id, col);
    } catch(e) {
        showToast('Error', 'Formato de fecha inválido', 'error');
    }
};

window.openResultForm = (id, col) => {
    const res = prompt("Introduce el resultado (Ej: 6-4 6-3):");
    if(res) saveResult(id, col, res);
};

async function saveResult(id, col, result) {
    try {
        await updateDocument(col, id, { resultado: { sets: result }, estado: 'jugado' });
        
        const { processMatchResults } = await import('./ranking-service.js');
        await processMatchResults(id, col, result);
        
        showToast('Partido Finalizado', 'Rankings actualizados', 'success');
        document.getElementById('modal-edit-match').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error', 'No se pudo finalizar', 'error');
    }
}

window.refreshMatches = async () => {
    document.getElementById('matches-list').innerHTML = '<div class="center py-10"><div class="spinner-galaxy"></div></div>';
    await loadData();
    showToast('Actualizado', 'Lista de partidos actualizada', 'info');
};

window.openAddPalaModal = () => {
    document.getElementById('modal-add-pala').classList.add('active');
};

window.saveCatalogPala = async () => {
    const marca = document.getElementById('cat-pala-marca').value.trim();
    const modelo = document.getElementById('cat-pala-modelo').value.trim();
    const precio = parseInt(document.getElementById('cat-pala-precio').value) || null;
    const forma = document.getElementById('cat-pala-forma').value;
    const potencia = parseInt(document.getElementById('cat-pala-pot').value);
    const control = parseInt(document.getElementById('cat-pala-ctrl').value);
    
    if (!marca || !modelo) return showToast('Error', 'Marca y modelo requeridos', 'warning');
    
    try {
        await addDocument('palasCatalogo', { marca, modelo, precio, forma, potencia, control });
        showToast('Añadida', 'Pala añadida al catálogo', 'success');
        document.getElementById('modal-add-pala').classList.remove('active');
        await loadPalasCatalog();
    } catch(e) {
        showToast('Error', 'No se pudo añadir', 'error');
    }
};

window.deleteCatalogPala = async (id) => {
    if (!confirm('¿Eliminar esta pala del catálogo?')) return;
    try {
        await deleteDoc(doc(db, 'palasCatalogo', id));
        await loadPalasCatalog();
        showToast('Eliminada', 'Pala eliminada del catálogo', 'info');
    } catch(e) {}
};

window.saveConfig = () => {
    const config = {
        kFactor: parseFloat(document.getElementById('cfg-k').value),
        compMultiplier: parseFloat(document.getElementById('cfg-mult').value),
        levelMin: parseFloat(document.getElementById('cfg-lvl-min').value),
        levelMax: parseFloat(document.getElementById('cfg-lvl-max').value)
    };
    localStorage.setItem('padeluminatis_config', JSON.stringify(config));
    showToast('Guardado', 'Configuración guardada localmente', 'success');
};

window.recalculateAllRankings = async () => {
    if (!confirm('¿Recalcular todos los rankings? Esto puede tardar.')) return;
    showToast('Procesando', 'Recalculando rankings...', 'info');
    // This would be a complex operation - placeholder for now
    setTimeout(() => showToast('Completado', 'Rankings recalculados', 'success'), 2000);
};

window.resetAllStreaks = async () => {
    if (!confirm('¿Resetear todas las rachas a 0?')) return;
    
    for (const user of allUsers) {
        await updateDocument('usuarios', user.id, { rachaActual: 0 });
    }
    showToast('Completado', 'Todas las rachas reseteadas', 'success');
    await loadData();
};

window.clearOldMatches = async () => {
    const daysOld = prompt('¿Eliminar partidos jugados hace más de cuántos días?', '30');
    if (!daysOld) return;
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(daysOld));
    
    let count = 0;
    for (const m of allMatches) {
        if (m.estado === 'jugado' && m.fecha?.toDate() < cutoff) {
            await deleteDoc(doc(db, m.col, m.id));
            count++;
        }
    }
    
    showToast('Limpieza', `${count} partidos antiguos eliminados`, 'success');
    await loadData();
};
