# JafsPadelClub Mobile

Este directorio envuelve la web actual en una app nativa con Capacitor.

## Que es Capacitor

Capacitor es un contenedor nativo para apps web.
No reescribe tu proyecto: usa tu HTML, CSS y JS actuales dentro de una app Android/iOS y permite añadir permisos, plugins y compilacion nativa.

## Que conserva

- El mismo diseño visual
- La misma logica en `js/`
- Las mismas pantallas HTML
- La misma estructura de estilos e imagenes

## Flujo recomendado

1. Instalar Node.js 20 o superior.
2. Abrir terminal en `mobile-capacitor`.
3. Ejecutar `npm install`.
4. Ejecutar `npm run android:add`.
5. Ejecutar `npm run ios:add`.
6. Ejecutar `npm run cap:sync`.
7. Abrir con `npm run android:open` o `npm run ios:open`.

## Importante sobre APK e iOS

- El APK final se genera desde Android Studio.
- La app iOS final se compila desde Xcode en macOS.
- Este contenedor deja el proyecto preparado, pero el binario final requiere los SDKs nativos.

## Push y segundo plano

Capacitor ayuda con permisos y plugins del movil, pero para enviar push reales a usuarios sigue haciendo falta un backend seguro.
OneSignal SDK solo registra y recibe notificaciones; para enviar notificaciones reales necesitas una llamada servidor a la API de OneSignal.

## Estructura

- `capacitor.config.json`: configuracion de la app nativa
- `scripts/sync-web-assets.ps1`: copia la web actual a `www/`
- `www/`: salida generada con tu web lista para empaquetar

## Comandos utiles

- `npm run sync:web`
- `npm run cap:copy`
- `npm run cap:sync`
- `npm run android:open`
- `npm run ios:open`

## Publicar APK en GitHub

He dejado preparado un workflow en `.github/workflows/android-apk.yml` para construir una APK desde GitHub Actions.

Guia rapida:

1. Sube el proyecto a GitHub incluyendo `mobile-capacitor/android`.
2. Ejecuta la accion `Build Android APK` desde la pestaña `Actions`.
3. Descarga la APK desde el artefacto o desde una `Release`.

Mas detalles en `DEPLOY-APK.md`.
