// js/modules/theme-manager.js - Galactic Theme System V2.0
const THEMES = ['galactic', 'winter', 'arcade', 'fantasy', 'neon', 'sunset', 'ocean', 'minimal'];
const STORAGE_KEY = 'padeluminatis_theme';

/**
 * Initialize theme system - call on every page load
 */
export function initThemeSystem() {
    const savedTheme = localStorage.getItem(STORAGE_KEY) || 'galactic';
    applyTheme(savedTheme);
    
    // Listen for theme changes from other tabs
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
            applyTheme(e.newValue, false);
        }
    });
}

/**
 * Apply a theme to the document
 */
export function applyTheme(themeName, save = true) {
    if (!THEMES.includes(themeName)) themeName = 'galactic';
    
    document.documentElement.setAttribute('data-theme', themeName);
    
    if (save) {
        localStorage.setItem(STORAGE_KEY, themeName);
    }
    
    // Update selector UI if present
    updateSelectorUI(themeName);
    
    console.log(`🎨 Theme applied: ${themeName}`);
}

/**
 * Get current theme
 */
export function getCurrentTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'galactic';
}

/**
 * Update the visual state of the theme selector
 */
function updateSelectorUI(activeTheme) {
    const options = document.querySelectorAll('.theme-option');
    options.forEach(opt => {
        const theme = opt.dataset.theme;
        if (theme === activeTheme) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });
}

/**
 * Render the theme selector component
 */
export function renderThemeSelector(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const current = getCurrentTheme();
    
    const themeData = [
        { id: 'galactic', name: 'Galáctica', icon: '🌌' },
        { id: 'winter', name: 'Invierno', icon: '❄️' },
        { id: 'arcade', name: 'Arcade', icon: '🕹️' },
        { id: 'fantasy', name: 'Fantasía', icon: '🧙' },
        { id: 'neon', name: 'Neón', icon: '💚' },
        { id: 'sunset', name: 'Atardecer', icon: '🌅' },
        { id: 'ocean', name: 'Océano', icon: '🌊' },
        { id: 'minimal', name: 'Minimal', icon: '⬜' }
    ];
    
    container.innerHTML = `
        <div class="theme-selector-grid">
            ${themeData.map(t => `
                <div class="theme-option ${t.id === current ? 'active' : ''}" 
                     data-theme="${t.id}"
                     onclick="window.setTheme('${t.id}')">
                    <div class="theme-preview ${t.id}">${t.icon}</div>
                    <span class="theme-name">${t.name}</span>
                </div>
            `).join('')}
        </div>
    `;
    
    // Expose global function
    window.setTheme = (theme) => {
        applyTheme(theme);
    };
}
