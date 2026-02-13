/* js/palas.js - Padel Lab Core V4.0 */
import { auth, db, getDocument, subscribeCol, updateDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { collection, addDoc, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

initAppUI('palas');

document.addEventListener('DOMContentLoaded', async () => {
    const s1 = document.getElementById('pala-1');
    const s2 = document.getElementById('pala-2');
    const container = document.getElementById('comparison-results');
    const modalRegister = document.getElementById('modal-register-pala');
    
    let allPalas = [];
    let currentUser = null;

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            loadPalas();
        }
    });

    async function loadPalas() {
        try {
            const snap = await window.getDocsSafe(collection(db, "palas"));
            allPalas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Add default palas if empty
            if (allPalas.length === 0) {
                const defaults = [
                    { name: "Bullpadel Vertex 03", brand: "Bullpadel", power: 95, control: 85, sweet: 80, comfort: 75, hardness: 90, balance: "High", style: "ATAQUE" },
                    { name: "Head Alpha Pro", brand: "Head", power: 88, control: 92, sweet: 88, comfort: 90, hardness: 75, balance: "Mid", style: "HÍBRIDO" },
                    { name: "Adidas Adipower 3.2", brand: "Adidas", power: 98, control: 80, sweet: 75, comfort: 70, hardness: 95, balance: "High", style: "POTENCIA" },
                    { name: "Nox AT10 Genius", brand: "Nox", power: 92, control: 88, sweet: 90, comfort: 85, hardness: 80, balance: "Mid", style: "HÍBRIDO" }
                ];
                for (const p of defaults) {
                    await addDoc(collection(db, "palas"), p);
                }
                return loadPalas();
            }

            populateSelects();
        } catch (e) {
            console.error(e);
            container.innerHTML = `
                <div class="results-placeholder">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Error cargando palas</span>
                </div>
            `;
        }
    }

    function populateSelects() {
        if (!s1 || !s2) return;
        
        const defaultOption = '<option value="">Selecciona pala...</option>';
        s1.innerHTML = defaultOption + allPalas.map(p => `<option value="${p.id}">${p.brand} - ${p.name}</option>`).join('');
        s2.innerHTML = defaultOption + allPalas.map(p => `<option value="${p.id}">${p.brand} - ${p.name}</option>`).join('');
        
        // Auto-select first two if available
        if (allPalas.length >= 2) {
            s1.value = allPalas[0].id;
            s2.value = allPalas[1].id;
        }
        
        s1.onchange = updateComparison;
        s2.onchange = updateComparison;
        updateComparison();
    }

    window.updateComparison = async () => {
        const p1 = allPalas.find(p => p.id === s1?.value);
        const p2 = allPalas.find(p => p.id === s2?.value);
        
        if (!p1 || !p2) {
            container.innerHTML = `
                <div class="results-placeholder">
                    <i class="fas fa-chart-bar"></i>
                    <span>Selecciona dos palas para comparar</span>
                </div>
            `;
            return;
        }

        const metrics = [
            { key: 'power', label: 'Potencia', icon: 'fa-bolt' },
            { key: 'control', label: 'Control', icon: 'fa-crosshairs' },
            { key: 'sweet', label: 'Punto Dulce', icon: 'fa-bullseye' },
            { key: 'hardness', label: 'Dureza', icon: 'fa-shield-halved' },
            { key: 'comfort', label: 'Confort', icon: 'fa-heart' }
        ];

        // Fetch diary comments for both
        const [sense1, sense2] = await Promise.all([
            fetchSensations(p1.name),
            fetchSensations(p2.name)
        ]);

        container.innerHTML = `
            <!-- Header -->
            <div class="comparison-header">
                <div class="pala-header pala-a">
                    <span class="pala-brand">${p1.brand}</span>
                    <span class="pala-name">${p1.name}</span>
                    <span class="pala-balance">${getBalanceLabel(p1.balance)}</span>
                </div>
                <div class="vs-badge">VS</div>
                <div class="pala-header pala-b">
                    <span class="pala-brand">${p2.brand}</span>
                    <span class="pala-name">${p2.name}</span>
                    <span class="pala-balance">${getBalanceLabel(p2.balance)}</span>
                </div>
            </div>

            <!-- Metrics -->
            <div class="comparison-metrics">
                ${metrics.map(m => `
                    <div class="spec-row">
                        <span class="spec-label"><i class="fas ${m.icon}"></i> ${m.label}</span>
                        <div class="spec-track">
                            <div class="spec-fill fill-a" style="width: ${p1[m.key]}%"></div>
                        </div>
                        <div class="spec-values">
                            <span class="spec-val val-a">${p1[m.key]}</span>
                            <span class="spec-separator">-</span>
                            <span class="spec-val val-b">${p2[m.key]}</span>
                        </div>
                        <div class="spec-track">
                            <div class="spec-fill fill-b" style="width: ${p2[m.key]}%"></div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <!-- Community Feedback -->
            <div class="feedback-section">
                <div class="feedback-card pala-a">
                    <h4 class="feedback-title"><i class="fas fa-users"></i> Comunidad</h4>
                    <div class="feedback-list">
                        ${sense1.length ? sense1.map(s => `<p class="feedback-quote">"${s}"</p>`).join('') : '<span class="feedback-empty">Sin registros</span>'}
                    </div>
                </div>
                <div class="feedback-card pala-b">
                    <h4 class="feedback-title"><i class="fas fa-users"></i> Comunidad</h4>
                    <div class="feedback-list">
                        ${sense2.length ? sense2.map(s => `<p class="feedback-quote">"${s}"</p>`).join('') : '<span class="feedback-empty">Sin registros</span>'}
                    </div>
                </div>
            </div>
        `;
    };

    function getBalanceLabel(balance) {
        const labels = { 'Low': '-️ Bajo', 'Mid': '-️ Medio', 'High': ' Alto' };
        return labels[balance] || balance;
    }

    async function fetchSensations(palaName) {
        try {
            const snap = await window.getDocsSafe(query(collection(db, "usuarios")));
            let sens = [];
            snap.forEach(doc => {
                const journal = doc.data().diario || [];
                journal.forEach(e => {
                    if (e.pala?.toLowerCase().includes(palaName.toLowerCase()) && e.comentarios) {
                        sens.push(e.comentarios);
                    }
                });
            });
            return sens.slice(0, 3);
        } catch (e) {
            return [];
        }
    }
    
    window.saveNewPala = async () => {
        const name = document.getElementById('reg-pala-name')?.value.trim();
        const brand = document.getElementById('reg-pala-brand')?.value.trim();
        
        if (!name || !brand) {
            showToast('Nombre y marca obligatorios', 'error');
            return;
        }
        
        const data = {
            name,
            brand,
            power: parseInt(document.getElementById('reg-pala-power')?.value || 80),
            control: parseInt(document.getElementById('reg-pala-control')?.value || 80),
            sweet: parseInt(document.getElementById('reg-pala-sweet')?.value || 80),
            hardness: parseInt(document.getElementById('reg-pala-hardness')?.value || 70),
            comfort: parseInt(document.getElementById('reg-pala-comfort')?.value || 80),
            balance: document.getElementById('reg-pala-balance')?.value || 'Mid',
            style: "N/A",
            createdBy: currentUser?.uid || 'anonymous',
            createdAt: new Date().toISOString()
        };
        
        try {
            await addDoc(collection(db, "palas"), data);
            showToast('Pala registrada', 'success');
            modalRegister?.classList.remove('active');
            
            // Reset form
            document.getElementById('reg-pala-name').value = '';
            document.getElementById('reg-pala-brand').value = '';
            
            loadPalas();
        } catch (e) {
            showToast('Error al guardar', 'error');
        }
    };
});




