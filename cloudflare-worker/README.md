# Cloudflare Worker Push Bridge

Este worker permite enviar push a OneSignal sin exponer la REST API key en el cliente.

## Que resuelve

- Funciona con plan gratuito de Firebase Spark.
- No necesitas Firebase Functions para los envios iniciados desde la app.
- El cliente manda la orden al worker autenticado con el ID token de Firebase.
- El worker reenvia a OneSignal usando `external_id`.

## Antes de desplegar

Necesitas:

- cuenta de Cloudflare
- cuenta de OneSignal
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`
- `FIREBASE_WEB_API_KEY`
- el dominio final de tu PWA en `APP_ORIGIN`

## Despliegue rapido

1. Instala Wrangler:
   `npm install -g wrangler`
2. Entra en la carpeta:
   `cd cloudflare-worker`
3. Login:
   `wrangler login`
4. Configura secretos:
   `wrangler secret put ONESIGNAL_APP_ID`
   `wrangler secret put ONESIGNAL_REST_API_KEY`
   `wrangler secret put FIREBASE_WEB_API_KEY`
5. Edita `wrangler.toml` y pon `APP_ORIGIN` con tu dominio real.
6. Publica:
   `wrangler deploy`

Obtendras una URL tipo:
`https://jafs-padelclub-push.<subdominio>.workers.dev/send-push`

## Configuracion del cliente

Edita [js/app-config.js](C:/Users/Juana.DESKTOP-29R11RA/Desktop/JafsPadelclub-main/js/app-config.js) y pon:

```js
export const APP_PUSH_API_URL = "https://tu-worker.workers.dev/send-push";
export const APP_ALLOWED_ORIGIN = "https://tu-dominio-real";
```

## Nota importante

Esto cubre bien los envios que nacen desde la propia app cliente.
No sustituye un backend completo para automatizaciones puras del servidor.
