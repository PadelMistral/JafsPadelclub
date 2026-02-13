/**
 * DASHBOARD-EVOLUTION.js - Phase 3: Premium Data Visualization
 * @version 1.0 (Deepmind Core)
 * 
 * Handles rendering of advanced evolution charts and tactical courts.
 */

// Mock or passed Canvas context
export const DashboardEvolution = {
    
    /**
     * Renders a 2vs2 Tactical Risk Map on a HTML Canvas or Container.
     * @param {HTMLElement} container - Container to render into.
     * @param {Object} riskAnalysis - Data from PredictiveEngine.analyzeTacticalRisks
     */
    renderTacticalCourt: (container, riskAnalysis) => {
        if (!container) return;

        container.innerHTML = `
            <div class="tactical-court-mini animate-fade-in">
                <div class="court-net"></div>
                <!-- Render Zones dynamically -->
                ${riskAnalysis.risks.map((r, i) => `
                    <div class="court-zone zone-risk" style="top: ${20 + (i*20)}%; left: 20%;" title="${r.desc}"></div>
                `).join('')}
                 ${riskAnalysis.opportunities.map((o, i) => `
                    <div class="court-zone zone-opportunity" style="top: ${20 + (i*20)}%; right: 20%;" title="${o.desc}"></div>
                `).join('')}
                
                <div class="absolute bottom-2 left-2 text-[8px] font-black text-white/50">ZONAS DE RIESGO</div>
                <div class="absolute bottom-2 right-2 text-[8px] font-black text-white/50">ZONAS DE ATAQUE</div>
            </div>
        `;
    },

    /**
     * Renders the DNA Bar Comparison.
     */
    renderDNAComparison: (container, dnaStats) => {
        if (!container) return;
        
        container.innerHTML = Object.keys(dnaStats).map(key => {
            const stat = dnaStats[key];
            const total = stat.user + stat.rival;
            const pUser = (stat.user / total) * 100;
            const pRival = (stat.rival / total) * 100;
            
            return `
                <div class="dna-comparison-row">
                    <span class="dna-label">${stat.label}</span>
                    <div class="dna-bar-container">
                        <div class="dna-bar-left" style="width: ${pUser}%"></div>
                        <div class="dna-bar-right" style="width: ${pRival}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Renders the Win Probability Gauge (Radial).
     */
    renderWinGauge: (container, prediction) => {
        if (!container) return;
        const p = prediction.winProbability;
        const color = p > 60 ? 'var(--sport-green)' : (p < 40 ? '#ff4d4d' : 'var(--sport-gold)');
        
        container.innerHTML = `
            <div class="prediction-gauge-container" style="background: conic-gradient(${color} ${p}%, rgba(255,255,255,0.05) ${p}% 100%); box-shadow: 0 0 30px ${color}40;">
                <div class="prediction-inner">
                    <span class="pred-percent" style="color: ${color}">${p}%</span>
                    <span class="pred-label">PROBABILIDAD</span>
                </div>
            </div>
            <div class="text-center mb-4">
               <div class="text-[10px] font-black uppercase tracking-widest text-white/60">${prediction.volatility}</div>
            </div>
        `;
    }
};
