# Tests del proyecto

Estos tests se dejan en el proyecto a proposito.

Sirven para validar la logica mas delicada de la app:

- sistema de puntuacion y reparto individual
- progreso de nivel y bandas
- invitados y nombres estables
- rachas desde historico
- desglose transparente de puntos
- monitor PWA y clasificacion de estados
- captura tecnica de errores

## Como ejecutarlos

Desde la raiz del proyecto:

```powershell
node --test tests\*.mjs
```

O si quieres lanzar la bateria que hemos ido usando:

```powershell
node --test tests\scoring-engine.test.mjs tests\streak-and-identity.test.mjs tests\match-utils.test.mjs tests\competitive-engine.test.mjs tests\elo-system.test.mjs tests\guest-player-service.test.mjs tests\scoring-breakdown.test.mjs tests\pwa-health-utils.test.mjs tests\error-monitor.test.mjs tests\identity-utils-more.test.mjs
```

## Se borran al final?

No es recomendable borrarlos.

Lo correcto es dejarlos en el repo para que cada cambio futuro no rompa:

- ranking
- invitados
- eventos
- rachas
- panel admin
- PWA

Estos archivos no afectan al funcionamiento normal de la PWA en produccion.
