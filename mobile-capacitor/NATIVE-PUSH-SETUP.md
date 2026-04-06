# Push nativa Android

La app ya queda preparada para registrar dispositivos Android nativos con Capacitor Push Notifications y guardar el token en:

- `usuarios/{uid}/devices/{deviceId}`

Campos principales:

- `provider: "fcm"`
- `token`
- `platform: "android-native"`
- `enabled: true`

## Lo que falta para que lleguen push reales

1. Anadir `google-services.json` en `mobile-capacitor/android/app/google-services.json`
2. Tener Firebase Cloud Messaging activo en tu proyecto Firebase
3. Crear un backend seguro que envie a FCM usando credenciales de servidor

## Endpoint de envio recomendado

La app cliente ya admite configurar una URL remota de push en:

- `window.__PUSH_API_URL`
- o `localStorage["push_api_url"]`

Ejemplo esperado:

- `https://europe-west1-TU-PROYECTO.cloudfunctions.net/sendPush`

Asi la APK no depende de `window.location.origin/api/send-push`.

## Nota importante

Ahora mismo el proyecto ya puede:

- pedir permiso nativo en Android,
- registrar el dispositivo,
- guardar el token del dispositivo en Firestore,
- mostrar ese estado en la app.

Lo que todavia no hace por si solo es el envio servidor a FCM. Eso requiere credenciales privadas y no debe hacerse desde el cliente.
