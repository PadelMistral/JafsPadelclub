// js/modules/theme-manager.js - Theme System V3.0
// 12 immersive visual identities with rich transitions

const THEMES = [
  'galactic', 'neon', 'matrix', 'sunset', 'elegant',
  'ocean', 'minimal', 'winter', 'arcade',
  'cherry', 'emerald', 'lava'
];
const STORAGE_KEY = 'padeluminatis_theme';

const THEME_DATA = [
    { id: 'galactic',  name: 'Galáctica',    icon: '🌌', color: '#00d4ff', desc: 'Espacial & Neón' },
    { id: 'neon',      name: 'Cyber Neón',   icon: '⚡', color: '#00ff9f', desc: 'Cyberpunk eléctrico' },
    { id: 'matrix',    name: 'Matrix',       icon: '🧬', color: '#00ff41', desc: 'Código digital' },
    { id: 'sunset',    name: 'Sunset',       icon: '🌅', color: '#ff6b35', desc: 'Atardecer vibrante' },
    { id: 'elegant',   name: 'Elegante',     icon: '✨', color: '#d4a848', desc: 'Oro y lujo' },
    { id: 'ocean',     name: 'Océano',       icon: '🌊', color: '#06b6d4', desc: 'Profundidad marina' },
    { id: 'minimal',   name: 'Minimal',      icon: '◻️', color: '#e2e8f0', desc: 'Oscuro limpio' },
    { id: 'winter',    name: 'Invierno',     icon: '❄️', color: '#60a5fa', desc: 'Hielo cristalino' },
    { id: 'arcade',    name: 'Arcade',       icon: '🕹️', color: '#ff00ff', desc: 'Retro pixel' },
    { id: 'cherry',    name: 'Sakura',       icon: '🌸', color: '#f472b6', desc: 'Rosa suave' },
    { id: 'emerald',   name: 'Esmeralda',    icon: '💎', color: '#34d399', desc: 'Verde premium' },
    { id: 'lava',      name: 'Volcán',       icon: '🌋', color: '#ef4444', desc: 'Fuego intenso' },
];

export function initThemeSystem() {
    const savedTheme = localStorage.getItem(STORAGE_KEY) || 'galactic';
    applyTheme(savedTheme, false);
    
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
            applyTheme(e.newValue, false);
        }
    });
}

export function applyTheme(themeName, save = true) {
    if (!THEMES.includes(themeName)) themeName = 'galactic';
    
    document.documentElement.classList.add('theme-transitioning');
    document.documentElement.setAttribute('data-theme', themeName);
    
    // Update meta theme-color for browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    const td = THEME_DATA.find(t => t.id === themeName);
    if (meta && td) meta.setAttribute('content', td.color === '#e2e8f0' ? '#111318' : '#050a18');
    
    if (save) localStorage.setItem(STORAGE_KEY, themeName);
    updateSelectorUI(themeName);
    
    setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
    }, 600);
}

export function getCurrentTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'galactic';
}

export function getAvailableThemes() {
    return THEME_DATA;
}

function updateSelectorUI(activeTheme) {
    const options = document.querySelectorAll('.theme-option');
    options.forEach(opt => {
        const theme = opt.dataset.theme;
        opt.classList.toggle('active', theme === activeTheme);
    });
}

export function renderThemeSelector(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const current = getCurrentTheme();
    
    container.innerHTML = `
        <div class="theme-selector-grid">
            ${THEME_DATA.map(t => `
                <div class="theme-option ${t.id === current ? 'active' : ''}" 
                     data-theme="${t.id}"
                     onclick="window.setTheme('${t.id}')"
                     title="${t.desc}">
                    <div class="theme-preview ${t.id}">
                        <span class="theme-icon">${t.icon}</span>
                    </div>
                    <div class="theme-option-head">
                        <div class="theme-option-copy">
                            <span class="theme-name">${t.name}</span>
                            <span class="theme-desc">${t.desc}</span>
                        </div>
                        <span class="theme-accent" style="background:${t.color}; box-shadow:0 0 18px ${t.color}66;"></span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    window.setTheme = (theme) => {
        applyTheme(theme);
    };
}
