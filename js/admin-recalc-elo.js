import { db } from "./firebase-service.js";
import { collection, getDocs, doc, writeBatch } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { processMatchResults } from "./ranking-service.js";
import { ELO_CONFIG, ELO_SYSTEM_VERSION } from "./config/elo-system.js";

/**
 * WIPE_AND_RECALC_ALL_MATCHES — Reset Total de ELO V3
 *
 * 1. Resetea todos los usuarios al BASE_RATING (1000)
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
    const { levelFromRating } = await import("./config/elo-system.js");
    let batch = writeBatch(db);
    let count = 0;
    console.log(`🔄 Inicializando ${usersSnap.docs.length} usuarios con puntuación base...`);

    for (const d of usersSnap.docs) {
        const u = d.data();
        const startRating = Number(ELO_CONFIG.BASE_RATING || 1000);
        const startLevel = Number(levelFromRating(startRating) || 2.5);

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

    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        const resStr = match.data.resultado?.sets;
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
            console.error(`   ❌ Error: ${match.id}`, e?.message || e);
        }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`\n✅ RECALCULACIÓN COMPLETA [${ELO_SYSTEM_VERSION}]`);
    console.log(`   ✓ ${successCount} partidos procesados correctamente`);
    console.log(`   ✗ ${errorCount} errores`);
    console.log(`   ⏱️ ${elapsed}s`);
    console.log(`\n📋 Nuevo sistema: ${ELO_CONFIG.RATING_PER_LEVEL}pts/nivel, K.STABLE=${ELO_CONFIG.K.STABLE}, CAP=${ELO_CONFIG.CAPS.COMPETITIVE_ABS}`);

    return { success: true, processed: successCount, errors: errorCount, elapsed };
};
