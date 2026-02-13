import { login, loginWithGoogle, getDocument, observerAuth, auth } from './firebase-service.js';
import { showToast } from './ui-core.js';

document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in
    observerAuth((user) => {
        if (user) {
            window.location.href = 'home.html';
        }
    });

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
            const submitBtn = loginForm.querySelector('button[type="submit"]');

            if (!identifier || !password) return;

            // Feedback: Disable button and show loading
            const originalBtnContent = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>ACCEDIENDO...</span><i class="fas fa-spinner fa-spin text-xs opacity-50"></i>`;

            try {
                // Use central login helper (supports Username or Email)
                const userCred = await login(identifier, password);
                const userDoc = await getDocument('usuarios', userCred.user.uid);
                
                // AUDIT: Check Approval Status
                const isApproved = userDoc?.status === 'approved' || userDoc?.aprobado === true; 
                if (!isApproved && userDoc?.rol !== 'Admin') {
                    await auth.signOut();
                    showToast('Acceso Restringido', 'Tu cuenta está pendiente de aprobación.', 'warning');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnContent;
                    return;
                }

                const userName = userDoc?.nombreUsuario || userDoc?.nombre || 'LEYENDA';
                startSpectacularLoading(userName);
            } catch (err) {
                console.error("Login fail:", err);
                let msg = getFriendlyErrorMessage(err.code);
                
                showToast('Acceso Denegado', msg, 'error');
                
                // Restore button
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnContent;
            }
        };
    }

    if (googleBtn) {
        googleBtn.onclick = async () => {
            try {
                const user = await loginWithGoogle();
                if (user) {
                    const userDoc = await getDocument('usuarios', user.uid);
                    
                    // AUDIT: Check Approval Status
                    const isApproved = userDoc?.status === 'approved' || userDoc?.aprobado === true;
                    if (!isApproved && userDoc?.rol !== 'Admin') {
                        await auth.signOut();
                        showToast('Acceso Restringido', 'Tu cuenta está pendiente de aprobación.', 'warning');
                        return;
                    }

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

/**
 * Maps Firebase Auth error codes to human-friendly Spanish messages.
 */
function getFriendlyErrorMessage(code) {
    console.log("Firebase Error Code:", code);
    switch (code) {
        case 'auth/user-not-found': 
        case 'auth/invalid-email':
        case 'auth/wrong-password': 
        case 'auth/invalid-credential': 
            return 'Usuario o contraseña incorrectos.';
        case 'auth/too-many-requests': 
            return 'Cuenta temporalmente bloqueada. Prueba en unos minutos.';
        case 'auth/network-request-failed':
            return 'Sin conexión. Revisa tu internet.';
        default: 
            return 'Error de acceso: Revisa tus credenciales.';
    }
}


