/**
 * AUTOMATION ENGINE (Phase 8 - Final)
 * Pure logic module for determining active interventions based on PlayerState.
 * Does not interact with DB directly. Returns recommendations and modes.
 * 
 * MODE PRIORITY: BURNOUT > CRISIS > FATIGUE > GIANT_KILLER > GROWTH > NEUTRAL
 */

export const AutomationEngine = {
    
    /**
     * Determines the current Active Mode based on player metrics.
     * @param {Object} metrics - Player metrics
     * @returns {Object} Active mode with label, icon, color, risk level, and intervention text
     */
    determineActiveMode: (metrics) => {
        const {
            recentResult = 'win',
            eloTrend = 0,
            fatigueIndex = 0,
            mentalState = 50,
            winStreak = 0,
            lossStreak = 0,
            accuracy = 80
        } = metrics;

        // 1. BURNOUT (Critical — Physical + Mental collapse)
        if (fatigueIndex > 85 && mentalState < 30) {
            return {
                mode: 'BURNOUT_PROTOCOL',
                label: 'PROTOCOLO ANTI-BURNOUT',
                icon: 'fa-battery-empty',
                color: 'text-red-500',
                cssVar: '--danger',
                riskLevel: 'CRÍTICO',
                intervention: 'Descanso OBLIGATORIO. Tu cuerpo necesita recuperarse.'
            };
        }

        // 2. CRISIS (Negative spiral)
        if (lossStreak >= 3 && eloTrend < -30) {
             return {
                mode: 'CRISIS_MODE',
                label: 'MODO ESTABILIZACIÓN',
                icon: 'fa-shield-virus',
                color: 'text-orange-500',
                cssVar: '--sport-orange',
                riskLevel: 'ALTO',
                intervention: 'Busca partidos de bajo riesgo. Prioriza confianza sobre puntos.'
            };
        }

        // 3. FATIGUE (Warning — Physical strain)
        if (fatigueIndex > 70) {
            return {
                mode: 'FATIGUE_MANAGEMENT',
                label: 'GESTIÓN DE FATIGA',
                icon: 'fa-bed-pulse',
                color: 'text-blue-400',
                cssVar: '--info',
                riskLevel: 'MEDIO',
                intervention: 'Reduce intensidad. Juega lado conservador y usa el globo.'
            };
        }

        // 4. GIANT KILLER (Peak — Streak + Trend + Mental)
        if (winStreak >= 3 && eloTrend > 40 && mentalState > 70) {
             return {
                mode: 'GIANT_KILLER',
                label: 'MODO CAZAGIGANTES',
                icon: 'fa-dragon',
                color: 'text-purple-400',
                cssVar: '--accent-purple',
                riskLevel: 'OPORTUNIDAD',
                intervention: 'Estás en llamas. Desafía rangos superiores y sube la apuesta.'
            };
        }

        // 5. GROWTH (Positive trend)
        if (eloTrend > 0) {
             return {
                mode: 'GROWTH_FLOW',
                label: 'FLUJO DE CRECIMIENTO',
                icon: 'fa-seedling',
                color: 'text-sport-green',
                cssVar: '--sport-green',
                riskLevel: 'BAJO',
                intervention: 'Mantén tu rutina. Consolida tu nivel actual.'
            };
        }

        // 6. NEUTRAL (Baseline)
        return {
            mode: 'NEUTRAL_OBSERVER',
            label: 'OBSERVADOR ACTIVO',
            icon: 'fa-eye',
            color: 'text-gray-400',
            cssVar: '--text-muted',
            riskLevel: 'NEUTRAL',
            intervention: 'Recopilando datos para optimización personalizada.'
        };
    },

    /**
     * Generates specific tactical/emotional/gear advice based on Mode & Player Profile.
     * @param {string} mode - Active mode key
     * @param {Object} playerProfile - Player profile context (style, etc.)
     * @returns {Array} List of intervention objects {type, text, icon}
     */
    generateInterventionPlan: (mode, playerProfile = {}) => {
        const interventions = [];
        const style = playerProfile.style || 'Equilibrado';

        switch(mode) {
            case 'BURNOUT_PROTOCOL':
                interventions.push({ type: 'calendar', text: "Bloquea tu agenda 48h. Sin partidos.", icon: 'fa-calendar-xmark' });
                interventions.push({ type: 'mental', text: "Desconecta del ranking. Enfócate en disfrutar.", icon: 'fa-brain' });
                interventions.push({ type: 'physical', text: "Estiramientos suaves y hidratación.", icon: 'fa-heart-pulse' });
                break;

            case 'CRISIS_MODE':
                interventions.push({ type: 'tactics', text: "Juega 'La Caja' — Centro-Fondo-Globo.", icon: 'fa-chess' });
                interventions.push({ type: 'matchmaking', text: "Evita rivales 'Kryptonita' por ahora.", icon: 'fa-user-shield' });
                interventions.push({ type: 'gear', text: "Usa pala de Control (Balance bajo).", icon: 'fa-table-tennis-paddle-ball' });
                interventions.push({ type: 'mental', text: "Mentalización pre-partido: 5 min de respiración.", icon: 'fa-wind' });
                break;

            case 'GIANT_KILLER':
                interventions.push({ type: 'tactics', text: "Presiona la red agresivamente.", icon: 'fa-bolt' });
                interventions.push({ type: 'mental', text: "Visualiza el 2-0. Máxima determinación.", icon: 'fa-eye' });
                interventions.push({ type: 'gear', text: "Máxima potencia. Pala ofensiva.", icon: 'fa-fire' });
                interventions.push({ type: 'matchmaking', text: "Reta a jugadores de nivel superior.", icon: 'fa-trophy' });
                break;

            case 'FATIGUE_MANAGEMENT':
                interventions.push({ type: 'position', text: "Considera jugar Drive (Menos km recorridos).", icon: 'fa-person-walking' });
                interventions.push({ type: 'tactics', text: "Usa el globo defensivo para recuperar posición.", icon: 'fa-parachute-box' });
                interventions.push({ type: 'recovery', text: "Post-partido: 10 min de estiramientos.", icon: 'fa-spa' });
                break;

            case 'GROWTH_FLOW':
                if (style === 'Agresivo') {
                    interventions.push({ type: 'balance', text: "Recuerda: el globo también es un arma.", icon: 'fa-yin-yang' });
                } else if (style === 'Defensivo') {
                    interventions.push({ type: 'balance', text: "Busca definir más puntos en la red.", icon: 'fa-bullseye' });
                } else {
                    interventions.push({ type: 'balance', text: "Consolida tu juego actual. Prueba variantes.", icon: 'fa-seedling' });
                }
                interventions.push({ type: 'consistency', text: "Mantén la rutina que te funciona.", icon: 'fa-repeat' });
                break;

            default: // NEUTRAL_OBSERVER
                interventions.push({ type: 'data', text: "Juega más partidos para desbloquear análisis profundo.", icon: 'fa-chart-line' });
                if (style === 'Agresivo') 
                    interventions.push({ type: 'balance', text: "El globo también ataca.", icon: 'fa-yin-yang' });
                else 
                    interventions.push({ type: 'balance', text: "Busca definir en la red.", icon: 'fa-bullseye' });
        }
        
        return interventions;
    },

    /**
     * Returns a CSS class for the active mode (for UI theming).
     */
    getModeTheme: (mode) => {
        const themes = {
            'BURNOUT_PROTOCOL': { bg: 'bg-red-500/10', border: 'border-red-500/30', glow: 'shadow-red-500/20' },
            'CRISIS_MODE': { bg: 'bg-orange-500/10', border: 'border-orange-500/30', glow: 'shadow-orange-500/20' },
            'FATIGUE_MANAGEMENT': { bg: 'bg-blue-400/10', border: 'border-blue-400/30', glow: 'shadow-blue-400/20' },
            'GIANT_KILLER': { bg: 'bg-purple-400/10', border: 'border-purple-400/30', glow: 'shadow-purple-400/20' },
            'GROWTH_FLOW': { bg: 'bg-green-400/10', border: 'border-green-400/30', glow: 'shadow-green-400/20' },
            'NEUTRAL_OBSERVER': { bg: 'bg-white/5', border: 'border-white/10', glow: 'shadow-white/5' }
        };
        return themes[mode] || themes['NEUTRAL_OBSERVER'];
    }
};
