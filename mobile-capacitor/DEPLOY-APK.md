# APK desde GitHub

## Lo que ya queda preparado

- Un flujo de GitHub Actions en `.github/workflows/android-apk.yml`
- Compilacion automatica de APK `debug`
- Subida del APK como artefacto
- Si publicas una `Release`, GitHub adjunta tambien el APK a esa release

## Como usarlo

1. Sube este proyecto a un repositorio de GitHub.
2. Haz commit tambien de `mobile-capacitor/android`.
3. En GitHub, entra en `Actions` y ejecuta `Build Android APK`.
4. Descarga el APK desde el artefacto generado.

Tambien puedes crear una release:

1. Crea un tag, por ejemplo `v1.0.0`.
2. Publica una `Release` en GitHub.
3. El workflow adjuntara `app-debug.apk` a esa release.
4. Desde el movil podras abrir la release y descargar el APK.

## Enlace directo

Si publicas una release, el APK quedara accesible desde una URL del estilo:

`https://github.com/TU-USUARIO/TU-REPO/releases/download/v1.0.0/app-debug.apk`

GitHub tambien ofrece un boton de descarga en la pagina de la release.

## Limitaciones reales

- Android no permite instalar una APK de forma silenciosa desde un enlace web normal.
- El movil puede descargarla directamente, pero el usuario tendra que confirmar la instalacion.
- La primera vez, Android puede pedir permiso para instalar apps desde el navegador.
- Para distribuir en serio a terceros, lo ideal es una APK `release` firmada o un `AAB` para Google Play.

## Estado actual de esta app

- La APK descargable desde GitHub si es viable con este workflow.
- Las push nativas reales todavia no estan terminadas.
- En Android falta `mobile-capacitor/android/app/google-services.json`.
- El codigo actual usa bastante logica de notificaciones web y OneSignal web.

## Para tener funciones nativas de verdad

### Push reales

Hace falta terminar la integracion nativa con FCM o OneSignal nativo y guardar el token/dispositivo del usuario.

### GPS

Hace falta integrar un plugin nativo de geolocalizacion, pedir permiso al usuario y guardar la ubicacion en backend para que el admin pueda verla.

### Camara

Hace falta integrar `@capacitor/camera` y pedir permisos nativos.

### Telefono y SMS

- Llamadas: se puede abrir el marcador o llamar con permiso.
- SMS: Android no deja enviar SMS silenciosos como una web normal; normalmente se abre la app de SMS para confirmar.
- Leer SMS o gestionarlos automaticamente tiene restricciones fuertes y no suele aprobarse facilmente.

## Recomendacion

Primero deja resuelta la distribucion por GitHub APK.
Despues hacemos una segunda fase para:

1. push nativas reales,
2. GPS con visibilidad para admin,
3. camara,
4. telefono y SMS con el enfoque permitido por Android.
