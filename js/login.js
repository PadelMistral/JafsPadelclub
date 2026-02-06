/* js/login.js - Unified Auth & Spectacular Neutral Entrance */
import { login, loginWithGoogle } from './firebase-service.js';
import { showToast } from './ui-core.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const googleBtn = document.getElementById('googleLogin');
    const togglePass = document.getElementById('togglePassword');
    const passInp = document.getElementById('password');

    if (togglePass) {
        togglePass.onclick = () => {
            const isPass = passInp.type === 'password';
            passInp.type = isPass ? 'text' : 'password';
            togglePass.classList.toggle('fa-eye');
            togglePass.classList.toggle('fa-eye-slash');
        };
    }

    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('email').value.trim();
            const password = passInp.value;

            if (!identifier || !password) return;

            try {
                // Use central login helper (supports Username or Email)
                const userCred = await login(identifier, password);
                const userDoc = await getDocument('usuarios', userCred.user.uid);
                const userName = userDoc?.nombreUsuario || userDoc?.nombre || 'LEYENDA';
                startSpectacularLoading(userName);
            } catch (err) {
                console.error("Login fail:", err);
                let msg = "Acceso denegado. Revisa tus datos.";
                if (err.code === 'auth/user-not-found') msg = "El usuario no existe.";
                if (err.code === 'auth/wrong-password') msg = "Contraseña incorrecta.";
                showToast('Acceso Denegado', msg, 'error');
            }
        };
    }

    if (googleBtn) {
        googleBtn.onclick = async () => {
            try {
                const user = await loginWithGoogle();
                if (user) {
                    const userDoc = await getDocument('usuarios', user.uid);
                    const userName = userDoc?.nombreUsuario || userDoc?.nombre || 'LEYENDA';
                    startSpectacularLoading(userName);
                }
            } catch (err) {
                if (err.code !== 'auth/popup-closed-by-user') {
                    showToast('Falla en Google', 'No se pudo sincronizar.', 'error');
                }
            }
        };
    }
});

function startSpectacularLoading(userName) {
    const loader = document.getElementById('master-loader');
    const fill = document.getElementById('progress-fill');
    const status = document.getElementById('loader-status');
    const loginCard = document.getElementById('login-form-card');

    if (loginCard) loginCard.style.opacity = '0';
    loader.style.display = 'flex';

    let progress = 0;
    const messages = [
        "Iniciando protocolos...",
        "Sincronizando con la red...",
        "Cargando estadísticas...",
        "Preparando pista central...",
        `BIENVENIDO, ${userName.toUpperCase()}`
    ];

    const interval = setInterval(() => {
        progress += Math.floor(Math.random() * 8) + 1;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => {
                // Set flag to show welcome on home just once
                localStorage.setItem('first_login_welcome', userName);
                window.location.href = 'home.html';
            }, 800);
        }

        fill.style.width = `${progress}%`;
        
        const msgIdx = Math.min(Math.floor(progress / 20), messages.length - 1);
        status.textContent = messages[msgIdx];
    }, 45);
}
