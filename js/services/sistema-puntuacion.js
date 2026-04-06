// js/services/sistema-puntuacion.js
export class SistemaPuntuacionAvanzado {
    constructor(config = {}) {
        this.config = {
            baseElo: 1000,
            maxEloDelta: 32,
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

    _getTypeMultiplier(tipoPartido = "amistoso") {
        switch (String(tipoPartido || "").toLowerCase()) {
            case "amistoso":
                return 0.7;
            case "evento":
                return 1.15;
            case "reto":
                return 1.0;
            default:
                return 0.85;
        }
    }

    calcularCambio(contexto) {
        const {
            jugador,
            rivales = [],
            resultado,
            tipoPartido = "amistoso",
            margenSets = { juegosMios: 0, juegosRivales: 0, setsMios: 0, setsRivales: 0 },
            companero = null
        } = contexto;

        const racha = Number(jugador?.racha || jugador?.rachaActual || 0);
        const partidosJugados = Number(jugador?.partidosJugados || 0);
        const misPuntos = Number(jugador?.puntosRanking || this.config.baseElo);
        const puntosCompa = companero ? Number(companero?.puntosRanking || this.config.baseElo) : misPuntos;
        const miEquipoPts = (misPuntos + puntosCompa) / 2;
        const ptsRivalesArr = rivales.map((r) => Number(r?.puntosRanking || this.config.baseElo));
        const rivalesPts = ptsRivalesArr.length
            ? ptsRivalesArr.reduce((a, b) => a + b, 0) / ptsRivalesArr.length
            : this.config.baseElo;

        const esperado = this._getExpected(miEquipoPts, rivalesPts);
        const K = this._getKFactor(partidosJugados);
        const multTipo = this._getTypeMultiplier(tipoPartido);

        const eloDeltaBase = K * (resultado - esperado) * multTipo;
        const diffJuegos = Math.abs(Number(margenSets?.juegosMios || 0) - Number(margenSets?.juegosRivales || 0));
        const diffCompa = misPuntos - puntosCompa;
        const imbalance = companero ? Math.min(0.38, Math.abs(diffCompa) / 450) : 0;
        const baseMagnitude = Math.abs(eloDeltaBase);

        // Reparto de responsabilidad dentro de la pareja.
        let compaPenalty = 0;
        if (companero && imbalance > 0) {
            if (resultado === 1) {
                compaPenalty = diffCompa >= 0
                    ? -(baseMagnitude * imbalance * 0.42)
                    : (baseMagnitude * imbalance * 0.42);
            } else {
                compaPenalty = diffCompa >= 0
                    ? -(baseMagnitude * imbalance * 0.58)
                    : (baseMagnitude * imbalance * 0.30);
            }
        }

        let rachaBonus = 0;
        if (resultado === 1 && racha > 1) rachaBonus = Math.min(2.5, racha * 0.5);
        if (resultado === 0 && racha < -1) rachaBonus = Math.max(-2.5, racha * 0.4);

        let setsBonus = (Math.min(diffJuegos, 12) * 0.18) * (resultado === 1 ? 1 : -1);
        if ((margenSets?.setsMios || 0) >= 2 && (margenSets?.setsRivales || 0) === 0) {
            setsBonus += resultado === 1 ? 0.8 : -0.8;
        }

        const factoresExtra = compaPenalty + rachaBonus + setsBonus;
        const sumaTotal = eloDeltaBase + factoresExtra;
        const limiteAplicado = Math.max(-this.config.maxEloDelta, Math.min(this.config.maxEloDelta, sumaTotal));

        const baseNivel = tipoPartido === "amistoso" ? 0.0035 : 0.0065;
        const miNivel = Number(jugador?.nivel || 2.5);
        const compaNivel = companero ? Number(companero?.nivel || miNivel) : miNivel;
        const miEquipoLvl = (miNivel + compaNivel) / 2;
        const nivelesRivalesArr = rivales.map((r) => Number(r?.nivel || 2.5));
        const rivalesLvl = nivelesRivalesArr.length
            ? nivelesRivalesArr.reduce((a, b) => a + b, 0) / nivelesRivalesArr.length
            : 2.5;
        const lvlDiff = rivalesLvl - miEquipoLvl;

        let batacazoMult = 1.0;
        if (resultado === 1 && lvlDiff >= 0.5) batacazoMult = 1.15;
        if (resultado === 0 && lvlDiff <= -0.5) batacazoMult = 1.15;

        let nivelDelta = baseNivel * (1 + diffJuegos / 20) * batacazoMult;
        if (partidosJugados < 10) nivelDelta *= 1.3;
        nivelDelta = nivelDelta * (resultado === 1 ? 1 : -1);
        const nuevoNivelCambio = Math.max(-this.config.maxNivelDelta, Math.min(this.config.maxNivelDelta, nivelDelta));

        return {
            cambioElo: Number(eloDeltaBase.toFixed(2)),
            factoresAdicionales: {
                companero: Number(compaPenalty.toFixed(2)),
                racha: Number(rachaBonus.toFixed(2)),
                margenSets: Number(setsBonus.toFixed(2))
            },
            sumaTotal: Number(sumaTotal.toFixed(2)),
            limiteAplicado: Number(limiteAplicado.toFixed(2)),
            nuevoNivelCambio: Number(nuevoNivelCambio.toFixed(4)),
            desgloseReal: {
                esperado: Number(esperado.toFixed(3)),
                K,
                multiplicadorTipo: multTipo,
                diferenciaJuegos: diffJuegos,
                repartoCompanero: Number(imbalance.toFixed(3)),
                batacazoActivado: batacazoMult > 1.0,
                baseNivelAplicada: baseNivel,
                miEquipoPts: Number(miEquipoPts.toFixed(0)),
                rivalesPts: Number(rivalesPts.toFixed(0))
            }
        };
    }
}
