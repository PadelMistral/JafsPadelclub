// eventos.js - Events System V4.0
import { db, observerAuth, subscribeCol } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

initAppUI('events');

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('events-container');
    let currentFilter = 'all';
    let allEvents = [];

    observerAuth((user) => {
        if (user) {
            loadEvents();
            setupFilters();
        }
    });

    async function loadEvents() {
        try {
            // Try to fetch from Firebase
            const snap = await window.getDocsSafe(collection(db, "eventos"));
            allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // If no events found, add sample data
            if (allEvents.length === 0) {
                allEvents = getSampleEvents();
            }
            
            renderEvents(allEvents);
        } catch (e) {
            console.error("Error loading events:", e);
            // Use sample data on error
            allEvents = getSampleEvents();
            renderEvents(allEvents);
        }
    }

    function getSampleEvents() {
        return [
            {
                id: '1',
                title: 'Torneo de Primavera',
                description: 'Gran torneo inaugural con premios para los 3 primeros puestos.',
                type: 'tournament',
                date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                slots: 16,
                filledSlots: 12,
                prize: '500€',
                image: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=400'
            },
            {
                id: '2',
                title: 'Liga Mensual Abril',
                description: 'Enfréntate a los mejores jugadores de la comunidad.',
                type: 'league',
                date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                slots: 24,
                filledSlots: 18,
                prize: 'Trophy + 200FP',
                image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'
            },
            {
                id: '3',
                title: 'Noche de Pádel',
                description: 'Evento especial nocturno con iluminación LED.',
                type: 'special',
                date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                slots: 8,
                filledSlots: 8,
                prize: '100€ + Cena',
                image: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=400'
            }
        ];
    }

    function renderEvents(events) {
        if (!container) return;

        if (events.length === 0) {
            container.innerHTML = `
                <div class="empty-state text-center py-20 opacity-40">
                    <i class="fas fa-ghost text-5xl mb-4"></i>
                    <h3 class="text-xl font-bold">SILENCIO CÓSMICO</h3>
                    <p class="text-sm">No hay eventos programados en este cuadrante.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = events.map((e, idx) => {
            const date = new Date(e.date);
            const isFull = e.filledSlots >= e.slots;
            const typeConfig = { 
                tournament: { label: 'TORNEO', icon: 'fa-trophy', color: 'cyan' },
                league: { label: 'LIGA', icon: 'fa-shield-halved', color: 'purple' },
                special: { label: 'ESPECIAL', icon: 'fa-star', color: 'gold' }
            };
            const cfg = typeConfig[e.type] || { label: 'EVENTO', icon: 'fa-calendar', color: 'blue' };
            
            return `
                <article class="event-card-v7 stagger-item ${e.type}" style="animation-delay: ${idx * 0.1}s">
                    <div class="e-card-media">
                        <img src="${e.image}" alt="${e.title}" class="e-img">
                        <div class="e-type-badge ${cfg.color}"><i class="fas ${cfg.icon}"></i> ${cfg.label}</div>
                    </div>
                    <div class="e-card-body">
                        <div class="e-date-row">
                            <span class="e-time"><i class="far fa-clock"></i> ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}</span>
                            <span class="e-calendar"><i class="far fa-calendar-alt"></i> ${formatDate(date)}</span>
                        </div>
                        <h3 class="e-title">${e.title}</h3>
                        <p class="e-desc">${e.description}</p>
                        <div class="e-stats-row">
                            <div class="e-pill"><b>${e.prize}</b> <label>PREMIO</label></div>
                            <div class="e-pill"><b>${e.filledSlots}/${e.slots}</b> <label>PLAZAS</label></div>
                        </div>
                        <div class="e-footer">
                            ${isFull ? 
                                `<button class="btn-full" disabled>COMPLETO</button>` :
                                `<button class="btn-join" onclick="joinEvent('${e.id}')">INSCRIBIRSE <i class="fas fa-bolt"></i></button>`
                            }
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    function formatDate(date) {
        const now = new Date();
        const diff = date - now;
        const days = Math.floor(diff / (24 * 60 * 60 * 1000));
        
        if (days === 0) return 'Hoy';
        if (days === 1) return 'Mañana';
        if (days < 7) return `En ${days} días`;
        
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    }

    function setupFilters() {
        document.querySelectorAll('.filter-tab').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                applyFilter();
            };
        });
    }

    function applyFilter() {
        let filtered = allEvents;
        if (currentFilter !== 'all') {
            filtered = allEvents.filter(e => e.type === currentFilter);
        }
        renderEvents(filtered);
    }

    window.joinEvent = (eventId) => {
        showToast("Inscripción próximamente disponible", "info");
    };
});






