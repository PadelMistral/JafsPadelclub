// calendario.js - Premium Grid Engine (v18.0)
import { db, auth, observerAuth, subscribeCol, addDocument } from './firebase-service.js';
import { collection, query, where, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';
import { initGalaxyBackground } from './modules/galaxy-bg.js';

let currentUser = null;
let userData = null;
let currentWeekOffset = 0;
let allMatches = [];

const HOURS = ["08:00", "09:30", "11:00", "12:30", "14:30", "16:00", "17:30", "19:00", "20:30"];


document.addEventListener('DOMContentLoaded', () => {
    initAppUI('calendar');
    initGalaxyBackground();
    startClock();
    
    observerAuth(async (user) => {
        if (user) {
            currentUser = user;
            const userSnap = await getDoc(doc(db, "usuarios", user.uid));
            userData = userSnap.data();
            
            loadMatches();
        }
    });

    document.getElementById('btn-prev').onclick = () => { currentWeekOffset--; renderGrid(); };
    document.getElementById('btn-next').onclick = () => { currentWeekOffset++; renderGrid(); };
});

function startClock() {
    const el = document.getElementById('current-clock');
    setInterval(() => {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
}

async function loadMatches() {
    const am = await getDocs(collection(db, "partidosAmistosos"));
    const re = await getDocs(collection(db, "partidosReto"));
    
    allMatches = [];
    am.forEach(d => allMatches.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
    re.forEach(d => allMatches.push({ id: d.id, col: 'partidosReto', isComp: true, ...d.data() }));
    
    renderGrid();
}

function renderGrid() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1 + (currentWeekOffset * 7));
    startOfWeek.setHours(0,0,0,0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    // Update Label
    const monthName = startOfWeek.toLocaleDateString('es-ES', { month: 'long' });
    document.getElementById('week-label').textContent = `SEMANA ${startOfWeek.getDate()} - ${endOfWeek.getDate()}`;
    document.getElementById('month-label').textContent = monthName.toUpperCase();

    let html = `
        <div class="calendar-grid-header">
            <div class="corner-header"><i class="fas fa-calendar-alt opacity-40"></i></div>
            ${Array.from({length: 7}).map((_, i) => {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                const isToday = d.toDateString() === new Date().toDateString();
                return `
                    <div class="header-day ${isToday ? 'today' : ''}">
                        <span class="day-name">${d.toLocaleDateString('es-ES', { weekday: 'short' }).substring(0,3)}</span>
                        <span class="day-date">${d.getDate()}</span>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="grid-body">
            ${HOURS.map(hour => {
                const [h, m] = hour.split(':');
                const endH = parseInt(h) + (m === '30' ? 2 : 1);
                const endM = m === '30' ? '00' : '30';
                
                return `
                    <div class="time-row">
                        <div class="time-col">
                            <span class="time-start">${hour}</span>
                            <span class="time-end">${endH}:${endM}</span>
                        </div>
                        ${Array.from({length: 7}).map((_, i) => {
                            const d = new Date(startOfWeek);
                            d.setDate(startOfWeek.getDate() + i);
                            return renderSlot(d, hour);
                        }).join('')}
                    </div>
                `;
            }).join('')}
        </div>
    `;

    grid.innerHTML = html;
}


function renderSlot(date, hour) {
    const dateStr = date.toISOString().split('T')[0];
    const match = allMatches.find(m => {
        const mDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const mDateStr = mDate.toISOString().split('T')[0];
        const mHourStr = `${mDate.getHours().toString().padStart(2,'0')}:${mDate.getMinutes().toString().padStart(2,'0')}`;
        return mDateStr === dateStr && mHourStr === hour;
    });

    const isPast = new Date(`${dateStr}T${hour}`) < new Date();
    let slotClass = "free";
    let label = "Libre";
    let sub = "";

    if (match) {
        const isMine = match.jugadores?.includes(currentUser?.uid);
        const count = match.jugadores?.length || 0;
        const isFull = count >= 4;
        
        if (isMine) {
            slotClass = "propia";
            label = "MÍO";
            sub = isFull ? "COMPLETO" : `${4 - count} HUECOS`;
        } else if (isFull) {
            slotClass = "cerrada";
            label = "CERRADO";
            sub = "COMPLETO";
        } else {
            slotClass = "abierta";
            label = "UNIRSE";
            sub = `${4-count} LIBRES`;
        }
    }

    return `
        <div class="slot-cell ${isPast ? 'past-visible' : ''} ${match ? 'has-match' : ''}" 
             onclick="handleSlotClick('${dateStr}', '${hour}', '${match?.id || ''}', '${match?.col || ''}')">
            <div class="slot-chip ${slotClass}">${label}</div>
            <div class="text-[7px] font-black opacity-60 mt-0.5 uppercase">${sub}</div>
            ${match ? `<div class="match-type-indicator ${match.isComp ? 'comp' : 'friend'}"></div>` : ''}
        </div>
    `;
}


window.handleSlotClick = async (dateStr, hour, matchId, col) => {
    if (matchId) {
        const overlay = document.getElementById('modal-match');
        const area = document.getElementById('match-detail-area');
        overlay.classList.add('active');
        area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
        
        const { renderMatchDetail } = await import('./match-service.js');
        renderMatchDetail(area, matchId, col, currentUser, userData);
    } else {
        // Create match flow
        const overlay = document.getElementById('modal-match');
        const area = document.getElementById('match-detail-area');
        overlay.classList.add('active');
        
        const { renderCreationForm } = await import('./match-service.js');
        renderCreationForm(area, dateStr, hour, currentUser, userData);
    }
};
