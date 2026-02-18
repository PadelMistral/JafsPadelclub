// admin.js - Complete Admin Panel Logic V5.0 (AI Integrated)
import { db, auth, observerAuth, getDocument, updateDocument, addDocument } from './firebase-service.js';
import { collection, getDocs, deleteDoc, doc, query, orderBy, where, writeBatch } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader } from './modules/ui-loader.js?v=6.5';
import { showToast } from './ui-core.js';
import { AIOrchestrator } from './ai-orchestrator.js'; // Phase 7 Integration
import { computePlacementProjection, getPlacementMatchesCount } from './provisional-ranking-logic.js';

let allUsers = [];
let allMatches = [];
let catalogPalas = [];
let aiSuggestions = [];

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
        
        // Phase 7: Sync Orchestrator
        AIOrchestrator.init(user.uid);
    });
    
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
            
            // Toggle Dashboard Visibility
            const dash = document.getElementById('admin-dashboard-v7');
            if(dash) {
                if(tab.dataset.tab === 'dashboard') dash.style.display = 'grid';
                else dash.style.display = 'none';
            }
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
            else if (f === 'open') renderMatches(allMatches.filter(m => {
                const filled = (m.jugadores || []).filter(u => u).length;
                return filled < 4 && m.estado !== 'jugado';
            }));
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
    const uSnap = await window.getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc")));
    allUsers = uSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsers(allUsers);
    renderPendingUsers(allUsers);
    
    const totalUsersEl = document.getElementById('total-users');
    if (totalUsersEl) totalUsersEl.textContent = allUsers.length;
    
    // Matches
    const [am, re] = await Promise.all([
        window.getDocsSafe(collection(db, "partidosAmistosos")),
        window.getDocsSafe(collection(db, "partidosReto"))
    ]);
    
    allMatches = [];
    am.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
    re.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', ...d.data() }));
    
    allMatches.sort((a, b) => (b.fecha?.toDate() || 0) - (a.fecha?.toDate() || 0));
    renderMatches(allMatches);
    
    const totalMatchesEl = document.getElementById('total-matches');
    if (totalMatchesEl) totalMatchesEl.textContent = allMatches.length;
    
    const activeMatchesEl = document.getElementById('active-matches');
    if (activeMatchesEl) activeMatchesEl.textContent = allMatches.filter(m => m.estado !== 'jugado' && (m.jugadores || []).filter(u => u).length < 4).length;

    // Render Premium Dashboard
    renderDashboard();
    await loadSuggestions();
}

function renderDashboard() {
    // 1. Calculate Global Metrics
    const approvedUsers = allUsers.filter(u => u.status === 'approved' || u.aprobado === true);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Active Users 7D (Unique users in matches last 7d)
    const matches7d = allMatches.filter(m => {
        const d = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        return d >= sevenDaysAgo;
    });
    
    const activeUids = new Set();
    matches7d.forEach(m => {
        (m.jugadores || []).forEach(uid => {
            if (uid && !uid.startsWith('GUEST_')) activeUids.add(uid);
        });
    });
    
    // Avg ELO
    const totalElo = approvedUsers.reduce((sum, u) => sum + (u.puntosRanking || 1000), 0);
    const avgElo = approvedUsers.length ? Math.round(totalElo / approvedUsers.length) : 0;
    
    // Highlights: Best Streak
    const bestStreakUser = [...approvedUsers].sort((a,b) => (b.rachaActual || 0) - (a.rachaActual || 0))[0];
    
    // Highlights: MVP Weekly (Most wins in last 7d matches)
    const winsMap = {};
    matches7d.filter(m => m.estado === 'jugado').forEach(m => {
        // Determine winners
        if (!m.resultado?.sets) return;
        // Simple logic: Assuming logic elsewhere handles complex sets, 
        // here just parse if we can or check who is defined as winner. 
        // Ideally match doc has 'winners' array? If not, skip for safety or infer.
        // For now, let's use 'rachaActual' diff or simply random if data is missing?
        // Better: Use `ranking-service` logic proxy -> Count appearances in played matches as 'Active MVP'
        // Since we can't easily parse winner without complex logic here, let's track "Most Active"
        (m.jugadores || []).forEach(uid => {
            if(uid) winsMap[uid] = (winsMap[uid] || 0) + 1;
        });
    });
    
    // DOM Updates
    if(document.getElementById('dash-total-users')) 
        document.getElementById('dash-total-users').innerText = approvedUsers.length;
    
    if(document.getElementById('dash-active-7d'))
        document.getElementById('dash-active-7d').innerText = activeUids.size;

    if(document.getElementById('dash-matches-7d'))
        document.getElementById('dash-matches-7d').innerText = matches7d.length;

    if(document.getElementById('dash-avg-elo'))
        document.getElementById('dash-avg-elo').innerText = avgElo;

    if(document.getElementById('dash-best-streak-val')) {
        document.getElementById('dash-best-streak-val').innerText = (bestStreakUser?.rachaActual || 0) + " W";
        document.getElementById('dash-best-streak-player').innerText = bestStreakUser?.nombreUsuario || '---';
    }

    // MVP Logic Replacement (Most Active) if wins ambiguous
    const sortedActivity = Object.entries(winsMap).sort((a,b) => b[1] - a[1]);
    if(document.getElementById('dash-mvp-val')) {
        if(sortedActivity.length > 0) {
            const mvpUid = sortedActivity[0][0];
            const mvpUser = allUsers.find(u => u.id === mvpUid);
            document.getElementById('dash-mvp-val').innerText = sortedActivity[0][1] + " P";
            document.getElementById('dash-mvp-player').innerText = mvpUser?.nombreUsuario || '---';
            // Update label to MOST ACTIVE
            const label = document.querySelector('.highlight-card-v7 .h-content .h-label');
            if(label && label.innerText.includes('MVP')) label.innerText = 'MÁS ACTIVO (7D)';
        }
    }

    // Recent Matches Feed
    const feedMatches = document.getElementById('dash-recent-matches');
    if(feedMatches) {
        const played = allMatches.filter(m => m.estado === 'jugado').slice(0, 5);
        feedMatches.innerHTML = played.map(m => {
            const date = m.fecha?.toDate().toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit'});
            return `
                <div class="feed-item-row" onclick="editMatch('${m.id}', '${m.col}')">
                    <div class="f-icon"><i class="fas fa-trophy text-gold"></i></div>
                    <div class="f-info">
                        <span class="f-main">${m.resultado?.sets || 'Finalizado'}</span>
                        <span class="f-sub">${date} · ${m.col === 'partidosReto' ? 'Competitivo' : 'Amistoso'}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // New Agents Feed
    const feedUsers = document.getElementById('dash-recent-users');
    if(feedUsers) {
        // Sort by createdAt desc if available
        const recentUsers = [...approvedUsers].sort((a,b) => {
            const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
            const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
            return tb - ta;
        }).slice(0, 5);

        feedUsers.innerHTML = recentUsers.map(u => {
            return `
                <div class="feed-item-row" onclick="editUser('${u.id}')">
                    <div class="f-icon"><i class="fas fa-user-shield text-cyan"></i></div>
                    <div class="f-info">
                        <span class="f-main">${u.nombreUsuario}</span>
                        <span class="f-sub">Nivel ${u.nivel} · ${u.puntosRanking} pts</span>
                    </div>
                </div>
            `;
        }).join('');
    }
}

async function loadPalasCatalog() {
    try {
        const snap = await window.getDocsSafe(collection(db, "palasCatalogo"));
        catalogPalas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPalasCatalog();
    } catch(e) {
        console.log('No palas catalog');
    }
}

function renderUsers(list) {
    const container = document.getElementById('users-list');
    if (!container) return;
    
    // Filter out pending users from main list for clarity
    const activeUsers = list.filter(u => u.status === 'approved' || u.aprobado === true);

    if (activeUsers.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-text">No users found</span></div>';
        return;
    }
    
    container.innerHTML = activeUsers.map((u, idx) => {
        const photo = u.fotoPerfil || u.fotoURL;
        const name = u.nombreUsuario || u.nombre || 'Sin nombre';
        
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
                    <span class="user-details">${u.email || 'Sin email'} · Nv.${Number(u.nivel || 2.5).toFixed(2)}</span>
                </div>
                <i class="fas fa-chevron-right text-muted"></i>
            </div>
        `;
    }).join('');
}

function renderPendingUsers(list) {
    const container = document.getElementById('pending-list');
    if (!container) return;

    // Filter pending: status 'pending' OR (aprobado false AND status undefined)
    const pending = list.filter(u => 
        u.status === 'pending' || (u.aprobado === false && !u.status)
    );

    if (pending.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-text">No hay solicitudes pendientes</span></div>';
        return;
    }

    container.innerHTML = pending.map(u => {
        const name = u.nombreUsuario || u.nombre || 'Solicitante';
        return `
            <div class="sport-card p-4 flex-col gap-3">
                <div class="flex-row gap-3 items-center">
                    <div class="avatar-circle">
                        <span class="font-bold text-xs">?</span>
                    </div>
                    <div class="flex-col">
                        <span class="font-bold text-white">${name}</span>
                        <span class="text-xs text-muted">Nivel solicitado: ${u.nivel}</span>
                        <span class="text-2xs text-muted">${u.email}</span>
                    </div>
                </div>
                <div class="flex-row gap-2">
                    <button class="btn-primary flex-1 py-2 text-xs" onclick="approveUser('${u.id}')">
                        <i class="fas fa-check mr-1"></i> APROBAR
                    </button>
                    <button class="btn-danger-glass flex-1 py-2 text-xs justify-center" onclick="rejectUser('${u.id}')">
                        <i class="fas fa-times mr-1"></i> RECHAZAR
                    </button>
                </div>
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
        const filledCount = (m.jugadores || []).filter(u => u).length;
        const isFull = filledCount === 4;
        
        let statusBadge = isPlayed ? '<span class="status-badge badge-orange xs">Jugado</span>' : 
                         (isFull ? '<span class="status-badge badge-blue xs">Completo</span>' : '<span class="status-badge badge-green xs">Abierto</span>');
        
        return `
            <div class="match-row" onclick="editMatch('${m.id}', '${m.col}')">
                <div class="flex-row between mb-2">
                    <div class="flex-row gap-2">
                        <span class="status-badge ${isComp ? 'badge-purple' : 'badge-blue'} xs">${isComp ? 'Competitivo' : 'Amistoso'}</span>
                        ${statusBadge}
                    </div>
                    <span class="text-xs text-muted font-bold">${filledCount}/4</span>
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

async function loadSuggestions() {
    try {
        const snap = await window.getDocsSafe(collection(db, "sugerenciasIA"));
        aiSuggestions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        aiSuggestions.sort((a, b) => {
            const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
            const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
            return tb - ta;
        });
        renderSuggestions(aiSuggestions);
    } catch (e) {
        console.error("Suggestions load error:", e);
        renderSuggestions([]);
    }
}

function renderSuggestions(list) {
    const container = document.getElementById('suggestions-list');
    if (!container) return;

    if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-text">Sin sugerencias por ahora</span></div>';
        return;
    }

    container.innerHTML = list.map((s) => {
        const date = s.createdAt?.toDate ? s.createdAt.toDate() : new Date();
        const when = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' ' + date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="sport-card p-4 flex-col gap-3">
                <div class="flex-row between items-center">
                    <span class="text-xs font-black text-primary uppercase">${(s.title || 'Sin título')}</span>
                    <span class="text-[9px] text-muted">${when}</span>
                </div>
                <p class="text-xs text-white/80 leading-relaxed">${(s.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                <div class="flex-row between items-center">
                    <span class="text-[9px] text-muted">Estado: ${(s.status || 'new').toUpperCase()}</span>
                    <button class="btn-primary sm" onclick="markSuggestionDone('${s.id}')">Marcar revisada</button>
                </div>
            </div>
        `;
    }).join('');
}

window.markSuggestionDone = async (id) => {
    try {
        await updateDocument('sugerenciasIA', id, { status: 'reviewed' });
        showToast('Actualizado', 'Sugerencia marcada como revisada.', 'success');
        await loadSuggestions();
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo actualizar la sugerencia.', 'error');
    }
};

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
                <label class="input-label">Nombre visible</label>
                <input type="text" id="edit-name" class="sport-input" value="${name}">
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="input-group">
                    <label class="input-label">Nombre (perfil)</label>
                    <input type="text" id="edit-fullname" class="sport-input" value="${user.nombre || ''}">
                </div>
                <div class="input-group">
                    <label class="input-label">Telefono</label>
                    <input type="text" id="edit-phone" class="sport-input" value="${user.telefono || ''}">
                </div>
            </div>

            <div class="input-group">
                <label class="input-label">Vivienda</label>
                <input type="text" id="edit-home" class="sport-input" value="${user.vivienda || ''}" placeholder="Bloque / Piso / Puerta">
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <div class="input-group">
                    <label class="input-label">Nivel</label>
                    <input type="number" id="edit-level" class="sport-input" value="${Number(user.nivel || 2.5).toFixed(2)}" min="1" max="7" step="0.01">
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

            <button class="btn-secondary w-full justify-center" onclick="recalculateUserRanking('${uid}')">
                <i class="fas fa-calculator mr-2"></i>Recalcular Ranking de este Usuario
            </button>
            
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
    const fullName = document.getElementById('edit-fullname').value.trim();
    const phone = document.getElementById('edit-phone').value.trim();
    const home = document.getElementById('edit-home').value.trim();
    const nivel = parseFloat(document.getElementById('edit-level').value);
    const pts = parseInt(document.getElementById('edit-pts').value);
    const rol = document.getElementById('edit-rol').value;
    const safeLevel = Number.isFinite(nivel) ? Math.max(1, Math.min(7, nivel)) : 2.5;
    const safePoints = Number.isFinite(pts) ? Math.max(0, pts) : 1000;
    
    try {
        await updateDocument('usuarios', uid, {
            nombreUsuario: name || 'Jugador',
            nombre: fullName || null,
            telefono: phone || null,
            vivienda: home || null,
            nivel: safeLevel,
            puntosRanking: safePoints,
            rol: rol || null
        });
        
        // Phase 7: Recalculate State if Admin changes stats directly
        // This ensures the AI adapts to manual overrides
        try {
             await AIOrchestrator.recalculatePlayerState(uid);
        } catch(err) { console.warn("AI Update failed:", err); }

        showToast('Usuario actualizado', 'success');
        document.getElementById('modal-edit-user').classList.remove('active');
        await loadData();
    } catch (e) {
        showToast('Error al actualizar', 'error');
    }
};

window.recalculateUserRanking = async (uid) => {
    const totalPlacementMatches = getPlacementMatchesCount();
    try {
        const user = await getDocument('usuarios', uid);
        if (!user) {
            showToast('Usuario no encontrado', 'error');
            return;
        }

        const projection = computePlacementProjection(user);
        await updateDocument('usuarios', uid, {
            nivel: projection.suggestedLevel,
            puntosRanking: projection.suggestedPoints,
            rankingCalibration: {
                mode: projection.isProvisional ? 'placement' : 'stable',
                played: projection.played,
                wins: projection.wins,
                confidence: projection.confidence,
                placementTarget: totalPlacementMatches,
                updatedAt: new Date().toISOString(),
                updatedBy: auth.currentUser?.uid || null
            }
        });

        showToast(
            'Ranking recalculado',
            `${projection.modeLabel} · Nivel ${projection.suggestedLevel} · ${projection.suggestedPoints} pts`,
            'success'
        );
        await loadData();
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo recalcular el usuario', 'error');
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
        if (!uid) return { name: null, id: null, isGuest: false };
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
            <span class="text-xs text-muted uppercase font-bold mb-2 block">Jugadores (${players.filter(p => p.id && !p.id.startsWith('GUEST_')).length}/4)</span>
            <div class="flex-col gap-2">
                ${players.map((p, i) => {
                    if (!p.id) return `
                        <div class="flex-row between p-3 bg-white/5 rounded-xl items-center opacity-40">
                            <span class="text-sm text-white font-bold italic">${i+1}. LIBRE</span>
                        </div>
                    `;
                    return `
                        <div class="flex-row between p-3 bg-white/5 rounded-xl items-center">
                            <span class="text-sm text-white font-bold">${i+1}. ${p.name}</span>
                            <button class="btn-icon-glass text-danger sm" onclick="removePlayer('${id}', '${col}', ${i})">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        
        <div class="flex-col gap-2">
            ${isPlayed ? `
                <button class="btn-secondary w-full" onclick="window.openResultForm('${id}', '${col}', true)">
                    <i class="fas fa-rotate mr-2"></i>Reprocesar Ranking
                </button>
            ` : (players.length === 4 ? `
                <button class="btn-action w-full" onclick="window.openResultForm('${id}', '${col}')">
                    <i class="fas fa-flag-checkered mr-2"></i>Finalizar y Puntuar
                </button>
            ` : '')}
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

window.openResultForm = (id, col, isReprocess = false) => {
    const msg = isReprocess ? "Introduce el resultado para REPROCESAR (Ej: 6-4 6-3):" : "Introduce el resultado (Ej: 6-4 6-3):";
    const res = prompt(msg);
    if (res) {
        showToast("Procesando...", "Sincronizando puntos con el ranking central.", "info");
        saveResult(id, col, res);
    }
};

window.removePlayer = async (id, col, idx) => {
    const match = await getDocument(col, id);
    if (!match) return;
    const jugs = [...match.jugadores];
    jugs[idx] = null;
    await updateDocument(col, id, { 
        jugadores: jugs,
        equipoA: [jugs[0], jugs[1]],
        equipoB: [jugs[2], jugs[3]]
    });
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
        const { processMatchResults } = await import('./ranking-service.js');
        const res = await processMatchResults(id, col, result);
        
        if (!res.success) {
            throw new Error(res.error || "Error desconocido al procesar ranking");
        }

        // Phase 8: Notify Orchestrator for ALL players in the match
        try {
            const match = await getDocument(col, id);
            if (match?.jugadores) {
                match.jugadores.forEach(uid => {
                    if (uid && !uid.startsWith('GUEST_')) {
                        AIOrchestrator.dispatch('MATCH_FINISHED', { uid, matchId: id });
                    }
                });
            }
        } catch(err) { console.warn("Admin AI sync:", err); }
        
        showToast('Partido finalizado y puntos procesados', 'Ranking actualizado correctamente', 'success');
        document.getElementById('modal-edit-match').classList.remove('active');
        loadData();
    } catch (e) {
        console.error("Save Result Error:", e);
        showToast('Error al finalizar', e.message || 'Error en la sincronización', 'error');
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
        const snap = await window.getDocsSafe(collection(db, "usuarios"));
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

window.syncAllMatchesToRanking = async () => {
    if (!confirm('Esta acción buscará todos los partidos jugados NO procesados y actualizará el Ranking. ¿Continuar?')) return;
    
    try {
        showToast("Sincronizando...", "Escaneando base de datos táctica.", "info");
        const { processMatchResults } = await import('./ranking-service.js');
        
        // Fetch ALL matches to avoid Index Requirement for a one-time sync tool
        const amSnap = await getDocs(query(collection(db, "partidosAmistosos"), orderBy("fecha", "asc")));
        const reSnap = await getDocs(query(collection(db, "partidosReto"), orderBy("fecha", "asc")));
        
        const allMatches = [
            ...amSnap.docs.map(d => ({ id: d.id, data: d.data(), col: "partidosAmistosos" })),
            ...reSnap.docs.map(d => ({ id: d.id, data: d.data(), col: "partidosReto" }))
        ].filter(m => m.data.estado === 'jugado' && m.data.resultado?.sets && !m.data.rankingProcessedAt)
         .sort((a,b) => (a.data.fecha?.toDate?.() || 0) - (b.data.fecha?.toDate?.() || 0));

        if (allMatches.length === 0) {
            return showToast("Sincronización Terminada", "No se encontraron partidos pendientes de procesar.", "info");
        }

        let processed = 0;
        let errors = 0;

        for (const m of allMatches) {
            const res = await processMatchResults(m.id, m.col, m.data.resultado.sets);
            if (res.success && !res.skipped) processed++;
            else if (!res.success) {
                console.warn(`Error procesando partido ${m.id}:`, res.error);
                errors++;
            }
        }

        showToast("Sincronización Completa", `Procesados: ${processed} | Errores: ${errors}`, processed > 0 ? "success" : "info");
        loadData();
    } catch (e) {
        console.error("Sync error:", e);
        showToast("Error de Sincronización", e.message, "error");
    }
};

window.resetAllStreaks = async () => {
    if (!confirm('¿Reiniciar rachas de todos los usuarios?')) return;
    const snap = await window.getDocsSafe(collection(db, "usuarios"));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.update(d.ref, { rachaActual: 0 }));
    await batch.commit();
    showToast('Rachas reiniciadas', 'success');
};


window.clearOldMatches = () => showToast('Función en desarrollo', 'info');

window.approveUser = async (uid) => {
    try {
        await updateDocument('usuarios', uid, { status: 'approved', aprobado: true });
        showToast('Usuario Aprobado', 'Acceso concedido', 'success');
        await loadData();
    } catch (e) {
        showToast('Error', 'No se pudo aprobar', 'error');
    }
};

window.rejectUser = async (uid) => {
    if (!confirm("¿Rechazar solicitud? El usuario será eliminado.")) return;
    try {
        await deleteDoc(doc(db, 'usuarios', uid)); 
        showToast('Solicitud Rechazada', 'Usuario eliminado', 'info');
        await loadData();
    } catch (e) {
        showToast('Error', 'No se pudo rechazar', 'error');
    }
};

