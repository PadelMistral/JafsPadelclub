/* js/modules/gamification.js - Leveling & Progress System (v2.0) */

/**
 * Calculates XP and Gamification Level based on stats.
 * Formula: Level = Math.sqrt(XP / 100)
 */
export function calculateXpLevel(xp) {
    if (!xp) xp = 0;
    const level = Math.floor(Math.sqrt(xp / 100));
    const nextLevelXp = Math.pow(level + 1, 2) * 100;
    const currentLevelXp = Math.pow(level, 2) * 100;
    const progress = Math.round(((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100);
    
    return {
        level: level || 1,
        xp,
        nextXp: nextLevelXp,
        progress: progress || 0,
        title: getTitle(level)
    };
}

function getTitle(lvl) {
    if (lvl < 5) return "Rookie";
    if (lvl < 10) return "Amateur";
    if (lvl < 20) return "Pro";
    if (lvl < 50) return "Master";
    return "Legend";
}

/**
 * Calculates paddle level progress (1.0 - 7.0)
 */
export function calculatePaddleProgress(nivel) {
    const currentLevel = Math.floor(nivel * 2) / 2; // Round to 0.5
    const nextLevel = currentLevel + 0.5;
    const prevLevel = Math.max(1, currentLevel - 0.5);
    
    // Progress within current level bracket (0-100)
    let progress = ((nivel - currentLevel) / 0.5) * 100;
    progress = Math.max(0, Math.min(100, progress));
    
    // Estimate points needed to reach next level
    // Assuming each 0.1 level is approx 40 Elo points
    const distanceToNext = nextLevel - nivel;
    const pointsNeeded = Math.round(distanceToNext * 400); 
    
    return {
        nivel,
        currentLevel,
        nextLevel,
        prevLevel,
        progress,
        pointsNeeded,
        progressInt: Math.round(progress),
        color: getLevelColor(nivel)
    };
}

function getLevelColor(nivel) {
    if (nivel < 2) return '#60a5fa'; // Blue - Beginner
    if (nivel < 3) return '#34d399'; // Green - Intermediate
    if (nivel < 4) return '#fbbf24'; // Yellow - Advanced
    if (nivel < 5) return '#f97316'; // Orange - Pro
    if (nivel < 6) return '#ef4444'; // Red - Expert
    return '#a855f7'; // Purple - Master
}

/**
 * Renders the XP Bar Widget with Paddle Level Progress
 */
export function renderXpWidget(containerId, userData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const xpStats = calculateXpLevel(userData.xp || 0);
    const levelStats = calculatePaddleProgress(userData.nivel || 2.5);
    
    // Get winrate for performance indicator
    const winrate = userData.partidosJugados > 0 
        ? Math.round((userData.victorias / userData.partidosJugados) * 100) 
        : 0;
    const streak = userData.rachaActual || 0;

    container.innerHTML = `
        <div class="xp-widget">
            <!-- Paddle Level Progress -->
            <div class="level-progress-card">
                <div class="level-header">
                    <div class="level-info">
                        <span class="level-label">Progreso de Nivel</span>
                        <span class="level-value" style="color: ${levelStats.color}">${levelStats.progressInt}%</span>
                    </div>
                    <div class="level-target">
                        <span class="target-label">Faltan ${levelStats.pointsNeeded} pts</span>
                        <span class="target-value">Nivel Actual: ${levelStats.nivel.toFixed(2)}</span>
                    </div>
                </div>
                <div class="level-bar-container">
                    <div class="level-bar" style="width: ${levelStats.progress}%; background: linear-gradient(90deg, ${levelStats.color}, ${levelStats.color}bb)"></div>
                </div>
                <div class="level-markers">
                    <span class="font-bold">${levelStats.currentLevel.toFixed(1)}</span>
                    <span class="text-[8px] opacity-40 uppercase font-black">Escalando al ${levelStats.nextLevel.toFixed(1)}</span>
                    <span class="font-bold">${levelStats.nextLevel.toFixed(1)}</span>
                </div>
            </div>


            <!-- Performance Stats -->
            <div class="performance-row">
                <div class="perf-stat">
                    <i class="fas fa-trophy ${winrate >= 50 ? 'text-sport-green' : 'text-sport-orange'}"></i>
                    <span class="perf-value">${winrate}%</span>
                    <span class="perf-label">Winrate</span>
                </div>
                <div class="perf-stat">
                    <i class="fas fa-fire ${streak > 0 ? 'text-sport-green' : streak < 0 ? 'text-red-400' : 'text-scnd'}"></i>
                    <span class="perf-value ${streak > 0 ? 'text-sport-green' : streak < 0 ? 'text-red-400' : ''}">${streak > 0 ? '+' : ''}${streak}</span>
                    <span class="perf-label">Racha</span>
                </div>
                <div class="perf-stat">
                    <i class="fas fa-star text-yellow-400"></i>
                    <span class="perf-value">${xpStats.level}</span>
                    <span class="perf-label">${xpStats.title}</span>
                </div>
            </div>
        </div>
    `;

    
    // Inject styles if not present
    if (!document.getElementById('xp-widget-styles')) {
        const styles = document.createElement('style');
        styles.id = 'xp-widget-styles';
        styles.textContent = `
            .xp-widget {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .level-progress-card {
                background: var(--glass-bg);
                backdrop-filter: blur(10px);
                border: 1px solid var(--glass-border);
                border-radius: 16px;
                padding: 16px;
            }
            
            .level-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 12px;
            }
            
            .level-info {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            .level-label {
                font-size: 0.65rem;
                font-weight: 600;
                color: var(--text-scnd);
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            .level-value {
                font-family: var(--font-display);
                font-weight: 900;
                font-size: 1.8rem;
                line-height: 1;
            }
            
            .level-target {
                text-align: right;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            .target-label {
                font-size: 0.65rem;
                font-weight: 600;
                color: var(--sport-green);
            }
            
            .target-value {
                font-size: 0.75rem;
                font-weight: 700;
                color: var(--text-scnd);
            }
            
            .level-bar-container {
                height: 8px;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 4px;
                overflow: hidden;
            }
            
            .level-bar {
                height: 100%;
                border-radius: 4px;
                transition: width 0.5s ease;
                box-shadow: 0 0 10px currentColor;
            }
            
            .level-markers {
                display: flex;
                justify-content: space-between;
                margin-top: 8px;
                font-size: 0.6rem;
                color: var(--text-scnd);
            }
            
            .current-marker {
                font-weight: 700;
            }
            
            .performance-row {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 10px;
            }
            
            .perf-stat {
                background: var(--glass-bg);
                border: 1px solid var(--glass-border);
                border-radius: 14px;
                padding: 14px 10px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            
            .perf-stat i {
                font-size: 1rem;
                margin-bottom: 2px;
            }
            
            .perf-value {
                font-family: var(--font-display);
                font-weight: 800;
                font-size: 1.1rem;
                color: white;
            }
            
            .perf-label {
                font-size: 0.55rem;
                font-weight: 600;
                color: var(--text-scnd);
                text-transform: uppercase;
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Achievement Definitions
 */
export const ACHIEVEMENTS = [
    { id: 'first_win', name: 'Primera Sangre', icon: 'fa-trophy', desc: 'Gana tu primer partido' },
    { id: 'early_bird', name: 'Madrugador', icon: 'fa-sun', desc: 'Juega antes de las 9:00 AM' },
    { id: 'unstoppable', name: 'Imparable', icon: 'fa-fire', desc: 'Racha de 3 victorias' },
    { id: 'social_star', name: 'Social Star', icon: 'fa-users', desc: 'Completa 10 partidos' },
    { id: 'tactician', name: 'Táctico', icon: 'fa-book', desc: 'Escribe 5 entradas en tu diario' }
];

export function renderAchievements(containerId, userData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const unlocked = userData.logros || [];
    
    container.innerHTML = ACHIEVEMENTS.map(ach => {
        const isUnlocked = unlocked.includes(ach.id);
        return `
            <div class="ach-card ${isUnlocked ? 'unlocked' : ''}">
                <i class="fas ${ach.icon} ach-icon"></i>
                <span class="ach-name">${ach.name}</span>
            </div>
        `;
    }).join('');
}



