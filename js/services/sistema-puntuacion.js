// js/services/sistema-puntuacion.js
export class SistemaPuntuacionAvanzado {
    constructor(config = {}) {
        this.config = {
            baseElo: 1000,
            maxEloDelta: 40,
            maxNivelDelta: 0.03,
            ...config
        };
    }

    _getExpected(ratingA, ratingB) {
        return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    }

    _getKFactor(partidosJugados) {
        if (partidosJugados < 10) return 20;
        if (partidosJugados <= 30) return 16;
        return 12;
    }

    /**
     * contexto = {
     *   jugador: { puntosRanking: 1000, nivel: 2.5, racha: 2, partidosJugados: 10 },
     *   companero: { puntosRanking: 1050, nivel: 2.6 }, // null si es 1v1
     *   rivales: [ { puntosRanking: 980, nivel: 2.4 }, ... ],
     *   resultado: 1 | 0,
     *   tipoPartido: 'reto' | 'amistoso' | 'evento',
     *   margenSets: { juegosMios, juegosRivales, setsMios, setsRivales }
     * }
     */
    calcularCambio(contexto) {
        const {
            jugador,
            rivales = [],
            resultado,
            tipoPartido = 'amistoso',
            margenSets = { juegosMios: 0, juegosRivales: 0, setsMios: 0, setsRivales: 0 },
            companero = null
        } = contexto;

        // --- 1. DATOS PREVIOS ---
        const racha = Number(jugador.racha || 0);
        const partidosJugados = Number(jugador.partidosJugados || 0);

        const misPuntos = Number(jugador.puntosRanking || 1000);
        const puntosCompa = companero ? Number(companero.puntosRanking || 1000) : misPuntos;
        const miEquipoPts = (misPuntos + puntosCompa) / 2;

        const ptsRivalesArr = rivales.map(r => Number(r?.puntosRanking || 1000));
        const rivalesPts = ptsRivalesArr.length ? ptsRivalesArr.reduce((a,b)=>a+b,0) / ptsRivalesArr.length : 1000;

        // --- 2. ELO DINÁMICO BASE ---
        const esperado = this._getExpected(miEquipoPts, rivalesPts);
        const K = this._getKFactor(partidosJugados);

        let eloDeltaBase = K * (resultado - esperado);

        // --- 3. MULTIPLICADOR POR TIPO DE ENCUENTRO ---
        let multTipo = 1.0;
        switch (String(tipoPartido || "").toLowerCase()) {
            case 'amistoso': multTipo = 0.6; break;
            case 'evento': multTipo = 1.25; break;
            case 'reto': multTipo = 1.0; break;
            default: multTipo = 0.8; break;
        }

        eloDeltaBase *= multTipo;

        // --- 4. FACTORES SECUNDARIOS (ADDITIVOS CON CAP) ---
        
        // A) Compañero: Penaliza si tu compañero es MUCHO más fuerte que tú y ganáis
        let compaPenalty = 0;
        if (companero && companero.puntosRanking > misPuntos + 250) {
            const diff = companero.puntosRanking - misPuntos;
            compaPenalty = -(Math.min(6, diff / 50));
            if (resultado === 0) compaPenalty = 0; // Solo aplica si ganas apoyándote
        } else if (companero && misPuntos > companero.puntosRanking + 250) {
            // Si tú eres el acarreador y ganas
            if (resultado === 1) compaPenalty = Math.min(3, (misPuntos - companero.puntosRanking)/100);
        }

        // B) Racha
        let rachaBonus = 0;
        if (resultado === 1 && racha > 1) rachaBonus = Math.min(5, racha);
        if (resultado === 0 && racha < -1) rachaBonus = Math.max(-5, racha); // Resta menos -1, -2, -3...

        // C) Margen Sets / Dificultad
        let setsBonus = 0;
        const diffJuegos = Math.abs((margenSets.juegosMios || 0) - (margenSets.juegosRivales || 0));
        setsBonus = (diffJuegos * 0.25) * (resultado === 1 ? 1 : -1);

        // Sumatoria Factores
        const factoresExtraSinMultiplicar = compaPenalty + rachaBonus + setsBonus;
        const factoresExtraFinales = factoresExtraSinMultiplicar * multTipo;

        // --- 5. SUMAS TOTALES Y LÍMITES ELO ---
        const sumaTotal = eloDeltaBase + factoresExtraFinales;
        const limiteAplicado = Math.max(-this.config.maxEloDelta, Math.min(this.config.maxEloDelta, sumaTotal));

        // --- 6. MOTOR DE NIVEL (SKILL LEVEL) ---
        const baseNivel = tipoPartido === 'amistoso' ? 0.004 : 0.008;
        
        const miNivel = Number(jugador.nivel || 2.5);
        const compaNivel = companero ? Number(companero.nivel || miNivel) : miNivel;
        const miEquipoLvl = (miNivel + compaNivel) / 2;

        const nivelesRivalesArr = rivales.map(r => Number(r?.nivel || 2.5));
        const rivalesLvl = nivelesRivalesArr.length ? nivelesRivalesArr.reduce((a,b)=>a+b,0)/nivelesRivalesArr.length : 2.5;

        const lvlDiff = rivalesLvl - miEquipoLvl;
        
        let batacazoMult = 1.0;
        if (resultado === 1 && lvlDiff >= 0.5) batacazoMult = 1.2;
        if (resultado === 0 && lvlDiff <= -0.5) batacazoMult = 1.2;

        const rendimientoLvl = 1 + (diffJuegos / 15);
        
        let nivelDelta = baseNivel * rendimientoLvl * batacazoMult * multTipo;
        
        // Ajuste inverso de experiencia en nivel (los nuevos suben más rápido)
        if (partidosJugados < 10) nivelDelta *= 1.5;
        
        nivelDelta = nivelDelta * (resultado === 1 ? 1 : -1);

        const nuevoNivelCambio = Math.max(-this.config.maxNivelDelta, Math.min(this.config.maxNivelDelta, nivelDelta));

        // --- 7. OBJETO COMPLEJO DE RETORNO Y TRANSPARENCIA ---
        return {
            cambioElo: Number(eloDeltaBase.toFixed(2)),
            factoresAdicionales: {
                companero: Number((compaPenalty * multTipo).toFixed(2)),
                racha: Number((rachaBonus * multTipo).toFixed(2)),
                margenSets: Number((setsBonus * multTipo).toFixed(2))
            },
            sumaTotal: Number(sumaTotal.toFixed(2)),
            limiteAplicado: Number(limiteAplicado.toFixed(2)),
            nuevoNivelCambio: Number(nuevoNivelCambio.toFixed(4)),
            desgloseReal: {
                esperado: Number(esperado.toFixed(3)),
                K: K,
                multiplicadorTipo: multTipo,
                diferenciaJuegos: diffJuegos,
                batacazoActivado: batacazoMult > 1.0,
                baseNivelAplicada: baseNivel,
                miEquipoPts: Number(miEquipoPts.toFixed(0)),
                rivalesPts: Number(rivalesPts.toFixed(0))
            }
        };
    }
}
