/* =====================================================
   PADELUMINATIS CALENDAR ENGINE V7.0
   Mistral-Inspired Modern Matrix Logic.
   ===================================================== */

import { db, auth, observerAuth, subscribeDoc, getDocument, subscribeCol } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where, addDoc, doc, getDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast, countUp } from './ui-core.js';
import { renderMatchDetail, renderCreationForm } from './match-service.js';

let currentUser = null;
let userData = null;
let currentWeekOffset = 0;
let allMatches = [];
let weeklyWeather = null;

async function fetchWeeklyWeather() {
    try {
        const { getDetailedWeather } = await import('./external-data.js');
        weeklyWeather = await getDetailedWeather();
    } catch (e) { console.error("Weather error:", e); }
}

const HOURS = [
    { start: "08:00", end: "09:30" },
    { start: "09:30", end: "11:00" },
    { start: "11:00", end: "12:30" },
    { start: "12:30", end: "14:00" }, 
    { start: "14:30", end: "16:00" },
    { start: "16:00", end: "17:30" },
    { start: "17:30", end: "19:00" },
    { start: "19:00", end: "20:30" },
    { start: "20:30", end: "22:00" }
];

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('calendar');
    startClock();
    
    observerAuth(async (user) => {
        try {
            if (!user) {
                window.location.href = 'index.html';
                return;
            }
            currentUser = user;
            
            // Initial data load
            const uData = await getDocument('usuarios', user.uid);
            userData = uData || {};
            
            // Sync matches from both collections
            subscribeCol("partidosAmistosos", () => syncMatches());
            subscribeCol("partidosReto", () => syncMatches());
            
            syncMatches(); // Initial trigger
        } catch (e) {
            console.error('Calendar init error:', e);
            renderGrid();
        }
    });

    // Navigation setup
    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.onclick = () => { currentWeekOffset--; renderGrid(); };
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.onclick = () => { currentWeekOffset++; renderGrid(); };
});

function startClock() {
    const timeEl = document.getElementById('current-time-v5');
    const dateEl = document.getElementById('current-date-v5');
    
    const update = () => {
        const now = new Date();
        if (timeEl) timeEl.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (dateEl) {
            const options = { weekday: 'long', day: 'numeric', month: 'short' };
            dateEl.textContent = now.toLocaleDateString('es-ES', options).toUpperCase();
        }
    };
    update();
    setInterval(update, 1000);
}

async function syncMatches() {
    try {
        const [snapA, snapR] = await Promise.all([
            window.getDocsSafe(collection(db, "partidosAmistosos")),
            window.getDocsSafe(collection(db, "partidosReto"))
        ]);
        
        allMatches = [];
        snapA.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
        snapR.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', isComp: true, ...d.data() }));
        
        await fetchWeeklyWeather();
        renderGrid();
    } catch (e) {
        console.error('Calendar sync error:', e);
        allMatches = [];
        renderGrid();
    }
}

function renderGrid() {
    const container = document.getElementById('calendar-grid-v5');
    if (!container) return;

    const today = new Date();
    const startOfWeek = new Date(today);
    const day = today.getDay() || 7; 
    startOfWeek.setDate(today.getDate() - day + 1 + (currentWeekOffset * 7));
    startOfWeek.setHours(0,0,0,0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    // Update labels
    const weekLabel = document.getElementById('week-range-text');
    const monthLabel = document.getElementById('month-year-text');
    if (weekLabel) weekLabel.textContent = `${startOfWeek.getDate()} - ${endOfWeek.getDate()}`;
    if (monthLabel) monthLabel.textContent = `${startOfWeek.toLocaleDateString('es-ES', {month: 'long', year: 'numeric'})}`.toUpperCase();

    let html = `
        <div class="grid-header-v5">
            <div class="corner-header-v5">GMT</div>
            ${Array.from({length: 7}).map((_, i) => {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                const isToday = d.toDateString() === new Date().toDateString();
                return `
                    <div class="day-header-v5 ${isToday ? 'today' : ''}">
                        <span class="d-name">${d.toLocaleDateString('es-ES', { weekday: 'short' }).substring(0,3)}</span>
                        <span class="d-num">${d.getDate()}</span>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="grid-body-v5">
    `;

    HOURS.forEach((hObj, idx) => {
        html += `<div class="time-row-v5">
            <div class="time-col-v5">
                <span class="t-start">${hObj.start}</span>
                <span class="t-end">${hObj.end}</span>
            </div>
            ${Array.from({length: 7}).map((_, i) => {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                return renderSlot(d, hObj.start);
            }).join('')}
        </div>`;
        if (hObj.start === '12:30') html += `<div class="break-v5">DESCANSO</div>`;
    });

    container.innerHTML = html + `</div>`;
    focusToday();
}

function renderSlot(date, hour) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const dStr = `${year}-${month}-${day}`;

    const [h, min] = hour.split(':').map(Number);
    const slotTime = new Date(date);
    slotTime.setHours(h, min, 0, 0);
    const slotEnd = new Date(slotTime);
    slotEnd.setMinutes(slotEnd.getMinutes() + 90);

    const match = allMatches.find(m => {
        const mDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        if (Number.isNaN(mDate.getTime())) return false;
        const mYear = mDate.getFullYear();
        const mMonth = (mDate.getMonth() + 1).toString().padStart(2, '0');
        const mDay = mDate.getDate().toString().padStart(2, '0');
        const mDStr = `${mYear}-${mMonth}-${mDay}`;
        if (mDStr !== dStr) return false;
        const mTime = mDate.getTime();
        return mTime >= slotTime.getTime() && mTime < slotEnd.getTime();
    });
    
    const isPast = slotEnd < new Date();
    let state = 'free';
    let label = 'Libre';
    let sub = '';
    let extraIcon = '';
    let isLocked = false;

    if (match) {
        // Private Match Check
        if (match.visibility === 'private' && currentUser) {
            const uid = currentUser.uid;
             if (match.organizerId !== uid && match.creador !== uid && !(match.invitedUsers || []).includes(uid) && !(match.jugadores || []).includes(uid)) {
                state = 'bloqueado';
                label = 'PRIVADA';
                sub = 'RESERVADO';
                extraIcon = '<i class="fas fa-lock text-white/50 absolute top-2 right-2 text-xs"></i>';
                isLocked = true;
            }
        }

        if (!isLocked) {
            const isMine = !!currentUser && match.jugadores?.includes(currentUser.uid);
            const count = (match.jugadores || []).filter(id => id).length;
            const isFull = count >= 4;
            const isPlayed = match.estado === 'jugado';
            
            if (isPlayed) {
                state = 'jugado';
                label = 'JUGADO';
                sub = match.resultado?.sets || 'VER RES';
                if (isMine) {
                    const hasDiary = userData?.diario?.some(e => e.matchId === match.id);
                    if (!hasDiary) {
                        label = 'DIARIO';
                        extraIcon = '<i class="fas fa-exclamation-triangle pulse-warning absolute top-1 right-1 text-[10px] text-yellow-400"></i>';
                    } else {
                        label = 'FINALIZADO';
                    }
                }
            } else {
                if (isMine) {
                    state = 'propia';
                    label = 'TU PARTIDO';
                    sub = 'VER DETALLES';
                }
                else if (isFull) {
                    state = 'cerrada';
                    label = 'COMPLETO';
                    sub = 'SQUAD LLENO';
                }
                else {
                    state = 'abierta';
                    label = 'DISPONIBLE';
                    sub = `${4 - count} PLAZAS`;
                }
            }
        }
    }

    // Weather logic
    let weatherHtml = '';
    if (weeklyWeather && weeklyWeather.daily) {
        const targetDate = date.toISOString().split('T')[0];
        const dayIdx = weeklyWeather.daily.time.indexOf(targetDate);
        if (dayIdx !== -1) {
            const code = weeklyWeather.daily.weather_code[dayIdx];
            const temp = Math.round(weeklyWeather.daily.temperature_2m_max[dayIdx]);
            const icon = getIconFromCode(code);
            const wx = getWeatherStateFromCode(code);
            weatherHtml = `<div class="slot-weather ${wx}"><i class="fas ${icon}"></i> <span>${temp}°</span></div>`;
        }
    }

    return `
        <div class="slot-v5 ${state} ${isPast ? 'past' : ''} relative" onclick="handleSlot('${dStr}', '${hour}', '${match?.id || ''}', '${match?.col || ''}')">
            ${extraIcon}
            ${weatherHtml}
            <span class="slot-chip-v5">${label}</span>
            <span class="slot-info-v5">${sub}</span>
        </div>
    `;
}

function getWeatherStateFromCode(code) {
    if (code === 0) return "sunny";
    if (code <= 3) return "cloudy";
    if (code <= 48) return "cloudy";
    if (code <= 82) return "rainy";
    if (code <= 99) return "rainy";
    return "cloudy";
}

function getIconFromCode(code) {
    if (code === 0) return 'fa-sun text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]';
    if (code <= 3) return 'fa-cloud-sun text-orange-300';
    if (code <= 48) return 'fa-smog text-gray-400';
    if (code <= 67) return 'fa-cloud-rain text-blue-400';
    if (code <= 77) return 'fa-snowflake text-white';
    if (code <= 82) return 'fa-cloud-showers-heavy text-blue-500';
    if (code <= 99) return 'fa-bolt text-yellow-500';
    return 'fa-cloud text-gray-400';
}

// Global Handlers
window.handleSlot = async (date, hour, id, col) => {
    const modal = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    const title = document.getElementById('modal-titulo');
    
    if(!modal || !area) return;

    modal.classList.add('active');
    area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
    if(title) title.textContent = id ? 'DETALLES DE MISIÓN' : 'NUEVO DESPLIEGUE';

    try {
        if (id) {
            await renderMatchDetail(area, id, col, currentUser, userData);
        } else {
            await renderCreationForm(area, date, hour, currentUser, userData);
        }
    } catch(e) {
        console.error("Render error:", e);
        area.innerHTML = '<div class="center p-10 opacity-50">Error de carga</div>';
    }
};

window.handleSelectorSearch = (val) => {
    const term = val.toLowerCase();
    const items = document.querySelectorAll('.u-item-list-v5');
    items.forEach(it => {
        const name = it.querySelector('.u-name-v5').textContent.toLowerCase();
        it.style.display = name.includes(term) ? 'flex' : 'none';
    });
};

// Adapter for match-service.js calling convention
window.openPlayerSelector = async (mid, col, extra) => {
    // extra contains {idx: 1}
    window.openUserPicker(extra.idx);
};

window.openUserPicker = async (slotIndex) => {
    const picker = document.getElementById('modal-user-picker');
    const list = document.getElementById('user-picker-list');
    if(!picker || !list) return;

    picker.classList.add('active');
    picker.dataset.slotIndex = slotIndex;
    
    // Reset and Always reload for fresh data
    list.innerHTML = '<div class="center py-10"><div class="spinner-galaxy"></div></div>';
    
    try {
        const getDocsFn = window.getDocsSafe || getDocs;
        const snap = await getDocsFn(query(collection(db, "usuarios"), limit(50)));
        
        if (snap.empty) {
            list.innerHTML = '<div class="center p-10 opacity-50">No hay otros agentes disponibles.</div>';
            return;
        }

        list.innerHTML = snap.docs.map(d => {
            const u = d.data();
            if (d.id === currentUser?.uid) return ''; // Skip self
            const photo = u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png';
            return `
                <div class="u-item-list-v5 animate-fade-in" onclick="selectUserForSlot('${d.id}', '${(u.nombreUsuario || u.nombre || 'Jugador').toUpperCase()}', '${photo}')">
                    <div class="u-item-left">
                        <div class="u-avatar-v5"><img src="${photo}"></div>
                        <div class="flex-col">
                            <span class="u-name-v5">${u.nombreUsuario || u.nombre || 'Jugador'}</span>
                            <span class="u-lvl-v5">Nivel ${(u.nivel || 2.5).toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="u-add-btn"><i class="fas fa-plus"></i></div>
                </div>
            `;
        }).join('');
    } catch(e) {
        console.error("User Picker Error:", e);
        list.innerHTML = '<div class="center p-10 text-red-400">Error al sincronizar agentes.</div>';
    }
};

window.selectUserForSlot = (uid, name, photo) => {
    const picker = document.getElementById('modal-user-picker');
    const idx = picker.dataset.slotIndex;
    
    // Update global state for creation
    if (window._initialJugadores) {
        window._initialJugadores[idx] = uid;
    }

    // Update V7 DOM in match-service creation form
    const slotEl = document.getElementById(`slot-${idx}-wrap`);
    if (slotEl) {
        slotEl.className = 'p-slot-v7 active';
        slotEl.removeAttribute('onclick');
        slotEl.innerHTML = `
            <div class="p-img-box">
                <img src="${photo}">
            </div>
            <span class="p-badge" style="color:var(--primary); border-color:var(--primary)">2.5</span>
            <span class="text-[8px] font-black uppercase text-white tracking-widest mt-1 truncate w-16 text-center">${name}</span>
            <button class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex center text-white text-[8px]" onclick="event.stopPropagation(); clearSlot('${idx}')"><i class="fas fa-times"></i></button>
        `;
    }
    picker.classList.remove('active');
};

window.clearSlot = (idx) => {
    // Update global state
    if (window._initialJugadores) {
        window._initialJugadores[idx] = null;
    }

    const slotEl = document.getElementById(`slot-${idx}-wrap`);
    if (slotEl) {
        slotEl.className = 'p-slot-v7 pointer';
        slotEl.setAttribute('onclick', `window.openPlayerSelector('NEW', 'amistoso', {idx:${idx}})`);
        slotEl.innerHTML = `
            <div class="p-img-box empty" style="border:1px dashed rgba(255,255,255,0.2)">
                <i class="fas fa-plus text-white opacity-50"></i>
            </div>
            <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-3">VACÍO</span>
        `;
    }
};

function focusToday() {
    setTimeout(() => {
        const todayHeader = document.querySelector('.day-header-v5.today');
        if (todayHeader) todayHeader.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 200);
}
