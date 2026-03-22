# Tests E2E

Base inicial de pruebas automáticas con Playwright para la PWA.

## Qué cubre esta primera fase

- Carga de páginas críticas.
- Disponibilidad de `manifest.json`.
- Disponibilidad de `sw.js`.
- Smoke test mínimo en escritorio y móvil.

## Qué falta para que estas pruebas tengan valor real de negocio

- Usuarios de prueba.
- Dataset o proyecto Firebase de staging.
- Flujos autenticados: crear partida, unirse, cerrar resultado, recalcular ELO, resetear.
- Comprobaciones visuales más estrictas.

## Comandos

```bash
npm install
npx playwright install
npm run test:e2e
```
