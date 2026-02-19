# Push WhatsApp-style Setup (OneSignal)

## 1) Requisitos en tu máquina
- Node.js 20+
- Firebase CLI
- Cuenta OneSignal (Web Push App creada)

Comandos:

```powershell
npm i -g firebase-tools
firebase login
```

## 2) Configurar OneSignal en cliente
Necesitas el **OneSignal App ID** (UUID, público).

Opciones de configuración:

1. Fija el valor en `js/firebase-init.js`:

```js
const ONESIGNAL_APP_ID = "TU_ONESIGNAL_APP_ID";
```

2. O en caliente desde consola del navegador (por usuario/dispositivo):

```js
localStorage.setItem('onesignal_app_id', 'TU_ONESIGNAL_APP_ID');
location.reload();
```

## 3) Configurar claves en Functions (servidor)
Necesitas:
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY` (privada, solo backend)
- Opcional: `APP_BASE_URL` (ej: `https://padeluminatis.web.app`)

En Windows PowerShell:

```powershell
$env:ONESIGNAL_APP_ID="TU_ONESIGNAL_APP_ID"
$env:ONESIGNAL_REST_API_KEY="TU_ONESIGNAL_REST_API_KEY"
$env:APP_BASE_URL="https://padeluminatis.web.app"
```

## 4) Desplegar reglas + functions
Desde la raíz del proyecto:

```powershell
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions
```

## 5) Verificación rápida
1. Inicia sesión con un usuario y acepta permisos.
2. Revisa Firestore: `usuarios/{uid}/devices/{deviceId}` debe tener:
- `provider: "onesignal"`
- `oneSignalPlayerId`
- `enabled: true`
3. Crea una notificación en `notificaciones` para ese `destinatario`.
4. Debe llegar push en segundo plano/cerrada.

## Notas
- El envío push se hace desde `functions/index.js` al crear `notificaciones/{notifId}`.
- OneSignal SDK usa workers dedicados: `OneSignalSDKWorker.js` y `OneSignalSDKUpdaterWorker.js`.
- La clave privada OneSignal (`REST API key`) nunca va al frontend.
