/* js/ranking-v3.js — Enhanced Premium Ranking V3 */
import { db, getDocsSafe, getDocument, auth } from "./firebase-service.js";
import { collection, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { levelFromRating } from "./config/elo-system.js";
import { renderMatchDetail } from "./match-service.js";

let users = [];
let currentUser = null;
let currentSearch = "";

document.addEventListener("DOMContentLoaded", async () => {
    initAppUI("ranking-v3");
    currentUser = auth.currentUser;
    await injectHeader();
    injectNavbar("ranking");
    loadRanking();
    
    document.getElementById("rank-search")?.addEventListener("input", (e) => {
        currentSearch = e.target.value.toLowerCase();
        renderTable();
    });
});

async function loadRanking() {
    const q = query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(200));
    const snap = await getDocsSafe(q);
    
    users = (snap?.docs || []).map(d => ({ id: d.id, ...d.data() }));
    
    renderPodium();
    renderTable();
    
    const info = document.getElementById("lb-total-info");
    if (info) info.textContent = `${users.length} jugadores en el top`;
}

function renderPodium() {
    for (let i = 0; i < 3; i++) {
        const u = users[i];
        const nameEl = document.getElementById(`p-name-${i+1}`);
        const ptsEl = document.getElementById(`p-pts-${i+1}`);
        const avEl = document.getElementById(`p-av-${i+1}`);
        const pod = document.getElementById(`pod-${i+1}`);

        if (u) {
            if (nameEl) nameEl.textContent = (u.nombreUsuario || u.nombre || "Jugador").toUpperCase();
            if (ptsEl) ptsEl.textContent = Math.round(u.puntosRanking || 1000);
            if (avEl) {
                avEl.innerHTML = `<img src="${u.fotoURL || u.photoURL || './imagenes/Logojafs.png'}" alt="Avatar" style="width:100%; height:100%; border-radius:50%; object-fit:cover; border: 2px solid rgba(255,255,255,0.1);">`;
            }
            if (pod) pod.onclick = () => window.location.href = `perfil.html?uid=${u.id}`;
        }
    }
}

function renderTable() {
    const list = document.getElementById("lb-list");
    if (!list) return;

    const filtered = users.filter(u => 
        (u.nombreUsuario || u.nombre || "").toLowerCase().includes(currentSearch)
    );

    if (!filtered.length) {
        list.innerHTML = `<div class="p-10 text-center opacity-40 uppercase text-[10px] font-black">No se encontraron jugadores</div>`;
        return;
    }

    list.innerHTML = filtered.map((u, i) => {
        const isMe = u.id === currentUser?.uid;
        const rank = users.indexOf(u) + 1;
        const pts = Math.round(u.puntosRanking || 1000);
        const lvl = Number(u.nivel || levelFromRating(u.puntosRanking)).toFixed(2);
        
        let rankClass = "";
        if (rank === 1) rankClass = "rank-gold";
        else if (rank === 2) rankClass = "rank-silver";
        else if (rank === 3) rankClass = "rank-bronze";
        else if (pts > 1800) rankClass = "rank-elite";

        return `
            <div class="lb-row-container" id="row-cont-${u.id}">
                <div class="ranking-card ${rankClass} ${isMe ? 'me' : ''} animate-up" 
                     style="animation-delay: ${i * 20}ms" 
                     onclick="window.toggleRankingBreakdown('${u.id}', this)">
                    <span class="rank-number-v7 ${rank <= 3 ? 'glow' : ''}">${rank}</span>
                    <img src="${u.fotoURL || u.photoURL || './imagenes/Logojafs.png'}" class="lb-avatar" />
                    <div class="lb-info">
                        <span class="lb-name">${u.nombreUsuario || u.nombre || 'Jugador'} ${isMe ? '<i class="fas fa-user-circle text-[8px] text-primary ml-1"></i>' : ''}</span>
                        <span class="lb-level">Nivel ${lvl}</span>
                    </div>
                    <div class="flex-col items-end">
                        <span class="lb-pts">${pts}</span>
                        <span class="text-[8px] font-bold opacity-40 uppercase tracking-widest">ELO PTS</span>
                    </div>
                </div>
                <div id="breakdown-${u.id}" class="lb-breakdown-panel hidden">
                    <div class="lb-breakdown-content">
                        <div class="loading-mini p-4 text-center opacity-30"><i class="fas fa-spinner fa-spin"></i></div>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

window.toggleRankingBreakdown = async (uid, row) => {
    const panel = document.getElementById(`breakdown-${uid}`);
    if (!panel) return;
    
    const isHidden = panel.classList.contains('hidden');
    
    if (isHidden) {
        // Close others for focus
        // document.querySelectorAll('.lb-breakdown-panel').forEach(p => p.classList.add('hidden'));
        panel.classList.remove('hidden');
        panel.classList.add('animate-up');
        
        const content = panel.querySelector('.lb-breakdown-content');
        if (content.dataset.loaded === "1") return;
        
        try {
            const logsSnap = await getDocsSafe(
                query(collection(db, "rankingLogs"), 
                where("uid", "==", uid), 
                orderBy("timestamp", "desc"), 
                limit(5))
            );
            
            const logs = logsSnap?.docs?.map(d => d.data()) || [];
            
            if (!logs.length) {
                content.innerHTML = `
                    <div class="p-4 flex-col center gap-2">
                        <span class="text-[9px] font-black opacity-30 uppercase tracking-widest">Sin actividad reciente</span>
                        <button class="text-[8px] font-bold text-primary underline" onclick="window.location.href='perfil.html?uid=${uid}'">VER PERFIL</button>
                    </div>`;
                return;
            }
            
            content.innerHTML = `
                <div class="p-3 border-t border-white/5 mt-1">
                    <div class="flex-row between items-center mb-2 px-1">
                        <span class="text-[8px] font-black opacity-40 uppercase tracking-widest">Últimos partidos</span>
                        <i class="fas fa-history text-[8px] opacity-20"></i>
                    </div>
                    <div class="flex-col gap-1">
                        ${logs.map(log => {
                            const diff = Number(log.diff || 0);
                            const isPos = diff >= 0;
                            const date = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleDateString('es-ES', {day:'2-digit', month:'short'}) : '--';
                            const sets = log.details?.sets || 'Played';
                            const mId = log.matchId || "";
                            const col = log.matchCol || "partidosAmistosos";
                            
                            return `
                                <div class="flex-row between items-center p-2 bg-white/5 rounded-lg border border-white/5 active:scale-95 transition-transform" 
                                     onclick="window.openRankMatch('${mId}', '${col}')">
                                    <div class="flex-row items-center gap-3">
                                        <div class="w-1.5 h-1.5 rounded-full ${isPos ? 'bg-sport-green shadow-[0_0_5px_#22c55e]' : 'bg-sport-red shadow-[0_0_5px_#ef4444]'}"></div>
                                        <div class="flex-col">
                                            <span class="text-[9px] font-black text-white/90 uppercase">${sets}</span>
                                            <span class="text-[8px] font-bold opacity-30 uppercase">${date}</span>
                                        </div>
                                    </div>
                                    <span class="text-[10px] font-black ${isPos ? 'text-sport-green' : 'text-sport-red'}">${isPos ? '+' : ''}${diff.toFixed(1)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="mt-3 text-center">
                        <button class="text-[8px] font-black text-primary uppercase tracking-[2px] opacity-70 hover:opacity-100" 
                                onclick="window.location.href='perfil.html?uid=${uid}'">VER PERFIL COMPLETO <i class="fas fa-chevron-right ml-1"></i></button>
                    </div>
                </div>
            `;
            content.dataset.loaded = "1";
        } catch (e) {
            console.error("Rank log error:", e);
            content.innerHTML = `<div class="p-4 text-center text-sport-red text-[9px] font-black uppercase">Fallo en la conexión galáctica</div>`;
        }
    } else {
        panel.classList.add('hidden');
    }
};

window.openRankMatch = async (id, col) => {
    if (!id) return;
    const modal = document.getElementById("modal-match");
    const area = document.getElementById("match-detail-area");
    if (!modal || !area) return;
    
    modal.classList.add("active");
    area.innerHTML = '<div class="center py-20"><i class="fas fa-spinner fa-spin opacity-20"></i></div>';
    
    const userDoc = currentUser ? await getDocument("usuarios", currentUser.uid) : {};
    await renderMatchDetail(area, id, col, currentUser, userDoc);
};
