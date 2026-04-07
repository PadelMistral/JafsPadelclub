import { db } from './firebase-service.js';
import { doc, getDoc, updateDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast } from './ui-core.js';

/**
 * PADELUMINATIS ACHIEVEMENT SYSTEM V1
 */

export const BADGES = {
    PIONERO: { id: 'PIONERO', name: 'Misión Inicial', icon: 'fa-rocket', desc: 'Completaste tu primer partido en el club.', color: '#c6ff00' },
    GANADOR: { id: 'GANADOR', name: 'Vencedor', icon: 'fa-trophy', desc: 'Conseguiste 5 victorias acumuladas.', color: '#00d4ff' },
    ELITE: { id: 'ELITE', name: 'Élite Mistral', icon: 'fa-crown', desc: 'Llegaste a 10 victorias. Eres un referente.', color: '#fbbf24' },
    MVP_FIRST: { id: 'MVP_FIRST', name: 'MVP de Honor', icon: 'fa-star', desc: 'Elegido como el jugador más valioso por primera vez.', color: '#f472b6' },
    RACHA_3: { id: 'RACHA_3', name: 'En Racha', icon: 'fa-fire', desc: '3 victorias consecutivas. ¡Nadie te para!', color: '#f97316' },
    VETERANO: { id: 'VETERANO', name: 'Veterano', icon: 'fa-shield-halved', desc: 'Jugaste 10 partidos en total.', color: '#94a3b8' },
    NOCTURNO: { id: 'NOCTURNO', name: 'Cazador Nocturno', icon: 'fa-moon', desc: 'Jugaste un partido después de las 21:00.', color: '#a855f7' }
};

export async function checkAchievements(uid, stats, matchData = null) {
    if (!uid) return [];
    
    try {
        const userRef = doc(db, 'usuarios', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return [];
        
        const userData = userSnap.data();
        const currentBadges = userData.insignias || [];
        const unlockedNow = [];

        // 1. PIONERO
        if (stats.partidosJugados >= 1 && !currentBadges.includes('PIONERO')) {
            unlockedNow.push('PIONERO');
        }

        // 2. GANADOR
        if (stats.victorias >= 5 && !currentBadges.includes('GANADOR')) {
            unlockedNow.push('GANADOR');
        }

        // 3. ELITE
        if (stats.victorias >= 10 && !currentBadges.includes('ELITE')) {
            unlockedNow.push('ELITE');
        }

        // 4. VETERANO
        if (stats.partidosJugados >= 10 && !currentBadges.includes('VETERANO')) {
            unlockedNow.push('VETERANO');
        }

        // 5. RACHA_3
        if (stats.rachaActual >= 3 && !currentBadges.includes('RACHA_3')) {
            unlockedNow.push('RACHA_3');
        }

        // 6. MVP_FIRST
        if (matchData?.mvpId === uid && !currentBadges.includes('MVP_FIRST')) {
            unlockedNow.push('MVP_FIRST');
        }

        // 7. NOCTURNO
        if (matchData?.fecha) {
            const date = matchData.fecha.toDate ? matchData.fecha.toDate() : new Date(matchData.fecha);
            if (date.getHours() >= 21 && !currentBadges.includes('NOCTURNO')) {
                unlockedNow.push('NOCTURNO');
            }
        }

        if (unlockedNow.length > 0) {
            await updateDoc(userRef, {
                insignias: arrayUnion(...unlockedNow)
            });
            
            unlockedNow.forEach(id => {
                const badge = BADGES[id];
                showAchievementUnlocked(badge);
            });
        }

        return unlockedNow;
    } catch (e) {
        console.error('Error checking achievements:', e);
        return [];
    }
}

function showAchievementUnlocked(badge) {
    // Toast notification
    showToast('¡NUEVA INSIGNIA!', badge.name, 'success');
    
    // Check if modal container exists, if not create one temporary or use a common one
    // For now, let's use a specialized toast or simple overlay if we want to "wow" them.
    console.log(`[ACHIEVEMENT UNLOCKED] ${badge.name}: ${badge.desc}`);
}

export function renderBadgeList(ownedIds = []) {
    return Object.values(BADGES).map(b => {
        const isOwned = ownedIds.includes(b.id);
        return `
            <div class="badge-item-v9 ${isOwned ? 'unlocked' : 'locked'}">
                <div class="badge-icon-box" style="background: ${isOwned ? b.color + '22' : 'rgba(255,255,255,0.05)'}; color: ${isOwned ? b.color : 'rgba(255,255,255,0.1)'}">
                    <i class="fas ${b.icon}"></i>
                </div>
                <div class="badge-info">
                    <span class="badge-name">${b.name}</span>
                    <p class="badge-desc">${b.desc}</p>
                </div>
                ${isOwned ? `<div class="badge-check"><i class="fas fa-check-circle"></i></div>` : ''}
            </div>
        `;
    }).join('');
}
