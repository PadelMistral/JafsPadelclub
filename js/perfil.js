// perfil.js - Pro Player Profile (v15.0) with Address, ELO Graph & Enhanced Palas
import { auth, db, observerAuth, subscribeDoc, updateDocument, uploadProfilePhoto, getDocument } from './firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast, countUp, initAppUI } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js';

document.addEventListener('DOMContentLoaded', () => {
    initBackground();
    setupModals();
    
    let currentUser = null;
    let userData = null;
    let eloChart = null;

    observerAuth(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        
        currentUser = user;
        const data = await getDocument('usuarios', user.uid);
        if (data) {
            await injectHeader(data);
            injectNavbar('profile');
        }
        
        subscribeDoc("usuarios", user.uid, (data) => {
            if (data) {
                userData = data;
                renderProfileData(data);
                loadEloHistory(user.uid);
            }
        });
    });

    async function renderProfileData(data) {
        const nameEl = document.getElementById('p-name');
        const roleEl = document.getElementById('p-role');
        const avatarEl = document.getElementById('p-avatar');
        const userInp = document.getElementById('p-username-inp');
        
        const photo = data.fotoPerfil || data.fotoURL;
        const name = (data.nombreUsuario || data.nombre || 'JUGADOR');
        const phone = data.telefono || '';

        if (nameEl) nameEl.textContent = name.toUpperCase();
        if (roleEl) roleEl.textContent = (data.rol || 'PRO TOUR MEMBER').toUpperCase();
        if (avatarEl && photo) avatarEl.src = photo;
        if (userInp) userInp.value = name;
        if (document.getElementById('p-phone-inp')) document.getElementById('p-phone-inp').value = phone;

        countUp(document.getElementById('p-nivel'), (data.nivel || 2.5).toFixed(2));
        countUp(document.getElementById('p-puntos'), Math.round(data.puntosRanking || 1000));
        const winrate = data.partidosJugados > 0 ? Math.round((data.victorias / data.partidosJugados) * 100) : 0;
        document.getElementById('p-winrate').textContent = winrate + '%';

        // Vivienda fields
        const viv = data.vivienda || data.direccion; // Fallback for old data
        if (viv) {
            document.getElementById('addr-bloque').value = viv.bloque || '';
            document.getElementById('addr-piso').value = viv.piso || '';
            document.getElementById('addr-puerta').value = viv.puerta || '';
        }

        // Level Progress Bar
        updateLevelProgress(data.nivel || 2.5, data.puntosRanking || 1000);

        renderGear(data.palas || []);
    }

    function updateLevelProgress(nivel, puntos) {
        const currentLevel = Math.floor(nivel * 2) / 2; // Round to 0.5
        const nextLevel = currentLevel + 0.5;
        const prevLevel = currentLevel - 0.5;
        
        // Progress within current level bracket
        const progress = ((nivel - currentLevel) / 0.5) * 100;
        
        const bar = document.getElementById('level-bar');
        const progressText = document.getElementById('level-progress-text');
        const lowerLabel = document.getElementById('level-lower');
        const currentLabel = document.getElementById('level-current');
        const upperLabel = document.getElementById('level-upper');
        
        if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        
        if (progressText) {
            const pointsNeeded = Math.round((0.5 - (nivel - currentLevel)) * 100);
            if (progress >= 90) {
                progressText.textContent = '¡Casi subes!';
                progressText.classList.add('text-sport-green');
            } else {
                progressText.textContent = `~${pointsNeeded} pts para subir`;
            }
        }
        
        if (lowerLabel) lowerLabel.textContent = prevLevel.toFixed(1);
        if (currentLabel) currentLabel.textContent = `Nivel ${nivel.toFixed(2)}`;
        if (upperLabel) upperLabel.textContent = nextLevel.toFixed(1);
    }

    async function loadEloHistory(uid) {
        try {
            const logs = await getDocs(query(
                collection(db, "rankingLogs"), 
                where("uid", "==", uid), 
                orderBy("timestamp", "desc"), 
                limit(10)
            ));
            
            const data = logs.docs.map(d => d.data()).reverse();
            renderEloChart(data);
        } catch(e) {
            console.log('No ELO history yet');
        }
    }

    function renderEloChart(logs) {
        const canvas = document.getElementById('elo-chart');
        if (!canvas) return;
        
        if (logs.length < 2) {
            canvas.parentElement.innerHTML = `
                <div class="center flex-col py-6 opacity-40">
                    <i class="fas fa-chart-line text-2xl mb-2"></i>
                    <span class="text-xs">Juega más partidos para ver tu evolución</span>
                </div>
            `;
            return;
        }
        
        const labels = logs.map((_, i) => `P${i + 1}`);
        const points = logs.map(l => l.newTotal);
        
        if (eloChart) eloChart.destroy();
        
        eloChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'ELO',
                    data: points,
                    borderColor: '#a3e635',
                    backgroundColor: 'rgba(163, 230, 53, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#a3e635',
                    pointBorderColor: '#fff',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { 
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }
                    },
                    x: { 
                        display: true,
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }
                    }
                }
            }
        });
    }

    function renderGear(palas) {
        const list = document.getElementById('gear-container');
        if (!list) return;

        if (palas.length === 0) {
            list.innerHTML = `
                <div class="gear-card" style="justify-content:center; opacity: 0.5">
                    <span class="text-xs">No has registrado ninguna pala todavía</span>
                </div>
            `;
            return;
        }

        list.innerHTML = palas.map((p, idx) => `
            <div class="gear-card">
                <div class="flex-row">
                    <div class="gear-icon">
                        <i class="fas fa-table-tennis text-white"></i>
                    </div>
                    <div class="flex-col gap-0">
                        <span class="text-sm font-bold text-white">${p.modelo}</span>
                        <span class="text-2xs text-scnd uppercase tracking-wider">${p.marca}</span>
                        ${p.forma ? `<span class="text-2xs text-sport-blue mt-1">${p.forma} · ${p.peso || ''}</span>` : ''}
                    </div>
                </div>
                <div class="flex-row gap-2">
                    ${p.potencia ? `
                        <div class="flex-col center" style="width: 30px">
                            <span class="text-2xs text-sport-orange font-bold">${p.potencia}</span>
                            <span class="text-2xs opacity-40">POT</span>
                        </div>
                    ` : ''}
                    ${p.control ? `
                        <div class="flex-col center" style="width: 30px">
                            <span class="text-2xs text-sport-blue font-bold">${p.control}</span>
                            <span class="text-2xs opacity-40">CTR</span>
                        </div>
                    ` : ''}
                    <button class="text-red-400 ml-2" onclick="removePala(${idx})" style="background:none; border:none; padding:8px">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    window.openGearModal = () => {
        document.getElementById('modal-gear').classList.add('active');
        
        // Setup range sliders
        ['potencia', 'control', 'manejo'].forEach(id => {
            const range = document.getElementById(`gear-${id}`);
            const val = document.getElementById(`val-${id}`);
            if (range && val) {
                range.oninput = () => val.textContent = range.value;
            }
        });
    };

    window.savePala = async () => {
        const marca = document.getElementById('gear-marca').value.trim();
        const modelo = document.getElementById('gear-modelo').value.trim();
        const potencia = parseInt(document.getElementById('gear-potencia').value);
        const control = parseInt(document.getElementById('gear-control').value);
        const manejo = parseInt(document.getElementById('gear-manejo').value);
        const forma = document.getElementById('gear-forma').value;
        const peso = document.getElementById('gear-peso').value;
        
        if (!marca || !modelo) return showToast("Faltan datos", "Introduce marca y modelo.", "warning");

        const currentPalas = userData.palas || [];
        currentPalas.push({ 
            marca, 
            modelo, 
            potencia,
            control,
            manejo,
            forma,
            peso,
            date: new Date().toISOString() 
        });

        try {
            await updateDocument('usuarios', currentUser.uid, { palas: currentPalas });
            showToast("Guardado", "Nueva pala añadida al inventario.", "success");
            document.getElementById('modal-gear').classList.remove('active');
            // Reset form
            ['gear-marca', 'gear-modelo', 'gear-forma', 'gear-peso'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            ['gear-potencia', 'gear-control', 'gear-manejo'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '5';
                const val = document.getElementById(`val-${id.replace('gear-', '')}`);
                if (val) val.textContent = '5';
            });
        } catch(e) { 
            showToast("Error", "No se pudo guardar.", "error"); 
        }
    };

    window.removePala = async (idx) => {
        if (!confirm("¿Eliminar esta pala?")) return;
        const currentPalas = userData.palas || [];
        currentPalas.splice(idx, 1);
        await updateDocument('usuarios', currentUser.uid, { palas: currentPalas });
        showToast("Eliminada", "Pala eliminada del inventario.", "info");
    };

    // Save Vivienda
    document.getElementById('save-address')?.addEventListener('click', async () => {
        const bloque = document.getElementById('addr-bloque').value.trim();
        const piso = document.getElementById('addr-piso').value.trim();
        const puerta = document.getElementById('addr-puerta').value.trim();
        
        try {
            await updateDocument('usuarios', currentUser.uid, { 
                vivienda: { bloque, piso, puerta } 
            });
            showToast("Guardado", "Información de vivienda actualizada.", "success");
        } catch(e) {
            showToast("Error", "No se pudo guardar la información.", "error");
        }
    });

    // Save Phone
    document.getElementById('p-save-phone')?.addEventListener('click', async () => {
        const phone = document.getElementById('p-phone-inp').value.trim();
        try {
            await updateDocument('usuarios', currentUser.uid, { telefono: phone });
            showToast("Guardado", "Teléfono actualizado.", "success");
        } catch(e) {
            showToast("Error", "No se pudo guardar el teléfono.", "error");
        }
    });

    // Photo Upload
    const photoUp = document.getElementById('upload-photo');
    if(photoUp) photoUp.onchange = async () => {
        const file = photoUp.files[0];
        if (!file) return;
        try {
            showToast("Subiendo...", "Actualizando foto de perfil...", "info");
            const url = await uploadProfilePhoto(currentUser.uid, file);
            await updateDocument('usuarios', currentUser.uid, { fotoPerfil: url, fotoURL: url });
            showToast("Éxito", "Foto actualizada.", "success");
        } catch(e) { showToast("Error", "Fallo en la carga.", "error"); }
    };

    // Save Name
    const btnSaveName = document.getElementById('p-save-name');
    if(btnSaveName) btnSaveName.onclick = async () => {
        const newName = document.getElementById('p-username-inp').value.trim();
        if (newName) {
            await updateDocument('usuarios', currentUser.uid, { nombreUsuario: newName });
            showToast("Guardado", "Nombre actualizado.", "success");
        }
    };

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if(btnLogout) btnLogout.onclick = async () => {
        if (confirm("¿Cerrar sesión?")) {
            const { logout } = await import('./firebase-service.js');
            await logout();
            window.location.href = 'index.html';
        }
    };
});
