/* =====================================================
   PADELUMINATIS CALENDAR ENGINE V5.0
   Mistral-Inspired Modern Matrix Logic.
   ===================================================== */

import { db, auth, observerAuth, subscribeDoc, getDocument, subscribeCol } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where, addDoc, doc, getDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast, countUp } from './ui-core.js';

let currentUser = null;
let userData = null;
let currentWeekOffset = 0;
let allMatches = [];
let allUsersMap = {};
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
    { start: "12:30", end: "14:00" }, // Break after this
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
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        currentUser = user;
        
        // Initial data load
        const [uData, usersSnap] = await Promise.all([
            getDocument('usuarios', user.uid),
            getDocs(collection(db, 'usuarios'))
        ]);
        
        userData = uData;
        usersSnap.forEach(d => allUsersMap[d.id] = d.data());
        
        // Sync matches from both collections
        subscribeCol("partidosAmistosos", (list) => {
            syncMatches();
        });
        subscribeCol("partidosReto", (list) => {
            syncMatches();
        });
        
        syncMatches(); // Initial trigger
    });

    // Navigation setup
    document.getElementById('btn-prev').onclick = () => { currentWeekOffset--; renderGrid(); };
    document.getElementById('btn-next').onclick = () => { currentWeekOffset++; renderGrid(); };
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
    const [snapA, snapR] = await Promise.all([
        getDocs(collection(db, "partidosAmistosos")),
        getDocs(collection(db, "partidosReto"))
    ]);
    
    allMatches = [];
    snapA.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
    snapR.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', isComp: true, ...d.data() }));
    
    await fetchWeeklyWeather();
    renderGrid();
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
    document.getElementById('week-range-text').textContent = `${startOfWeek.getDate()} - ${endOfWeek.getDate()}`;
    document.getElementById('month-year-text').textContent = `${startOfWeek.toLocaleDateString('es-ES', {month: 'long', year: 'numeric'})}`.toUpperCase();

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
}

function renderSlot(date, hour) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const dStr = `${year}-${month}-${day}`;

    const match = allMatches.find(m => {
        const mDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const mYear = mDate.getFullYear();
        const mMonth = (mDate.getMonth() + 1).toString().padStart(2, '0');
        const mDay = mDate.getDate().toString().padStart(2, '0');
        const mDStr = `${mYear}-${mMonth}-${mDay}`;
        const mHStr = `${mDate.getHours().toString().padStart(2, '0')}:${mDate.getMinutes().toString().padStart(2, '0')}`;
        return mDStr === dStr && mHStr === hour;
    });

    const [h, min] = hour.split(':').map(Number);
    const slotTime = new Date(date);
    slotTime.setHours(h, min, 0, 0);
    const isPast = slotTime < new Date();
    let state = 'free';
    let label = 'Libre';
    let sub = '';

    if (match) {
        const isMine = match.jugadores?.includes(currentUser.uid);
        const count = match.jugadores?.length || 0;
        const isFull = count >= 4;
        
        if (isMine) state = 'propia';
        else if (isFull) state = 'cerrada';
        else state = 'abierta';

        label = isMine ? 'MÍA' : (isFull ? 'LLENO' : 'UNIRSE');
        sub = isFull ? 'PARTIDA CERRADA' : `${4 - count} HUECOS`;
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
            weatherHtml = `<div class="slot-weather"><i class="fas ${icon}"></i> <span>${temp}°</span></div>`;
        }
    }

    return `
        <div class="slot-v5 ${state} ${isPast ? 'past' : ''}" onclick="handleSlot('${dStr}', '${hour}', '${match?.id || ''}', '${match?.col || ''}')">
            ${weatherHtml}
            <span class="slot-chip-v5">${label}</span>
            <span class="slot-info-v5">${sub}</span>
        </div>
    `;
}

function getIconFromCode(code) {
    if (code === 0) return 'fa-sun text-yellow-400';
    if (code <= 3) return 'fa-cloud-sun text-orange-300';
    if (code <= 48) return 'fa-smog text-gray-400';
    if (code <= 67) return 'fa-cloud-rain text-blue-400';
    if (code <= 77) return 'fa-snowflake text-white';
    if (code <= 82) return 'fa-cloud-showers-heavy text-blue-500';
    if (code <= 99) return 'fa-bolt text-yellow-500';
    return 'fa-cloud text-gray-400';
}

window.handleSlot = async (date, hour, id, col) => {
    const modal = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    const title = document.getElementById('modal-titulo');
    
    modal.classList.add('active');
    area.innerHTML = '<div class="p-10 text-center"><div class="spinner-neon mx-auto"></div></div>';
    title.textContent = id ? 'DETALLES PARTIDA' : 'NUEVA RESERVA';

    const { renderMatchDetail, renderCreationForm } = await import('./match-service.js');
    if (id) {
        await renderMatchDetail(area, id, col, currentUser, userData);
    } else {
        await renderCreationForm(area, date, hour, currentUser, userData);
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

window.openUserPicker = async (slotIndex) => {
    const picker = document.getElementById('modal-user-picker');
    const list = document.getElementById('user-picker-list');
    picker.classList.add('active');
    picker.dataset.slotIndex = slotIndex;
    
    // Load users if empty
    if (!list.innerHTML.trim()) {
        list.innerHTML = '<div class="spinner-neon mx-auto mt-10"></div>';
        const { getDocs, collection } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        const snap = await getDocs(collection(db, "usuarios"));
        
        list.innerHTML = snap.docs.map(d => {
            const u = d.data();
            const photo = u.fotoPerfil || u.fotoURL || './imagenes/default-avatar.png';
            return `
                <div class="u-item-list-v5" onclick="selectUserForSlot('${d.id}', '${u.nombreUsuario || 'Jugador'}', '${photo}')">
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
    }
};

window.selectUserForSlot = (uid, name, photo) => {
    const picker = document.getElementById('modal-user-picker');
    const idx = picker.dataset.slotIndex;
    
    // Dispatch custom event or callback to match-service logic
    // But since match-service handles the render, we need a bridge.
    // For now we update the DOM directly if it exists in the open form
    const slotEl = document.querySelector(`.player-slot-court[data-index="${idx}"]`);
    if (slotEl) {
        slotEl.classList.add('filled');
        slotEl.dataset.uid = uid;
        slotEl.innerHTML = `
            <div class="p-avatar"><img src="${photo}" style="width:100%;height:100%;object-fit:cover;"></div>
            <span class="p-name">${name}</span>
            <div class="remove-slot-btn" onclick="event.stopPropagation(); clearSlot('${idx}')">×</div>
        `;
    }
    picker.classList.remove('active');
};

window.clearSlot = (idx) => {
    const slotEl = document.querySelector(`.player-slot-court[data-index="${idx}"]`);
    if (slotEl) {
        slotEl.classList.remove('filled');
        slotEl.dataset.uid = "";
        slotEl.innerHTML = `<i class="fas fa-plus opacity-30 text-2xl"></i>`;
    }
};
