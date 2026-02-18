# Push WhatsApp-style Setup (FCM)

## 1) Requisitos en tu máquina
- Node.js 20+
- Firebase CLI

Comandos:

```powershell
npm i -g firebase-tools
firebase login
```

## 2) Clave Web Push (VAPID)
En Firebase Console -> Project Settings -> Cloud Messaging -> Web configuration -> **Generate key pair**.

Copia la clave pública y configúrala en el navegador de cada usuario (o en tu flujo de arranque):

```js
localStorage.setItem('fcm_vapid_public_key', 'TU_VAPID_PUBLIC_KEY');
location.reload();
```

## 3) Desplegar reglas + functions
Desde la raíz del proyecto:

```powershell
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions
```

## 4) Verificación rápida
1. Inicia sesión con un usuario (acepta permisos de notificación).
2. Revisa en Firestore: `usuarios/{uid}/devices/{deviceId}` debe tener `token`.
3. Crea una notificación en `notificaciones` para ese `destinatario`.
4. Debe llegar push aunque la app esté en segundo plano/cerrada.

## Notas
- El envío push se hace automáticamente desde `functions/index.js` en trigger de `notificaciones/{notifId}`.
- Tokens inválidos se desactivan automáticamente (`enabled:false`).

