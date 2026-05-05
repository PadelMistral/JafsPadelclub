# Notificaciones en GitHub Pages

## Resumen real de la arquitectura

`GitHub Pages` no puede guardar secretos ni ejecutar backend. Por eso:

1. La `PWA` registra el `service worker` y suscribe el navegador con `OneSignal`.
2. La app guarda el usuario autenticado y su suscripción.
3. Cuando la app quiere mandar un aviso en segundo plano, llama a un `Cloudflare Worker`.
4. El `Worker` usa la `REST API Key` de `OneSignal` como secreto de servidor.
5. `OneSignal` entrega la notificación al navegador del móvil aunque la app no esté abierta.

## Lo que tiene que pasar para que funcione

### Android

- Navegador compatible (`Chrome` o `Edge`).
- Permiso de notificaciones concedido.
- `service worker` activo.
- Usuario suscrito en `OneSignal`.
- `Cloudflare Worker` operativo y con acceso correcto a `OneSignal`.

### iPhone / iPad

- `iOS/iPadOS 16.4+`.
- Abrir la web con `Safari`.
- Añadir la app a pantalla de inicio.
- Abrir la app desde ese icono instalado.
- Permitir notificaciones.

## Variables del Worker

En `Cloudflare Workers` configura:

- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`
- `ALLOWED_ORIGIN`
- `APP_PUSH_BEARER_TOKEN`

Valores típicos:

- `ALLOWED_ORIGIN=https://padelmistral.github.io`
- `APP_PUSH_BEARER_TOKEN=un_token_largo_privado`

## Worker recomendado

Usa como base:

- [cloudflare-worker/src/index.js](/C:/Users/juana/Downloads/Apk%20JafsPadeluminatis-20260414T194357Z-3-001/Apk%20JafsPadeluminatis/cloudflare-worker/src/index.js)

## Configuración de la app

La app ya soporta:

- varios endpoints candidatos de push;
- token bearer configurable;
- diagnóstico si falla el bridge remoto.

Puedes configurar el token en runtime:

```js
localStorage.setItem("push_api_bearer_token", "TU_TOKEN");
```

Y opcionalmente el endpoint:

```js
localStorage.setItem("push_api_url", "https://tu-worker.tu-subdominio.workers.dev/send-push");
```

## Checklist de prueba real

1. Abre la app en el móvil.
2. Activa notificaciones.
3. Verifica en el panel que el estado sea correcto.
4. Usa el botón `PROBAR AVISO EN ESTE MOVIL`.
5. Bloquea el móvil o sal de la app.
6. Confirma que llega el push visible.

## Qué necesito de ti si quieres que lo deje totalmente operativo

- La URL final de tu `Cloudflare Worker`.
- Saber si ese worker va a exigir `bearer token`.
- El valor de `ALLOWED_ORIGIN` real si no es `https://padelmistral.github.io`.
- Confirmar si tu `OneSignal App ID` actual es el correcto del proyecto.

No necesito que me pases la `REST API Key` aquí en el chat. Esa debe quedarse solo en `Cloudflare`.
