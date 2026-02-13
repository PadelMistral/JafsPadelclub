import { db, auth, getDocument, updateDocument } from './firebase-service.js';
import { collection, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { PredictiveEngine } from './predictive-engine.js';
import { RivalIntelligence } from './rival-intelligence.js'; 
import { AI } from './ai-engine.js';
import { AutomationEngine } from './automation-engine.js';
import { calculateCourtCondition } from './utils/weather-utils.js';
// We will use the new notification service which we will create shortly
import { createNotification } from './services/notification-service.js'; 

const ADJECTIVES = ['Titán', 'Gladiador', 'Mago', 'Estratega', 'Muro', 'Francotirador', 'Bestia', 'Samurái'];
const WEAK_PHRASES = [
    "Hoy te han movido más que a un flan.",
    "¿Las piernas eran de plomo?",
    "Esa bandeja se fue a Cuenca...",
    "Más globos que en una fiesta de cumpleaños, pero cortos.",
    "La red hoy era tu enemiga mortal."
];
const STRONG_PHRASES = [
    "Hoy la sacaste por 3 hasta sin querer.",
    "Esa volea tenía veneno puro.",
    "Infranqueable. Parecías un muro de hormigón.",
    "Tu víbora mordía hoy.",
    "Has dominado el tiempo y el espacio en la pista."
];

function determineArchetype(current, goodChips, smashCount, techLvl) {
    if (smashCount > 5) return 'Agresivo';
    if (techLvl > 8) return 'Maestro Técnico';
    if (goodChips.includes('Defensa')) return 'Defensivo';
    if (goodChips.includes('Vibora') || goodChips.includes('Bandeja')) return 'Técnico';
    return current || 'Equilibrado';
}

export const AIOrchestrator = {
    
    /**
     * Listener: Main Entry Point.
     * Called on Login and major events.
     */
    init: async (userUid) => {
        console.log("🧠 AI BRAIN: Orchestrator awakening for", userUid);
        const state = await AIOrchestrator.recalculatePlayerState(userUid);
        return state;
    },

    /**
     * Dispatch Event — allows any module to notify the Brain.
     * All events are handled gracefully with error isolation.
     */
    dispatch: async (eventType, payload) => {
        const user = auth.currentUser;
        if (!user && !payload?.uid) return;
        const targetUid = payload?.uid || user?.uid;
        if (!targetUid) return;

        console.log(`🧠 AI BRAIN: Event [${eventType}]`, payload?.matchId || '');

        try {
            switch (eventType) {

                // ─── POST-MATCH: Full recalculation ───
                case 'MATCH_FINISHED':
                    await AIOrchestrator.recalculatePlayerState(targetUid);
                    break;

                // ─── PRE-MATCH: 4/4 players joined ───
                case 'MATCH_READY':
                    await AIOrchestrator.recalculatePlayerState(targetUid);
                    break;

                // ─── PLAYER LEFT FULL MATCH ───
                case 'MATCH_UNREADY':
                    // Light refresh — no heavy metrics, just clear "pre-match" focus
                    await AIOrchestrator.recalculatePlayerState(targetUid);
                    break;

                // ─── MATCH CREATED ───
                case 'MATCH_CREATED':
                    // No-op for now — could log creation activity in future
                    break;

                // ─── DIARY: Subjective biometrics & Learning Analysis ───
                case 'DIARY_SAVED':
                    if (payload?.diaryEntry) {
                        try {
                            const entry = payload.diaryEntry;
                            const bio = entry.biometria || {};
                            
                            // 1. Update Biometrics
                            const newFatigue = Math.max(0, 100 - (bio.fisico || 50));
                            const newPressure = Math.max(0, 100 - (bio.mental || 50));

                            // 2. Advanced Learning Analysis (Merged from ai-learning.js)
                            const uDoc = await getDocument('usuarios', targetUid);
                            
                            const badChips = [];
                            const goodChips = [];
                            if (entry.tacticalBalance) {
                                Object.entries(entry.tacticalBalance).forEach(([k, v]) => {
                                    if (v === 'good') goodChips.push(k);
                                    else if (v === 'bad') badChips.push(k);
                                });
                            }
                            
                            const stats = entry.stats || {};
                            const val = entry.valoracion || {};
                            const learning = (entry.aprendizaje || "").toLowerCase();
                            
                            let insight = "Analizando tu desempeño... ";
                            let funPhrase = "¡Dale caña, padelero!";

                            // Logic: Sentiment & Keyword extraction
                            if (learning.includes("paralelo") || learning.includes("remate") || (stats.x3 || 0) + (stats.x4 || 0) > 3) {
                                insight = "Has identificado patrones ofensivos clave. Tu agresividad está dando frutos.";
                                funPhrase = STRONG_PHRASES[Math.floor(Math.random() * STRONG_PHRASES.length)];
                            } else if (learning.includes("cristal") || learning.includes("defensa") || goodChips.includes('Defensa')) {
                                insight = "Tu comprensión de los ángulos del cristal está mejorando significativamente.";
                                funPhrase = "Te estás volviendo infranqueable. ¡Padeluminatis necesita más muros como tú!";
                            } else if (badChips.length > 2 || val.tecnica < 4) {
                                insight = "Detectadas áreas de colapso técnico. Sugiero sesión de entrenamiento enfocada.";
                                funPhrase = WEAK_PHRASES[Math.floor(Math.random() * WEAK_PHRASES.length)];
                            } else if (val.mental > 7 && val.fisico > 7) {
                                insight = "Sincronía total entre cuerpo y mente hoy. Estás en la 'Zona'.";
                                funPhrase = "Hoy has jugado como si pudieras ver el código de la pelota. Impresionante.";
                            }

                            // 3. Construct AI Profile Update
                            const aiProfile = uDoc.aiProfile || {};
                            aiProfile.lastInsight = insight;
                            aiProfile.funPhrase = funPhrase;
                            aiProfile.archetype = determineArchetype(aiProfile.archetype, goodChips, (stats.x3 || 0) + (stats.x4 || 0), val.tecnica || 5);
                            
                            if (entry.aprendizaje) {
                                const lessons = aiProfile.lessonsLearned || [];
                                lessons.push({ date: new Date().toISOString(), text: entry.aprendizaje });
                                aiProfile.lessonsLearned = lessons.slice(-5);
                            }

                            // 4. Persist
                            await updateDocument('usuarios', targetUid, {
                                'advancedStats.fatigueIndex': newFatigue,
                                'advancedStats.pressure': newPressure,
                                aiProfile: aiProfile,
                                lastAnalysisDate: new Date().toISOString()
                            });

                            // 5. Notify
                            await createNotification(targetUid, "🤖 NÚCLEO IA: ANÁLISIS", funPhrase, "info");

                        } catch(e) { console.warn("⚠️ AI: Diary stats processing error", e); }
                    }
                    await AIOrchestrator.recalculatePlayerState(targetUid);
                    break;

                // ─── LOGIN ───
                case 'LOGIN':
                    await AIOrchestrator.init(targetUid);
                    break;

                // ─── ADMIN MANUAL OVERRIDE ───
                case 'ADMIN_UPDATE':
                    await AIOrchestrator.recalculatePlayerState(targetUid);
                    break;

                // ─── INVITATIONS ───
                case 'INVITATION_ACCEPTED':
                    // Could trigger a prediction refresh if needed
                    break;
                case 'INVITATION_REJECTED':
                    break;

                default:
                    console.warn(`🧠 AI BRAIN: Unknown event [${eventType}]`);
            }
        } catch (err) {
            console.error(`🧠 AI BRAIN: Error processing [${eventType}]`, err);
        }
    },

    /**
     * Core Loop: Recalculates and persists the unified PlayerState.
     * This is the SINGLE SOURCE OF TRUTH for all AI-driven data.
     */
    recalculatePlayerState: async (uid) => {
        try {
            const userDoc = await getDocument('usuarios', uid);
            if (!userDoc) return null;

            // ── 1. GATHER CONTEXT ──
            const q = query(
                collection(db, 'rankingLogs'), 
                where('uid', '==', uid), 
                orderBy('timestamp', 'desc'), 
                limit(10)
            );
            let recentLogs = [];
            try {
                const snaps = await getDocs(q);
                recentLogs = snaps.docs.map(d => d.data());
            } catch(e) {
                // Index might not exist yet — graceful degradation
                console.warn("⚠️ AI: rankingLogs query failed (index?)", e.code || e.message);
            }

            // ── 1.5 DEEP ANALYSIS (AI-Engine) ──
            const deepAnalysis = AI.analyzeProfile(userDoc, recentLogs, userDoc.diario || []);

            // ── 2. METRICS ──
            const eloTrend = recentLogs.slice(0,5).reduce((acc, curr) => acc + (curr.diff || 0), 0);
            const stats = userDoc.advancedStats || {};
            const fatigue = stats.fatigueIndex || 0; 
            const mental = stats.pressure || 50;

            // ── 3. ACCURACY & UPSETS (Last Match) ──
            let updatedAccuracy = stats.modelAccuracy || 85;
            let totalUpsets = stats.upsets || 0;

            if (recentLogs.length > 0 && recentLogs[0].matchId) {
                try {
                    const matchId = recentLogs[0].matchId;
                    const didIWin = recentLogs[0].diff > 0;
                    
                    let mDoc = await getDocument('partidosAmistosos', matchId);
                    if (!mDoc) mDoc = await getDocument('partidosReto', matchId);

                    if (mDoc?.preMatchPrediction) {
                        const analysis = PredictiveEngine.analyzeAccuracy(mDoc.preMatchPrediction, didIWin);
                        const upset = PredictiveEngine.detectUpset(mDoc.preMatchPrediction, didIWin);

                        updatedAccuracy = Math.round((updatedAccuracy * 0.9) + (analysis.accuracy * 0.1));
                        if (upset.isUpset) totalUpsets++;
                    }
                } catch(err) { console.warn("⚠️ AI Sync:", err.message); }
            }

            // ── 4. RUN AUTOMATION ENGINE ──
            const activeMode = AutomationEngine.determineActiveMode({
                recentResult: recentLogs[0]?.diff > 0 ? 'win' : 'loss',
                eloTrend,
                fatigueIndex: fatigue,
                mentalState: mental,
                winStreak: userDoc.rachaActual > 0 ? userDoc.rachaActual : 0,
                lossStreak: userDoc.rachaActual < 0 ? Math.abs(userDoc.rachaActual) : 0,
                accuracy: updatedAccuracy
            });

            // ── 5. GENERATE INTERVENTIONS ──
            const interventions = AutomationEngine.generateInterventionPlan(activeMode.mode, { 
                style: deepAnalysis.style
            });

            // ── 6. BUILD UNIFIED STATE ──
            const newState = {
                timestamp: new Date().toISOString(),
                // Core Status
                mode: activeMode.mode,
                modeLabel: activeMode.label,
                riskVal: activeMode.riskLevel,
                uiColor: activeMode.color,
                interventionText: activeMode.intervention,
                activeInterventions: interventions,
                
                // Qualities (from Deep Analysis)
                qualitative: {
                    style: deepAnalysis.style,
                    strengths: deepAnalysis.strengths,
                    weaknesses: deepAnalysis.weaknesses,
                    emotionalTrend: deepAnalysis.emotionalTrend,
                    progression: deepAnalysis.progressionIndex
                },

                // Unified Metrics
                metrics: {
                    eloTrend,
                    fatigue,
                    mental,
                    predictiveConfidence: updatedAccuracy,
                    volatilityProfile: (Math.abs(eloTrend) > 50) ? 'High' : 'Stable'
                }
            };

            // ── 7. PERSIST TO FIRESTORE ──
            await updateDocument('usuarios', uid, { 
                playerState: newState,
                'advancedStats.momentum': activeMode.mode,
                'advancedStats.modelAccuracy': updatedAccuracy,
                'advancedStats.upsets': totalUpsets,
                'advancedStats.style': deepAnalysis.style
            });

            return newState;

        } catch (e) {
            console.error("🧠 AI BRAIN: Critical failure", e);
            return null;
        }
    }
};
