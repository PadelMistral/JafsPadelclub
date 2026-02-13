// js/modules/theme-manager.js - Theme System V7.0
// Sistema de temas con 8 identidades visuales únicas

const THEMES = ['galactic', 'winter', 'ocean', 'arcade', 'minimal', 'neon', 'matrix', 'sunset', 'elegant'];
const STORAGE_KEY = 'padeluminatis_theme';

/**
 * Theme metadata for UI display
 */
const THEME_DATA = [
    { id: 'galactic', name: 'Galáctica', icon: '🌌', desc: 'Espacial y neón' },
    { id: 'winter', name: 'Invierno', icon: '❄️', desc: 'Frío y cristalino' },
    { id: 'ocean', name: 'Océano', icon: '🌊', desc: 'Profundidades marinas' },
    { id: 'arcade', name: 'Arcade', icon: '🕹️', desc: 'Retro gaming' },
    { id: 'minimal', name: 'Minimal', icon: '⬜', desc: 'Limpio y moderno' },
    { id: 'neon', name: 'Cyber', icon: '⚡', desc: 'Neón futurista' },
    { id: 'matrix', name: 'Circuito', icon: '🧬', desc: 'Códigos del Circuito' },
    { id: 'sunset', name: 'Sunset', icon: '🌅', desc: 'Atardecer cálido' },
    { id: 'elegant', name: 'Elegante', icon: '✨', desc: 'Lujo dorado' }
];

/**
 * Initialize theme system - call on every page load
 */
export function initThemeSystem() {
    const savedTheme = localStorage.getItem(STORAGE_KEY) || 'galactic';
    applyTheme(savedTheme, false);
    
    // Listen for theme changes from other tabs
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
            applyTheme(e.newValue, false);
        }
    });
}

/**
 * Apply a theme to the document
 * @param {string} themeName - Theme identifier
 * @param {boolean} save - Whether to persist to localStorage
 */
export function applyTheme(themeName, save = true) {
    if (!THEMES.includes(themeName)) themeName = 'galactic';
    
    // Add transition class for smooth theme change
    document.documentElement.classList.add('theme-transitioning');
    
    // Apply the theme
    document.documentElement.setAttribute('data-theme', themeName);
    
    if (save) {
        localStorage.setItem(STORAGE_KEY, themeName);
    }
    
    // Update selector UI if present
    updateSelectorUI(themeName);
    
    // Remove transition class after animation
    setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
    }, 500);
    
    console.log(`🎨 Theme applied: ${themeName}`);
}

/**
 * Get current theme
 * @returns {string} Current theme identifier
 */
export function getCurrentTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'galactic';
}

/**
 * Get all available themes with metadata
 * @returns {Array} Array of theme objects
 */
export function getAvailableThemes() {
    return THEME_DATA;
}

/**
 * Update the visual state of the theme selector
 * @param {string} activeTheme - Currently active theme
 */
function updateSelectorUI(activeTheme) {
    const options = document.querySelectorAll('.theme-option');
    options.forEach(opt => {
        const theme = opt.dataset.theme;
        opt.classList.toggle('active', theme === activeTheme);
    });
}

/**
 * Render the theme selector component
 * @param {string} containerId - ID of container element
 */
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
                    <div class="theme-preview ${t.id}">${t.icon}</div>
                    <span class="theme-name">${t.name}</span>
                </div>
            `).join('')}
        </div>
    `;
    
    // Expose global function for onclick handlers
    window.setTheme = (theme) => {
        applyTheme(theme);
    };
}




