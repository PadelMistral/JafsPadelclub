# Release Checklist PWA

## Estado base
- `node scripts/production-audit.mjs`
- `node --check js/home-core.js`
- `node --check js/match-service.js`
- `node --check js/notificaciones.js`
- `node --check js/evento-detalle.js`
- `node --check js/eventos.js`

## Flujo funcional
- Login correcto con usuario normal
- Carga de `home.html` sin errores visibles
- Crear partida sin duplicados ni conflicto horario
- Unirse a partida y salir de partida
- Cerrar resultado y revisar ELO
- Resetear partido desde admin
- Compartir cartel de partido finalizado

## PWA
- `manifest.json` carga bien
- `sw.js` responde
- Boton `Instalar App` visible si no esta instalada
- Boton oculto si ya esta instalada
- `offline.html` abre al cortar conexion
- Banner de actualizacion y recarga tras nueva version

## Notificaciones
- Permiso visible y entendible para usuario normal
- OneSignal inicializa sin error
- Service worker registrado
- Prueba local de notificacion
- Flujo de reparacion de avisos accesible

## Responsive
- Home sin desbordes en 360px
- Calendario usable en movil
- Ranking modal por encima del detalle
- Modales compactos y centrados
- Botones flotantes visibles y no tapados

## Antes de publicar
- Limpiar cache antigua del navegador
- Probar despliegue real en GitHub Pages
- Probar un movil Android real
- Probar un iPhone real si se va a usar modo instalable en iOS
