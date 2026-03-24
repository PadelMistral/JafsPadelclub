import { db } from "./firebase-service.js";
import { collection, getDocs, doc, writeBatch } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { processMatchResults } from "./ranking-service.js";
import { ELO_CONFIG, ELO_SYSTEM_VERSION, ratingFromLevel, levelFromRating } from "./config/elo-system.js";
import { getResultSetsString } from "./utils/match-utils.js";

/**
 * WIPE_AND_RECALC_ALL_MATCHES — Reset Total de ELO V3
 *
 * 1. Resetea todos los usuarios a su base inicial guardada
 * 2. Borra ranking logs y match details
 * 3. Resetea rankingProcessed flags en partidos
 * 4. Re-procesa todos los partidos jugados cronológicamente
 *
 * Esto aplica el nuevo sistema ELO V3 con:
 *  - 300pts por nivel (más estable)
 *  - K-factors reducidos
 *  - Caps más ajustados
 *  - Demotion shield
 */
window.WIPE_AND_RECALC_ALL_MATCHES = async function () {
    const t0 = performance.now();
    console.log(`⚡ [${ELO_SYSTEM_VERSION}] STARTING FULL RECALCULATION...`);
    console.log(`📋 Config: BASE=${ELO_CONFIG.BASE_RATING}, RATING_PER_LEVEL=${ELO_CONFIG.RATING_PER_LEVEL}, K.STABLE=${ELO_CONFIG.K.STABLE}`);

    // 1. Reset all users
    const usersSnap = await getDocs(collection(db, "usuarios"));
    let batch = writeBatch(db);
    let count = 0;
    console.log(`🔄 Inicializando ${usersSnap.docs.length} usuarios con puntuación base...`);

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
            eloSystemVersion: ELO_SYSTEM_VERSION,
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
            console.log(`   ...${count} usuarios inicializados`);
        }
    }
    await batch.commit();
    console.log(`✅ ${count} usuarios reseteados.`);

    // 2. Delete old ranking logs
    console.log("🗑️ Eliminando ranking logs antiguos...");
    const logsSnap = await getDocs(collection(db, "rankingLogs"));
    batch = writeBatch(db);
    count = 0;
    for (const d of logsSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();
    console.log(`   ${count} logs eliminados.`);

    // 3. Delete old match point details
    console.log("🗑️ Eliminando match point details...");
    const matchDetailSnap = await getDocs(collection(db, "matchPointDetails"));
    batch = writeBatch(db);
    count = 0;
    for (const d of matchDetailSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();
    console.log(`   ${count} details eliminados.`);

    // 4. Fetch all played matches
    console.log("📥 Buscando partidos jugados...");
    const retos = await getDocs(collection(db, "partidosReto"));
    const amistosos = await getDocs(collection(db, "partidosAmistosos"));
    const eventos = await getDocs(collection(db, "eventoPartidos"));
    const allMatches = [];

    retos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "partidosReto", data: d.data() });
        }
    });
    amistosos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "partidosAmistosos", data: d.data() });
        }
    });
    // ✅ FIX Bug B: incluir eventoPartidos en la recalculación global
    eventos.docs.forEach((d) => {
        if (d.data().estado === "jugado" || d.data().estado === "finalizado") {
            allMatches.push({ id: d.id, col: "eventoPartidos", data: d.data() });
        }
    });

    // Sort chronological
    allMatches.sort((a, b) => {
        const ta = a.data.fecha?.seconds || 0;
        const tb = b.data.fecha?.seconds || 0;
        return ta - tb;
    });

    console.log(`📊 Encontrados ${allMatches.length} partidos jugados. Reseteando flags...`);

    // 5. Reset processed state
    batch = writeBatch(db);
    count = 0;
    for (const match of allMatches) {
        const bRef = doc(db, match.col, match.id);
        batch.update(bRef, {
            rankingProcessedAt: "",
            rankingProcessedResult: "",
            eloSummary: {},
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 6. Recalculate chronologically
    console.log("🔢 Recalculando partidos cronológicamente con ELO V3...");
    let successCount = 0;
    let errorCount = 0;
    const errorList = []; // ✅ FIX Bug A: declarar antes de usar

    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        const resStr = getResultSetsString(match.data);
        if (!resStr) continue;

        const pct = Math.round(((i + 1) / allMatches.length) * 100);
        console.log(`   [${i + 1}/${allMatches.length}] (${pct}%) ${match.id}`);

        try {
            await processMatchResults(match.id, match.col, resStr, {
                mvpId: match.data.mvp,
                surface: match.data.superficie || match.data.surface,
            });
            successCount++;
        } catch (e) {
            errorCount++;
            const msg = e?.message || String(e);
            console.error(`   ❌ Error: ${match.id}`, msg);
            if (errorList.length < 10) errorList.push({ id: match.id, col: match.col, error: msg });
        }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`\n✅ RECALCULACIÓN COMPLETA [${ELO_SYSTEM_VERSION}]`);
    console.log(`   ✓ ${successCount} partidos procesados correctamente`);
    console.log(`   ✗ ${errorCount} errores`);
    console.log(`   ⏱️ ${elapsed}s`);
    console.log(`\n📋 Nuevo sistema: ${ELO_CONFIG.RATING_PER_LEVEL}pts/nivel, K.STABLE=${ELO_CONFIG.K.STABLE}, CAP=${ELO_CONFIG.CAPS.COMPETITIVE_ABS}`);

    return { success: true, processed: successCount, errors: errorCount, elapsed, errorList };
};

/**
 * RECALC_FROM_CURRENT_LEVELS
 *
 * 1. Mantiene el nivel actual de cada usuario como punto de partida.
 * 2. Calcula puntos base desde ese nivel.
 * 3. Reprocesa todos los partidos jugados cronologicamente.
 */
window.RECALC_FROM_CURRENT_LEVELS = async function () {
    const t0 = performance.now();
    const { ratingFromLevel, levelFromRating } = await import("./config/elo-system.js");

    // 1. Reset users to current level base rating
    const usersSnap = await getDocs(collection(db, "usuarios"));
    let batch = writeBatch(db);
    let count = 0;

    for (const d of usersSnap.docs) {
        const u = d.data() || {};
        const currentLevel = Number.isFinite(Number(u.nivel)) ? Number(u.nivel) : levelFromRating(u.puntosRanking || ELO_CONFIG.BASE_RATING);
        const startRating = ratingFromLevel(currentLevel);

        batch.update(d.ref, {
            puntosRanking: startRating,
            rating: startRating,
            nivel: currentLevel,
            partidosJugados: 0,
            victorias: 0,
            rachaActual: 0,
            elo: {},
            nivelProgresoPct: 50,
            nivelRango: "Bronce",
            lastMatchAnalysis: null,
            eloSystemVersion: ELO_SYSTEM_VERSION,
            nivelBaseInicial: baseLevel,
            puntosBaseInicial: startRating,
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 2. Delete old ranking logs
    const logsSnap = await getDocs(collection(db, "rankingLogs"));
    batch = writeBatch(db);
    count = 0;
    for (const d of logsSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 3. Delete old match point details
    const matchDetailSnap = await getDocs(collection(db, "matchPointDetails"));
    batch = writeBatch(db);
    count = 0;
    for (const d of matchDetailSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 4. Fetch all played matches (amistosos + retos)
    const retos = await getDocs(collection(db, "partidosReto"));
    const amistosos = await getDocs(collection(db, "partidosAmistosos"));
    const eventos = await getDocs(collection(db, "eventoPartidos"));
    const allMatches = [];

    retos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "partidosReto", data: d.data() });
        }
    });
    amistosos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "partidosAmistosos", data: d.data() });
        }
    });
    eventos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "eventoPartidos", data: d.data() });
        }
    });
    allMatches.sort((a, b) => {
        const ta = a.data.fecha?.seconds || 0;
        const tb = b.data.fecha?.seconds || 0;
        return ta - tb;
    });

    // 5. Reset processed state
    batch = writeBatch(db);
    count = 0;
    for (const match of allMatches) {
        const bRef = doc(db, match.col, match.id);
        batch.update(bRef, {
            rankingProcessedAt: "",
            rankingProcessedResult: "",
            eloSummary: {},
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 6. Recalculate chronologically
    let successCount = 0;
    let errorCount = 0;
    const errorList = [];
    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        const resStr = getResultSetsString(match.data);
        if (!resStr) continue;
        try {
            await processMatchResults(match.id, match.col, resStr, {
                mvpId: match.data.mvp,
                surface: match.data.superficie || match.data.surface,
            });
            successCount++;
        } catch (e) {
            errorCount++;
            const msg = e?.message || String(e);
            console.error(`recalc error: ${match.id}`, msg);
            if (errorList.length < 10) errorList.push({ id: match.id, col: match.col, error: msg });
        }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    return { success: true, processed: successCount, errors: errorCount, elapsed, errorList };
};

/**
 * RECALC_FROM_CURRENT_POINTS
 *
 * 1. Mantiene el rating actual de cada usuario como base.
 * 2. Recalcula el nivel desde esos puntos.
 * 3. Reprocesa todos los partidos jugados cronologicamente.
 */
window.RECALC_FROM_CURRENT_POINTS = async function () {
    const t0 = performance.now();
    const { levelFromRating } = await import("./config/elo-system.js");

    // 1. Reset users to current points
    const usersSnap = await getDocs(collection(db, "usuarios"));
    let batch = writeBatch(db);
    let count = 0;

    for (const d of usersSnap.docs) {
        const u = d.data() || {};
        const startRating = Number(u.puntosRanking || ELO_CONFIG.BASE_RATING);
        const startLevel = levelFromRating(startRating);

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
            eloSystemVersion: ELO_SYSTEM_VERSION,
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 2. Delete old ranking logs
    const logsSnap = await getDocs(collection(db, "rankingLogs"));
    batch = writeBatch(db);
    count = 0;
    for (const d of logsSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 3. Delete old match point details
    const matchDetailSnap = await getDocs(collection(db, "matchPointDetails"));
    batch = writeBatch(db);
    count = 0;
    for (const d of matchDetailSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 4. Fetch all played matches
    const retos = await getDocs(collection(db, "partidosReto"));
    const amistosos = await getDocs(collection(db, "partidosAmistosos"));
    const eventos = await getDocs(collection(db, "eventoPartidos"));
    const allMatches = [];

    retos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "partidosReto", data: d.data() });
        }
    });
    amistosos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "partidosAmistosos", data: d.data() });
        }
    });
    eventos.docs.forEach((d) => {
        if (d.data().estado === "jugado") {
            allMatches.push({ id: d.id, col: "eventoPartidos", data: d.data() });
        }
    });

    allMatches.sort((a, b) => {
        const ta = a.data.fecha?.seconds || 0;
        const tb = b.data.fecha?.seconds || 0;
        return ta - tb;
    });

    // 5. Reset processed state
    batch = writeBatch(db);
    count = 0;
    for (const match of allMatches) {
        const bRef = doc(db, match.col, match.id);
        batch.update(bRef, {
            rankingProcessedAt: "",
            rankingProcessedResult: "",
            eloSummary: {},
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    // 6. Recalculate chronologically
    let successCount = 0;
    let errorCount = 0;
    const errorList = [];
    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        const resStr = getResultSetsString(match.data);
        if (!resStr) continue;
        try {
            await processMatchResults(match.id, match.col, resStr, {
                mvpId: match.data.mvp,
                surface: match.data.superficie || match.data.surface,
            });
            successCount++;
        } catch (e) {
            errorCount++;
            const msg = e?.message || String(e);
            console.error(`recalc error: ${match.id}`, msg);
            if (errorList.length < 10) errorList.push({ id: match.id, col: match.col, error: msg });
        }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    return { success: true, processed: successCount, errors: errorCount, elapsed, errorList };
};

/**
 * RECALC_MATCH_ELO
 * Forces a re-calculation of a single match.
 */
window.recalcMatchEloLegacy = async function (matchId, col, score) {
    if (!score) {
        alert("Introduce/Verifica el resultado antes de recalcular.");
        return;
    }
    
    console.log(`[Admin] Recalculating match ${matchId} (${col}) with score ${score}`);
    try {
        await processMatchResults(matchId, col, score);
        if (typeof window.showToast === 'function') {
            window.showToast("ADMIN", "Puntos recalculados", "success");
        }
        if (typeof window.refreshAll === 'function') {
            window.refreshAll();
        }
    } catch (e) {
        console.error("Recalc failed:", e);
        alert("Error al recalcular: " + e.message);
    }
};

if (typeof window.recalcMatchElo !== "function") {
    window.recalcMatchElo = window.recalcMatchEloLegacy;
}

window.RESTORE_AND_RECALC_FROM_BASE = async function () {
    const t0 = performance.now();
    const { ratingFromLevel, levelFromRating } = await import("./config/elo-system.js");

    console.log("RESTORE_AND_RECALC: Restaurando niveles bases...");
    const usersSnap = await getDocs(collection(db, "usuarios"));
    let batch = writeBatch(db);
    let count = 0;

    for (const d of usersSnap.docs) {
        const u = d.data() || {};
        // RECOVER BASE LEVEL (fallbacks directly to default if empty)
        let baseLevel = 2.5;
        if (Number.isFinite(Number(u.nivelBaseInicial))) {
            baseLevel = Number(u.nivelBaseInicial);
        } else if (Number.isFinite(Number(u.nivel_original))) {
            baseLevel = Number(u.nivel_original);
        } else if (Number.isFinite(Number(u.nivel))) {
            baseLevel = Number(u.nivel);
        }

        let basePoints = ratingFromLevel(baseLevel);
        if (Number.isFinite(Number(u.puntosBaseInicial))) {
            basePoints = Number(u.puntosBaseInicial);
        }

        batch.update(d.ref, {
            puntosRanking: basePoints,
            rating: basePoints,
            nivel: baseLevel,
            partidosJugados: 0,
            victorias: 0,
            rachaActual: 0,
            elo: {},
            nivelProgresoPct: 50,
            nivelRango: "Bronce",
            lastMatchAnalysis: null,
            eloSystemVersion: ELO_SYSTEM_VERSION,
            _recoveredFromBase: true
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    console.log("RESTORE_AND_RECALC: Reseteo base completado. Limpiando logs...");

    // Delete old logs
    const logsSnap = await getDocs(collection(db, "rankingLogs"));
    batch = writeBatch(db);
    count = 0;
    for (const d of logsSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    const matchDetailSnap = await getDocs(collection(db, "matchPointDetails"));
    batch = writeBatch(db);
    count = 0;
    for (const d of matchDetailSnap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    console.log("RESTORE_AND_RECALC: Procesando partidos cronologicamente...");

    const retos = await getDocs(collection(db, "partidosReto"));
    const amistosos = await getDocs(collection(db, "partidosAmistosos"));
    const eventos = await getDocs(collection(db, "eventoPartidos"));
    const allMatches = [];

    retos.docs.forEach((d) => {
        if (d.data().estado === "jugado" || d.data().resultado) allMatches.push({ id: d.id, col: "partidosReto", data: d.data() });
    });
    amistosos.docs.forEach((d) => {
        if (d.data().estado === "jugado" || d.data().resultado) allMatches.push({ id: d.id, col: "partidosAmistosos", data: d.data() });
    });
    eventos.docs.forEach((d) => {
        if (d.data().estado === "jugado" || d.data().resultado) allMatches.push({ id: d.id, col: "eventoPartidos", data: d.data() });
    });

    allMatches.sort((a, b) => {
        const ta = a.data.fecha?.seconds || 0;
        const tb = b.data.fecha?.seconds || 0;
        return ta - tb;
    });

    batch = writeBatch(db);
    count = 0;
    for (const match of allMatches) {
        const bRef = doc(db, match.col, match.id);
        batch.update(bRef, {
            rankingProcessedAt: "",
            rankingProcessedResult: "",
            eloSummary: {},
        });
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
        }
    }
    await batch.commit();

    let successCount = 0; let errorCount = 0; const errorList = [];
    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        const resStr = getResultSetsString(match.data);
        if (!resStr) continue;

        try {
            await processMatchResults(match.id, match.col, resStr, {
                mvpId: match.data.mvp,
                surface: match.data.superficie || match.data.surface,
            });
            successCount++;
        } catch (e) {
            errorCount++;
            errorList.push({ id: match.id, col: match.col, error: String(e) });
        }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    return { success: true, processed: successCount, errors: errorCount, elapsed, errorList };
};
