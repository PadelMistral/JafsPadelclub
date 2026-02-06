// admin.js - Complete Admin Panel Logic V4.0
import { db, auth, observerAuth, getDocument, updateDocument, addDocument } from './firebase-service.js';
import { collection, getDocs, deleteDoc, doc, query, orderBy, where, writeBatch } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader } from './modules/ui-loader.js';
import { showToast } from './ui-core.js';

let allUsers = [];
let allMatches = [];
let catalogPalas = [];

document.addEventListener('DOMContentLoaded', () => {
    // Check Auth
    observerAuth(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        
        const userData = await getDocument('usuarios', user.uid);
        const isAdmin = userData?.rol === 'Admin' || user.email === 'Juanan221091@gmail.com';
        
        if (!isAdmin) {
            showToast('Acceso Denegado', 'No tienes permisos de administrador', 'error');
            setTimeout(() => window.location.href = 'home.html', 1000);
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
    const searchInput = document.getElementById('user-search');
    if (searchInput) {
        searchInput.oninput = (e) => {
            const q = e.target.value.toLowerCase();
            filterAndRenderUsers(q, document.getElementById('user-role-filter').value);
        };
    }
    
    // User role filter
    const roleFilter = document.getElementById('user-role-filter');
    if (roleFilter) {
        roleFilter.onchange = (e) => {
            const q = document.getElementById('user-search').value.toLowerCase();
            filterAndRenderUsers(q, e.target.value);
        };
    }
    
    // Match filter
    const matchFilter = document.getElementById('match-filter');
    if (matchFilter) {
        matchFilter.onchange = (e) => {
            const f = e.target.value;
            if (f === 'pending') renderMatches(allMatches.filter(m => m.estado !== 'jugado'));
            else if (f === 'played') renderMatches(allMatches.filter(m => m.estado === 'jugado'));
            else if (f === 'open') renderMatches(allMatches.filter(m => m.jugadores?.length < 4 && m.estado !== 'jugado'));
            else renderMatches(allMatches);
        };
    }
    
    // Load config
    loadConfig();
});

function loadConfig() {
    const savedConfig = JSON.parse(localStorage.getItem('padeluminatis_config') || '{}');
    if (savedConfig.kFactor && document.getElementById('cfg-k')) document.getElementById('cfg-k').value = savedConfig.kFactor;
    if (savedConfig.compMultiplier && document.getElementById('cfg-mult')) document.getElementById('cfg-mult').value = savedConfig.compMultiplier;
    if (savedConfig.levelMin && document.getElementById('cfg-lvl-min')) document.getElementById('cfg-lvl-min').value = savedConfig.levelMin;
    if (savedConfig.levelMax && document.getElementById('cfg-lvl-max')) document.getElementById('cfg-lvl-max').value = savedConfig.levelMax;
}

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
    
    const totalUsersEl = document.getElementById('total-users');
    if (totalUsersEl) totalUsersEl.textContent = allUsers.length;
    
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
    
    const totalMatchesEl = document.getElementById('total-matches');
    if (totalMatchesEl) totalMatchesEl.textContent = allMatches.length;
    
    const activeMatchesEl = document.getElementById('active-matches');
    if (activeMatchesEl) activeMatchesEl.textContent = allMatches.filter(m => m.estado !== 'jugado' && m.jugadores?.length < 4).length;
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
    if (!container) return;
    
    if (list.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-text">No se encontraron usuarios</span></div>';
        return;
    }
    
    container.innerHTML = list.map((u, idx) => {
        const photo = u.fotoPerfil || u.fotoURL;
        const name = u.nombreUsuario || u.nombre || 'Sin nombre';
        const rankBadge = idx < 3 ? `<span class="rank-badge rank-${idx + 1}">#${idx + 1}</span>` : '';
        
        return `
            <div class="user-row" onclick="editUser('${u.id}')">
                <div class="avatar-circle">
                    ${photo ? `<img src="${photo}">` : `<span class="font-bold text-xs">${name.substring(0, 2).toUpperCase()}</span>`}
                </div>
                <div class="user-info">
                    <div class="flex-row gap-2 items-center">
                        <span class="user-name">${name}</span>
                        ${u.rol === 'Admin' ? '<span class="status-badge badge-orange xs">Admin</span>' : ''}
                    </div>
                    <span class="user-details">${u.email || 'Sin email'} · Nv.${(u.nivel || 2.5).toFixed(2)} · ${u.puntosRanking || 1000}pts</span>
                </div>
                <i class="fas fa-chevron-right text-muted"></i>
            </div>
        `;
    }).join('');
}

function renderMatches(list) {
    const container = document.getElementById('matches-list');
    if (!container) return;
    
    if (list.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-text">No hay partidos</span></div>';
        return;
    }
    
    container.innerHTML = list.map(m => {
        const date = m.fecha?.toDate();
        const isPlayed = m.estado === 'jugado';
        const isComp = m.col === 'partidosReto';
        const isFull = m.jugadores?.length === 4;
        
        let statusBadge = isPlayed ? '<span class="status-badge badge-orange xs">Jugado</span>' : 
                         (isFull ? '<span class="status-badge badge-blue xs">Completo</span>' : '<span class="status-badge badge-green xs">Abierto</span>');
        
        return `
            <div class="match-row" onclick="editMatch('${m.id}', '${m.col}')">
                <div class="flex-row between mb-2">
                    <div class="flex-row gap-2">
                        <span class="status-badge ${isComp ? 'badge-purple' : 'badge-blue'} xs">${isComp ? 'Competitivo' : 'Amistoso'}</span>
                        ${statusBadge}
                    </div>
                    <span class="text-xs text-muted font-bold">${m.jugadores?.length || 0}/4</span>
                </div>
                <div class="flex-row between items-end">
                    <div class="flex-col">
                        <span class="font-bold text-white text-sm">${date ? date.toLocaleDateString('es-ES') : 'Sin fecha'}</span>
                        <span class="text-xs text-muted">${date ? date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                    </div>
                    <i class="fas fa-chevron-right text-muted"></i>
                </div>
            </div>
        `;
    }).join('');
}

function renderPalasCatalog() {
    const container = document.getElementById('palas-catalog');
    if (!container) return;
    
    if (catalogPalas.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-table-tennis-paddle-ball empty-state-icon"></i>
                <span class="empty-state-text">Catálogo vacío</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = catalogPalas.map(p => `
        <div class="sport-card p-3 flex-row between items-center">
            <div class="flex-col">
                <span class="font-bold text-white text-sm">${p.modelo}</span>
                <span class="text-xs text-muted">${p.marca} · ${p.forma || '-'}</span>
            </div>
            <div class="flex-row gap-3 items-center">
                <div class="text-center">
                    <span class="text-sm font-bold text-primary">${p.potencia || '-'}</span>
                    <span class="text-2xs text-muted block">POT</span>
                </div>
                <div class="text-center">
                    <span class="text-sm font-bold text-sport-green">${p.control || '-'}</span>
                    <span class="text-2xs text-muted block">CTR</span>
                </div>
                <button class="btn-icon-glass text-danger sm" onclick="deleteCatalogPala('${p.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// Window Globals for Onclick Actions
window.editUser = async (uid) => {
    const overlay = document.getElementById('modal-edit-user');
    const area = document.getElementById('edit-user-area');
    overlay.classList.add('active');
    area.innerHTML = '<div class="loading-state"><div class="spinner-neon"></div></div>';
    
    const user = await getDocument('usuarios', uid);
    if (!user) {
        area.innerHTML = '<div class="empty-state text-danger">Usuario no encontrado</div>';
        return;
    }
    
    const name = user.nombreUsuario || user.nombre || 'Sin nombre';
    const photo = user.fotoPerfil || user.fotoURL;
    
    area.innerHTML = `
        <div class="modal-header-row mb-4">
            <h3 class="modal-title">Editar Usuario</h3>
            <button class="btn-icon-glass sm" onclick="document.getElementById('modal-edit-user').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4 flex-row gap-3 items-center">
            <div class="avatar-circle">
                ${photo ? `<img src="${photo}">` : `<span class="font-bold">${name.substring(0,2).toUpperCase()}</span>`}
            </div>
            <div class="flex-col">
                <span class="font-bold text-lg text-white">${name}</span>
                <span class="text-xs text-muted">${user.email || 'Sin email'}</span>
            </div>
        </div>
        
        <div class="stats-grid mb-4">
            <div class="stat-card blue p-2">
                <span class="stat-num text-lg">${user.partidosJugados || 0}</span>
                <span class="stat-label">Partidos</span>
            </div>
            <div class="stat-card green p-2">
                <span class="stat-num text-lg">${user.victorias || 0}</span>
                <span class="stat-label">Wins</span>
            </div>
            <div class="stat-card orange p-2">
                <span class="stat-num text-lg">${user.rachaActual || 0}</span>
                <span class="stat-label">Racha</span>
            </div>
        </div>
        
        <div class="form-stack">
            <div class="input-group">
                <label class="input-label">Nombre</label>
                <input type="text" id="edit-name" class="sport-input" value="${name}">
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <div class="input-group">
                    <label class="input-label">Nivel</label>
                    <input type="number" id="edit-level" class="sport-input" value="${(user.nivel || 2.5).toFixed(2)}" min="1" max="7" step="0.01">
                </div>
                <div class="input-group">
                    <label class="input-label">Puntos</label>
                    <input type="number" id="edit-pts" class="sport-input" value="${user.puntosRanking || 1000}">
                </div>
            </div>
            
            <div class="input-group">
                <label class="input-label">Rol</label>
                <select id="edit-rol" class="sport-input">
                    <option value="" ${!user.rol ? 'selected' : ''}>Usuario</option>
                    <option value="Admin" ${user.rol === 'Admin' ? 'selected' : ''}>Administrador</option>
                </select>
            </div>
            
            <div class="flex-row gap-3 mt-4">
                <button class="btn-primary flex-1" onclick="saveUser('${uid}')">
                    <i class="fas fa-save mr-2"></i>Guardar
                </button>
                <button class="btn-danger-glass" onclick="deleteUser('${uid}')">
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
    const rol = document.getElementById('edit-rol').value;
    
    try {
        await updateDocument('usuarios', uid, {
            nombreUsuario: name,
            nivel: Math.max(1, Math.min(7, nivel)),
            puntosRanking: Math.max(0, pts),
            rol: rol || null
        });
        showToast('Usuario actualizado', 'success');
        document.getElementById('modal-edit-user').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error al actualizar', 'error');
    }
};

window.deleteUser = async (uid) => {
    if (!confirm('¿Eliminar usuario irreversiblemente?')) return;
    try {
        await deleteDoc(doc(db, 'usuarios', uid));
        showToast('Usuario eliminado', 'warning');
        document.getElementById('modal-edit-user').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error al eliminar', 'error');
    }
};

window.editMatch = async (id, col) => {
    const overlay = document.getElementById('modal-edit-match');
    const area = document.getElementById('edit-match-area');
    overlay.classList.add('active');
    area.innerHTML = '<div class="loading-state"><div class="spinner-neon"></div></div>';
    
    const match = await getDocument(col, id);
    if (!match) {
        area.innerHTML = '<div class="empty-state text-danger">Partido no encontrado</div>';
        return;
    }
    
    const date = match.fecha?.toDate();
    const players = await Promise.all((match.jugadores || []).map(async uid => {
        if (uid.startsWith('GUEST_')) return { name: uid.split('_')[1] + ' (Inv)', id: uid, isGuest: true };
        const u = await getDocument('usuarios', uid);
        return { name: u?.nombreUsuario || u?.nombre || 'Desconocido', id: uid, isGuest: false };
    }));
    
    const isPlayed = match.estado === 'jugado';
    
    area.innerHTML = `
        <div class="modal-header-row mb-4">
            <h3 class="modal-title">Gestionar Partido</h3>
            <button class="btn-icon-glass sm" onclick="document.getElementById('modal-edit-match').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4 text-center">
            <div class="font-bold text-white text-lg">${date ? date.toLocaleDateString('es-ES') : 'Sin fecha'}</div>
            <div class="text-sm text-muted">${date ? date.toLocaleTimeString('es-ES') : ''}</div>
            ${match.resultado?.sets ? `<div class="mt-2 text-sport-green font-bold text-xl">${match.resultado.sets}</div>` : ''}
        </div>
        
        <div class="mb-4">
            <span class="text-xs text-muted uppercase font-bold mb-2 block">Jugadores (${players.length}/4)</span>
            <div class="flex-col gap-2">
                ${players.map((p, i) => `
                    <div class="flex-row between p-3 bg-white/5 rounded-xl items-center">
                        <span class="text-sm text-white font-bold">${i+1}. ${p.name}</span>
                        <button class="btn-icon-glass text-danger sm" onclick="removePlayer('${id}', '${col}', ${i})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="flex-col gap-2">
            ${!isPlayed && players.length === 4 ? `
                <button class="btn-action w-full" onclick="openResultForm('${id}', '${col}')">
                    <i class="fas fa-flag-checkered mr-2"></i>Finalizar y Puntuar
                </button>
            ` : ''}
            <div class="flex-row gap-2">
                <button class="btn-secondary flex-1" onclick="changeMatchDate('${id}', '${col}')">
                    <i class="fas fa-calendar mr-2"></i>Fecha
                </button>
                <button class="btn-danger-glass" onclick="deleteMatch('${id}', '${col}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
};

window.changeMatchDate = async (id, col) => {
    const newDate = prompt('Nueva fecha (DD/MM/YYYY HH:MM):');
    if (!newDate) return;
    
    try {
        const [datePart, timePart] = newDate.split(' ');
        const [day, month, year] = datePart.split('/').map(Number);
        const [hour, minute] = (timePart || '21:00').split(':').map(Number);
        const fecha = new Date(year, month - 1, day, hour, minute);
        
        await updateDocument(col, id, { fecha });
        showToast('Fecha actualizada', 'success');
        editMatch(id, col);
    } catch(e) {
        showToast('Formato inválido', 'error');
    }
};

window.openResultForm = (id, col) => {
    const res = prompt("Introduce el resultado (Ej: 6-4 6-3):");
    if(res) saveResult(id, col, res);
};

window.removePlayer = async (id, col, idx) => {
    const match = await getDocument(col, id);
    if (!match) return;
    const jugs = [...match.jugadores];
    jugs.splice(idx, 1);
    await updateDocument(col, id, { jugadores: jugs });
    editMatch(id, col);
};

window.deleteMatch = async (id, col) => {
    if (!confirm('¿Eliminar partido?')) return;
    await deleteDoc(doc(db, col, id));
    document.getElementById('modal-edit-match').classList.remove('active');
    loadData();
};

async function saveResult(id, col, result) {
    try {
        await updateDocument(col, id, { resultado: { sets: result }, estado: 'jugado' });
        
        // Trigger Ranking Update
        const { processMatchResults } = await import('./ranking-service.js');
        await processMatchResults(id, col, result);
        
        showToast('Partido finalizado y puntos procesados', 'success');
        document.getElementById('modal-edit-match').classList.remove('active');
        loadData();
    } catch (e) {
        showToast('Error al finalizar', 'error');
    }
}

window.refreshMatches = async () => {
    const list = document.getElementById('matches-list');
    if (list) list.innerHTML = '<div class="loading-state"><div class="spinner-neon"></div></div>';
    await loadData();
    showToast('Lista actualizada', 'info');
};

window.openAddPalaModal = () => document.getElementById('modal-add-pala').classList.add('active');

window.saveCatalogPala = async () => {
    const marca = document.getElementById('cat-pala-marca').value.trim();
    const modelo = document.getElementById('cat-pala-modelo').value.trim();
    const precio = document.getElementById('cat-pala-precio').value;
    const forma = document.getElementById('cat-pala-forma').value;
    const potencia = document.getElementById('cat-pala-pot').value;
    const control = document.getElementById('cat-pala-ctrl').value;
    
    if (!marca || !modelo) return showToast('Datos incompletos', 'warning');
    
    try {
        await addDocument('palasCatalogo', { marca, modelo, precio, forma, potencia, control });
        showToast('Pala añadida', 'success');
        document.getElementById('modal-add-pala').classList.remove('active');
        loadPalasCatalog();
    } catch(e) {
        showToast('Error al añadir', 'error');
    }
};

window.deleteCatalogPala = async (id) => {
    if (!confirm('¿Eliminar?')) return;
    await deleteDoc(doc(db, 'palasCatalogo', id));
    loadPalasCatalog();
};

window.saveConfig = () => {
    const config = {
        kFactor: parseFloat(document.getElementById('cfg-k').value),
        compMultiplier: parseFloat(document.getElementById('cfg-mult').value),
        levelMin: parseFloat(document.getElementById('cfg-lvl-min').value),
        levelMax: parseFloat(document.getElementById('cfg-lvl-max').value)
    };
    localStorage.setItem('padeluminatis_config', JSON.stringify(config));
    showToast('Configuración guardada', 'success');
};

window.recalculateAllRankings = async () => {
    if (!confirm('¿Seguro que quieres REINICIAR los puntos de TODOS los usuarios según su nivel?')) return;
    
    try {
        showToast('Procesando', 'Reiniciando ranking galáctico...', 'info');
        const snap = await getDocs(collection(db, "usuarios"));
        const batch = writeBatch(db);
        
        snap.docs.forEach(d => {
            const u = d.data();
            const level = u.nivel || 2.5;
            const newPoints = Math.round(1000 + (level - 2.5) * 400);
            batch.update(d.ref, { puntosRanking: newPoints });
        });
        
        await batch.commit();
        showToast('¡Hecho!', 'Puntos reiniciados correctamente', 'success');
        await loadData();
    } catch(e) {
        console.error(e);
        showToast('Error', 'Fallo al procesar el lote', 'error');
    }
};

window.resetAllStreaks = async () => {
    if (!confirm('¿Reiniciar rachas de todos los usuarios?')) return;
    const snap = await getDocs(collection(db, "usuarios"));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.update(d.ref, { rachaActual: 0 }));
    await batch.commit();
    showToast('Rachas reiniciadas', 'success');
};

window.clearOldMatches = () => showToast('Función en desarrollo', 'info');
