import { db, getDocument } from '../firebase-service.js';
import { collection, query, where, getDocs, limit, orderBy } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

/**
 * Calculates a comprehensive player profile based on history and diary
 */
export async function analyzePlayerProfile(uid) {
    const user = await getDocument('usuarios', uid);
    if (!user) return null;

    // Fetch recent games
    const historySnap = await getDocs(query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(20)));
    const history = historySnap.docs.map(d => d.data());

    // Calculate Consistency & Tilt Factor
    let winStreak = 0;
    let tiltFactor = 0; // Tendency to lose consecutive games
    let consistencyScore = 0;

    history.forEach((h, i) => {
        if (h.diff > 0) winStreak++;
        if (h.diff < 0 && i > 0 && history[i-1].diff < 0) tiltFactor += 10;
        consistencyScore += Math.abs(h.diff); // High variance = low consistency
    });

    // Analyze Diary (Mental State)
    const diary = user.diario || [];
    const mentalStats = {
        confidence: 50,
        burnout: 0
    };

    if (diary.length > 0) {
        const lastEntries = diary.slice(-5);
        const badMoods = lastEntries.filter(e => ['Mal', 'Cansado'].includes(e.sensaciones)).length;
        mentalStats.burnout = (badMoods / 5) * 100;
        
        // Check self-assessed skills
        let atkSum = 0, defSum = 0;
        lastEntries.forEach(e => {
            const vals = e.valoracion || { ataque: 5, defensa: 5 };
            atkSum += vals.ataque || 5;
            defSum += vals.defensa || 5;
        });
        mentalStats.playStyle = atkSum > defSum ? 'Ofensivo' : 'Defensivo';
    }

    return {
        name: user.nombreUsuario || 'Jugador',
        level: user.nivel || 2.5,
        elo: user.puntosRanking || 1000,
        winRate: user.partidosJugados ? Math.round((user.victorias/user.partidosJugados)*100) : 0,
        form: calculateForm(history),
        mental: mentalStats,
        tiltRisk: tiltFactor > 20 ? 'ALTO' : 'BAJO',
        bestSynergy: 'Desconocido (Faltan datos)' // Placeholder for future logic
    };
}

function calculateForm(history) {
    if (!history.length) return 'Neutro';
    const last3 = history.slice(0, 3);
    const wins = last3.filter(h => h.diff > 0).length;
    if (wins === 3) return '🔥 ON FIRE';
    if (wins === 0) return '❄️ FRÍO';
    return 'Estable';
}

/**
 * Compares two players and predicts outcome
 */
export async function comparePlayers(uid1, uid2) {
    const p1 = await analyzePlayerProfile(uid1);
    const p2 = await analyzePlayerProfile(uid2);

    if (!p1 || !p2) return null;

    const eloDiff = p1.elo - p2.elo;
    const winProb = 1 / (1 + Math.pow(10, (p2.elo - p1.elo) / 400));
    
    let advice = "";
    if (eloDiff > 100) advice = "Eres superior técnicamente. Mantén la calma y no arriesgues bolas innecesarias.";
    else if (eloDiff < -100) advice = "Es un rival duro. Juega lento, globos profundos y espera su error. No entres al choque.";
    else advice = "Partido muy igualado. La clave estará en el físico y quien controle la red.";

    return {
        p1, p2,
        prob: Math.round(winProb * 100),
        advice,
        diff: eloDiff
    };
}

/**
 * Generates specific drills based on weaknesses
 */
export function getDrillsForProfile(profile) {
    if (profile.mental.playStyle === 'Ofensivo') {
        return [
            { name: "Volea de Bloqueo", desc: "Aprende a no pegar todo. Bloquea bolas rápidas a los pies." },
            { name: "Bandeja de Seguridad", desc: "Tira 50 bandejas al centro sin fallar." }
        ];
    } else {
        return [
            { name: "Salida de Pared Ofensiva", desc: "Convierte tu defensa en ataque con chiquitas." },
            { name: "Ganar la Red", desc: "Sube inmediatamente tras un globo profundo." }
        ];
    }
}
