# GitHub Pages + Cloudflare Push

Configuracion recomendada para este proyecto:

- Frontend y PWA en GitHub Pages
- Backend de envio push en Cloudflare Worker
- OneSignal como proveedor de notificaciones

## Por que asi

GitHub Pages sirve HTML, CSS y JS, pero no ejecuta backend.
Para enviar notificaciones push de forma segura necesitas un backend minimo que guarde la clave REST de OneSignal fuera del cliente.

## Estado del proyecto

Esta carpeta ya esta preparada para ese esquema:

- [js/app-config.js](C:/Users/Juana.DESKTOP-29R11RA/Desktop/Nueva%20carpeta/JafsPadelclub-main/js/app-config.js)
  - `APP_ALLOWED_ORIGIN = "https://padeluminatis.github.io"`
  - `APP_PUSH_API_URL = ""` pendiente hasta desplegar el Worker
- [cloudflare-worker/wrangler.toml](C:/Users/Juana.DESKTOP-29R11RA/Desktop/Nueva%20carpeta/JafsPadelclub-main/cloudflare-worker/wrangler.toml)
  - `APP_ORIGIN = "https://padeluminatis.github.io"`

## Que falta para dejar las push cerradas

1. Instalar Wrangler:
   `npm install -g wrangler`
2. Entrar en:
   `cd cloudflare-worker`
3. Hacer login:
   `wrangler login`
4. Anadir secretos:
   `wrangler secret put ONESIGNAL_APP_ID`
   `wrangler secret put ONESIGNAL_REST_API_KEY`
   `wrangler secret put FIREBASE_WEB_API_KEY`
5. Publicar:
   `wrangler deploy`
6. Copiar la URL devuelta del Worker y pegarla en:
   [js/app-config.js](C:/Users/Juana.DESKTOP-29R11RA/Desktop/Nueva%20carpeta/JafsPadelclub-main/js/app-config.js)

Ejemplo:

```js
export const APP_PUSH_API_URL = "https://jafs-padelclub-push.tu-subdominio.workers.dev/send-push";
```

## Resultado final esperado

- La PWA seguira funcionando desde GitHub Pages.
- La APK seguira usando el mismo frontend.
- Los envios push saldran desde Cloudflare Worker.
- OneSignal podra entregar avisos incluso con la app cerrada, siempre que el usuario:
  - haya aceptado permisos
  - tenga el dispositivo registrado en OneSignal
  - tenga conexion

## Importante

Sin publicar el Worker no hay envios push seguros desde GitHub Pages.
La recepcion y el registro del dispositivo si pueden funcionar, pero el envio necesita ese backend minimo.
