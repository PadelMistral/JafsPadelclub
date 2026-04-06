/**
 * js/modules/audio-manager.js
 * Premium UI Sound System for Padeluminatis
 */

const AUDIO_ENABLED_KEY = 'app_audio_enabled';
const DEFAULT_VOLUME = 0.45;

const SOUNDS = {
    SUCCESS: 'https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3', // Bubble/Pop
    ERROR: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3', // Error/Blip
    NOTIF: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3', // Soft chime
    CLICK: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', // Light tick
    SELECT: 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3', // Modern select
    TRANSITION: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3' // Whoosh/Slide
};

const audioCache = new Map();

export const AudioManager = {
    init() {
        if (typeof window === 'undefined') return;
        this.enabled = localStorage.getItem(AUDIO_ENABLED_KEY) !== '0';
        
        // Preload sounds
        Object.values(SOUNDS).forEach(url => {
            const audio = new Audio(url);
            audio.load();
            audioCache.set(url, audio);
        });
    },

    play(soundName, volume = DEFAULT_VOLUME) {
        if (!this.enabled) return;
        const url = SOUNDS[soundName];
        if (!url) return;

        try {
            let audio = audioCache.get(url);
            if (!audio) {
                audio = new Audio(url);
                audioCache.set(url, audio);
            } else {
                // If already playing, clone or reset
                if (!audio.paused) {
                    audio = audio.cloneNode();
                }
            }
            audio.volume = volume;
            audio.play().catch(() => {
                // Autoplay policy might block it until user interaction
            });
        } catch (e) {
            console.warn("[AudioManager] Play failed", e);
        }
    },

    toggle(state) {
        this.enabled = state;
        localStorage.setItem(AUDIO_ENABLED_KEY, state ? '1' : '0');
    },

    isEnabled() {
        return this.enabled;
    }
};

// Initialize on import if in browser
if (typeof window !== 'undefined') {
    AudioManager.init();
    
    // Add global click listener for tick sound
    document.addEventListener('click', (e) => {
        const target = e.target.closest('button, a, [role="button"], input[type="submit"]');
        if (target) {
            AudioManager.play('CLICK', 0.2);
        }
    }, { capture: true });
}
