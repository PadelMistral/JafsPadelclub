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

const THEME_PRESENTATION = [
    { id: 'galactic',  name: 'Galactica',    icon: 'GAL', color: '#00d4ff', desc: 'Espacial y neon' },
    { id: 'neon',      name: 'Cyber Neon',   icon: 'NEO', color: '#00ff9f', desc: 'Cyberpunk electrico' },
    { id: 'matrix',    name: 'Matrix',       icon: 'MTX', color: '#00ff41', desc: 'Codigo digital' },
    { id: 'sunset',    name: 'Sunset',       icon: 'SUN', color: '#ff6b35', desc: 'Atardecer vibrante' },
    { id: 'elegant',   name: 'Elegante',     icon: 'GLD', color: '#d4a848', desc: 'Oro y lujo' },
    { id: 'ocean',     name: 'Oceano',       icon: 'OCN', color: '#06b6d4', desc: 'Profundidad marina' },
    { id: 'minimal',   name: 'Minimal',      icon: 'MIN', color: '#e2e8f0', desc: 'Oscuro limpio' },
    { id: 'winter',    name: 'Invierno',     icon: 'ICE', color: '#60a5fa', desc: 'Hielo cristalino' },
    { id: 'arcade',    name: 'Arcade',       icon: 'PIX', color: '#ff00ff', desc: 'Retro pixel' },
    { id: 'cherry',    name: 'Sakura',       icon: 'SAK', color: '#f472b6', desc: 'Rosa suave' },
    { id: 'emerald',   name: 'Esmeralda',    icon: 'EMR', color: '#34d399', desc: 'Verde premium' },
    { id: 'lava',      name: 'Volcan',       icon: 'LAV', color: '#ef4444', desc: 'Fuego intenso' },
];

function getThemePresentation() {
    return THEME_PRESENTATION;
}

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
    
    // Add visual transition overlay for dramatic effect
    const prev = document.documentElement.getAttribute('data-theme');
    if (prev && prev !== themeName && save) {
        const flash = document.createElement('div');
        flash.style.cssText = 'position:fixed;inset:0;z-index:999999;pointer-events:none;opacity:1;transition:opacity .6s ease;';
        const td = getThemePresentation().find(t => t.id === themeName);
        flash.style.background = `radial-gradient(circle at center, ${td?.color || '#00d4ff'}22, transparent 70%)`;
        document.body.appendChild(flash);
        requestAnimationFrame(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 650);
        });
    }

    document.documentElement.classList.add('theme-transitioning');
    document.documentElement.setAttribute('data-theme', themeName);
    
    // Update meta theme-color for browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    const td = getThemePresentation().find(t => t.id === themeName);
    if (meta && td) {
        const bgColors = {
            galactic: '#0a1426', neon: '#050110', matrix: '#000000',
            sunset: '#1a0b2e', elegant: '#0a0a0a', ocean: '#001220',
            minimal: '#f8fafc', winter: '#0c1929', arcade: '#0d0221',
            cherry: '#1a0a14', emerald: '#041210', lava: '#1a0505'
        };
        meta.setAttribute('content', bgColors[themeName] || '#020617');
    }
    
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
    return getThemePresentation();
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
    
    // Inject enhanced theme selector styles
    if (!document.getElementById('theme-selector-god-style')) {
        const s = document.createElement('style');
        s.id = 'theme-selector-god-style';
        s.textContent = `
            .theme-selector-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
            @media(min-width:400px){.theme-selector-grid{grid-template-columns:repeat(3,1fr)}}
            .theme-option{position:relative;border-radius:16px;border:2px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);cursor:pointer;transition:all .3s cubic-bezier(.34,1.56,.64,1);overflow:hidden;padding:0}
            .theme-option:hover{transform:translateY(-3px) scale(1.02);border-color:rgba(255,255,255,.2)}
            .theme-option.active{border-color:var(--t-primary,#00d4ff);box-shadow:0 0 20px var(--t-glow,rgba(0,212,255,.2))}
            .theme-option.active::after{content:"OK";position:absolute;top:8px;right:8px;width:24px;height:22px;background:var(--t-primary,#00d4ff);color:#000;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:950;z-index:3}
            .theme-preview{height:52px;position:relative;overflow:hidden}
            .theme-icon{position:absolute;bottom:7px;right:8px;font-size:10px;font-weight:950;letter-spacing:1px;color:rgba(255,255,255,.86);filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));z-index:2}
            .theme-option-head{padding:10px 12px;display:flex;align-items:center;gap:8px}
            .theme-option-copy{flex:1;min-width:0}
            .theme-name{display:block;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .theme-desc{display:block;font-size:9px;font-weight:600;color:rgba(255,255,255,.45);margin-top:1px}
            .theme-accent{width:14px;height:14px;border-radius:50%;flex-shrink:0;border:1px solid rgba(255,255,255,.15)}
        `;
        document.head.appendChild(s);
    }

    const previewBGs = {
        galactic: 'linear-gradient(135deg,#0a1426,#1d2b5a)',
        neon: 'linear-gradient(135deg,#050110,#1a0b3a)',
        matrix: 'linear-gradient(135deg,#000,#001a00)',
        sunset: 'linear-gradient(135deg,#1a0b2e,#2d0a12)',
        elegant: 'linear-gradient(135deg,#0a0a0a,#1a1408)',
        ocean: 'linear-gradient(135deg,#001220,#001830)',
        minimal: 'linear-gradient(135deg,#e2e8f0,#f8fafc)',
        winter: 'linear-gradient(135deg,#0c1929,#162d50)',
        arcade: 'linear-gradient(135deg,#0d0221,#1a0533)',
        cherry: 'linear-gradient(135deg,#1a0a14,#2d1020)',
        emerald: 'linear-gradient(135deg,#041210,#0a2620)',
        lava: 'linear-gradient(135deg,#1a0505,#2d0a0a)'
    };

    container.innerHTML = `
        <div class="theme-selector-grid">
            ${getThemePresentation().map(t => `
                <div class="theme-option ${t.id === current ? 'active' : ''}" 
                     data-theme="${t.id}"
                     onclick="window.setTheme('${t.id}')"
                     title="${t.desc}">
                    <div class="theme-preview" style="background:${previewBGs[t.id] || '#111'}">
                        <span class="theme-icon">${t.icon}</span>
                    </div>
                    <div class="theme-option-head">
                        <div class="theme-option-copy">
                            <span class="theme-name">${t.name}</span>
                            <span class="theme-desc">${t.desc}</span>
                        </div>
                        <span class="theme-accent" style="background:${t.color};box-shadow:0 0 12px ${t.color}55;"></span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    window.setTheme = (theme) => {
        applyTheme(theme);
    };
}
