/**
 * @file player-comparator.js
 * @version 1.0 (Phase 5)
 * @description Logic for comparing two players (H2H, Attributes, Stats)
 */

import { getDocument } from '../firebase-service.js';
import { getDynamicKFactor } from './stats-evolution.js';

export async function comparePlayers(uid1, uid2) {
    if (!uid1 || !uid2) return null;

    try {
        const [p1, p2] = await Promise.all([
            getDocument('usuarios', uid1),
            getDocument('usuarios', uid2)
        ]);

        if (!p1 || !p2) return null;

        // Calculate visual power levels (Composite Score)
        const power1 = calculatePowerLevel(p1);
        const power2 = calculatePowerLevel(p2);

        // Diff attributes
        const attrDiff = {};
        const attrs = ['volea', 'remate', 'fondo', 'fisico', 'mentalidad'];
        attrs.forEach(key => {
            const v1 = p1.atributosTecnicos?.[key] || 50;
            const v2 = p2.atributosTecnicos?.[key] || 50;
            attrDiff[key] = { 
                val1: v1, 
                val2: v2, 
                diff: (v1 - v2).toFixed(1),
                leader: v1 > v2 ? 1 : (v2 > v1 ? 2 : 0)
            };
        });

        // Competitive projection
        const k1 = getDynamicKFactor(p1);
        const k2 = getDynamicKFactor(p2);

        return {
            p1: { name: p1.nombreUsuario || p1.nombre, level: p1.nivel, elo: p1.puntosRanking, kFactor: k1 },
            p2: { name: p2.nombreUsuario || p2.nombre, level: p2.nivel, elo: p2.puntosRanking, kFactor: k2 },
            powerLevel: { p1: power1, p2: power2 },
            attributes: attrDiff
        };

    } catch (e) {
        console.error("Comparison Error", e);
        return null;
    }
}

function calculatePowerLevel(user) {
    const attrs = user.atributosTecnicos || {};
    const base = (user.nivel || 2.5) * 20; // Level 3.0 -> 60 base
    
    // Bonus from attributes (0-50 scale contribution)
    const tech = ((attrs.volea||50) + (attrs.remate||50) + (attrs.fondo||50)) / 3;
    const phys = (attrs.fisico || 50);
    const ment = (attrs.mentalidad || 50);

    // Weighted formula
    // 50% Level, 25% Technical, 15% Physical, 10% Mental
    return Math.round(base + (tech * 0.25) + (phys * 0.15) + (ment * 0.1));
}
