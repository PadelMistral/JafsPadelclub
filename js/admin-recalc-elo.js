import { db } from "./firebase-service.js";
import { collection, getDocs, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { processMatchResults } from "./ranking-service.js";
import { ELO_CONFIG, ELO_SYSTEM_VERSION, ratingFromLevel, levelFromRating } from "./config/elo-system.js";
import { ATP_TEST_SYSTEM_VERSION } from "./pruebaElo.js";
import { getResultSetsString } from "./utils/match-utils.js";

async function runFullRecalculation(scoringSystem = "default") {
    const t0 = performance.now();
    const activeVersion = scoringSystem === "atp_test" ? ATP_TEST_SYSTEM_VERSION : ELO_SYSTEM_VERSION;
    console.log(`⚡ [${activeVersion}] STARTING FULL RECALCULATION...`);

    // 1. Reset all users
    const usersSnap = await getDocs(collection(db, "usuarios"));
    const guestsSnap = await getDocs(collection(db, "invitados"));
    let batch = writeBatch(db);
    let count = 0;

    for (const d of usersSnap.docs) {
        const u = d.data();
        const baseLevel = Number.isFinite(Number(u?.nivelBaseInicial))
            ? Number(u.nivelBaseInicial)
            : Number.isFinite(Number(u?.nivel))
                ? Number(u.nivel)
                : 2.5;
        const startRating = Number.isFinite(Number(u?.puntosBaseInicial))
            ? Number(u.puntosBaseInicial)
            : Number(ratingFromLevel(baseLevel) || ELO_CONFIG.BASE_RATING || 1000);
        const startLevel = Number(levelFromRating(startRating) || baseLevel || 2.5);

        batch.update(d.ref, {
            puntosRanking: startRating,
            rating: startRating,
            nivel: startLevel,
            partidosJugados: 0,
            victorias: 0,
            rachaActual: 0,
            elo: {},
            nivelProgresoPct: 50,
            nivelRango: "Bronce",
            lastMatchAnalysis: null,
            eloSystemVersion: activeVersion,
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    batch = writeBatch(db);
    count = 0;
    for (const d of guestsSnap.docs) {
        const g = d.data();
        const baseLevel = Number.isFinite(Number(g?.nivelBaseInicial))
            ? Number(g.nivelBaseInicial)
            : Number.isFinite(Number(g?.nivel))
                ? Number(g.nivel)
                : 2.5;
        const startRating = Number.isFinite(Number(g?.puntosBaseInicial))
            ? Number(g.puntosBaseInicial)
            : Number(ratingFromLevel(baseLevel) || ELO_CONFIG.BASE_RATING || 1000);
        const startLevel = Number(levelFromRating(startRating) || baseLevel || 2.5);

        batch.set(d.ref, {
            puntosRanking: startRating,
            rating: startRating,
            nivel: startLevel,
            partidosJugados: 0,
            victorias: 0,
            rachaActual: 0,
            lastMatchAnalysis: null,
            eloSystemVersion: activeVersion,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 2. Clear logs and details
    const logsSnap = await getDocs(collection(db, "rankingLogs"));
    batch = writeBatch(db);
    for (const d of logsSnap.docs) batch.delete(d.ref);
    await batch.commit();

    const matchDetailSnap = await getDocs(collection(db, "matchPointDetails"));
    batch = writeBatch(db);
    for (const d of matchDetailSnap.docs) batch.delete(d.ref);
    await batch.commit();

    // 3. Collect matches
    const retos = await getDocs(collection(db, "partidosReto"));
    const amistosos = await getDocs(collection(db, "partidosAmistosos"));
    const eventos = await getDocs(collection(db, "eventoPartidos"));
    const allMatches = [];

    retos.docs.forEach(d => { if(d.data().estado === 'jugado') allMatches.push({ id:d.id, col:'partidosReto', data:d.data() }); });
    amistosos.docs.forEach(d => { if(d.data().estado === 'jugado') allMatches.push({ id:d.id, col:'partidosAmistosos', data:d.data() }); });
    eventos.docs.forEach(d => { if(d.data().estado === 'jugado' || d.data().estado === 'finalizado') allMatches.push({ id:d.id, col:'eventoPartidos', data:d.data() }); });

    allMatches.sort((a, b) => (a.data.fecha?.seconds || 0) - (b.data.fecha?.seconds || 0));

    // 4. Reset flags
    batch = writeBatch(db);
    count = 0;
    for (const m of allMatches) {
        batch.update(doc(db, m.col, m.id), { rankingProcessedAt: null, rankingProcessedResult: null, eloSummary: null });
        count++;
        if (count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();

    // 5. Recalc
    let successCount = 0;
    let errorCount = 0;
    const errorList = [];

    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        const resStr = getResultSetsString(match.data);
        if (!resStr) continue;

        const pct = Math.round(((i + 1) / allMatches.length) * 100);
        window.dispatchEvent(new CustomEvent('adminRecalcProgress', {
            detail: { current: i + 1, total: allMatches.length, pct, matchId: match.id }
        }));

        try {
            await processMatchResults(match.id, match.col, resStr, {
                mvpId: match.data.mvp,
                surface: match.data.superficie || match.data.surface,
                scoringSystem,
            });
            successCount++;
        } catch (e) {
            errorCount++;
            if (errorList.length < 10) errorList.push({ id: match.id, error: String(e) });
        }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    return { success: true, processed: successCount, errors: errorCount, elapsed, errorList, systemVersion: activeVersion, scoringSystem };
}

window.WIPE_AND_RECALC_ALL_MATCHES = () => runFullRecalculation("default");
window.WIPE_AND_RECALC_ALL_MATCHES_ATP = () => runFullRecalculation("atp_test");
window.RESTORE_AND_RECALC_FROM_BASE = window.WIPE_AND_RECALC_ALL_MATCHES;
window.RESTORE_AND_RECALC_FROM_BASE_ATP = window.WIPE_AND_RECALC_ALL_MATCHES_ATP;
