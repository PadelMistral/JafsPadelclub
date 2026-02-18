/* js/modules/ai-chat.js - Advanced AI Bot */
import { showToast } from '../ui-core.js';

let isOpen = false;

export function initAIChat() {
    if (document.getElementById('ai-chat-interface')) return;

    const chatHTML = `
        <div id="ai-chat-interface" class="chat-sheet">
            <div class="chat-header">
                <div class="flex-row">
                    <i class="fas fa-robot spin-slow"></i>
                    <span>COACH IA</span>
                </div>
                <i class="fas fa-times cursor-pointer opacity-50 hover:opacity-100" id="close-chat"></i>
            </div>
            <div class="chat-body" id="chat-msgs">
                <div class="msg bot">Hola, soy tu Analista Táctico v2.0. ¿Analizamos tu último partido o quieres un consejo?</div>
            </div>
            <div class="chat-input-area">
                <input type="text" id="chat-in" class="chat-input" placeholder="Pregúntame algo...">
                <button class="btn-icon-circle bg-sport-blue text-white" id="send-chat" style="width:35px;height:35px">
                    <i class="fas fa-paper-plane text-xs"></i>
                </button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', chatHTML);

    // Event Listeners
    document.getElementById('close-chat').onclick = toggleChat;
    
    const sendBtn = document.getElementById('send-chat');
    const input = document.getElementById('chat-in');
    
    const send = async () => {
        const txt = input.value.trim();
        if (!txt) return;
        
        addMsg(txt, 'user');
        input.value = '';
        
        // Simulado AI Response
        addMsg("Analizando...", 'bot temporary');
        await new Promise(r => setTimeout(r, 1500));
        document.querySelector('.temporary')?.remove();
        
        const response = generateAIResponse(txt);
        addMsg(response, 'bot');
    };

    sendBtn.onclick = send;
    input.onkeypress = (e) => { if(e.key === 'Enter') send(); };
}

export function toggleChat() {
    const sheet = document.getElementById('ai-chat-interface');
    isOpen = !isOpen;
    if (isOpen) sheet.classList.add('active');
    else sheet.classList.remove('active');
}

function addMsg(text, type) {
    const box = document.getElementById('chat-msgs');
    const d = document.createElement('div');
    d.className = `msg ${type} animate-up`;
    d.textContent = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
}

function generateAIResponse(input) {
    const lower = input.toLowerCase();
    if (lower.includes('globo') || lower.includes('defensa')) return "El globo es tu mejor arma defensiva. Trata de tirarlo al rincón del revés del rival.";
    if (lower.includes('volea')) return "En la volea, busca profundidad, no potencia. Mantén la raqueta arriba.";
    if (lower.includes('saque') || lower.includes('servicio')) return "Saca al cristal lateral para obligar al rival a girar.";
    if (lower.includes('ganar')) return "Para ganar, necesitas paciencia. El pádel es un juego de errores, no de aciertos.";
    return "Interesante. ¿Puedes darme más detalles sobre esa situación de juego?";
}



