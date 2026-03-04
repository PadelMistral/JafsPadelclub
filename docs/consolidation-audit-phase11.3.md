# Consolidation Audit - Phase 11.3

## Scope Executed
- Audited HTML -> CSS/JS references.
- Audited active runtime modules for duplicated competitive calculations.
- Removed non-critical debug `console.log` noise in active modules.
- Centralized shared competitive metrics for Home/Profile/Ranking.

## Active App Surface (current)
Primary flow pages in active nav/runtime:
- `home.html`
- `calendario.html`
- `puntosRanking.html`
- `perfil.html`
- `notificaciones.html`
- `admin.html` (role based)

## Legacy / Broken Surface Detected
The following pages reference missing assets and should be treated as legacy until migrated:
- `chat.html` -> missing `css/chat.css`, `css/header.css`, `js/chat.js`, `js/menu-hamburguesa.js`, `js/enlaceAdmin.js`
- `clasificacion.html` -> missing `css/header.css`, `css/clasificacion.css`, `js/clasificacion.js`, `js/menu-hamburguesa.js`, `js/enlaceAdmin.js`, `js/particles-init.js`
- `ranking.html` (legacy) -> missing `css/header.css`, `js/menu-hamburguesa.js`, `js/enlaceAdmin.js`
- `perfil-usuario.html` (legacy) -> missing `js/perfil-usuario.js`, `js/particles-init.js`
- `logros.html` -> missing `css/logros.css`, `js/logros.js`

## Unification Applied
### 1) Shared competitive metrics module
Created:
- `js/core/competitive-metrics.js`

Centralized formulas:
- winrate
- ELO percentage normalization
- form percentage
- streak visual state
- aggregate snapshot for user competitive card

### 2) Runtime modules migrated
Updated:
- `js/home-core.js`
- `js/perfil.js`
- `js/ranking.js`

Impact:
- Removed duplicated winrate/percent logic.
- Home/Profile/Ranking now compute key values from one shared source.

### 3) Debug noise cleanup in active runtime
Updated:
- `js/services/notification-service.js`
- `js/login.js`
- `js/modules/ui-loader.js`
- `js/modules/theme-manager.js`
- `js/modules/galaxy-bg.js`
- `js/modules/notifications.js`
- `js/ai-orchestrator.js`
- `js/diario-logic.js`

Notes:
- Kept warnings/errors for operational visibility.
- Replaced key info traces with persistent app logger where useful.

### 4) Service worker cache coherence
Updated:
- `sw.js`

Changes:
- Bumped cache name to `padeluminatis-v7.6`.
- Added `./js/core/competitive-metrics.js` to app shell assets.

## Pending (recommended next safe iteration)
1. Migrate or remove legacy pages listed above.
2. Decide single notification facade (`js/services/notification-service.js`) and deprecate duplicate naming files.
3. Convert `home-logic.js` to explicit legacy/archived status if `home-core.js` is canonical.
4. Consolidate CSS layers by ownership:
   - Global tokens/base
   - Shared modules
   - Page core CSS only
5. Add a CI script that fails on missing asset references from HTML.
## Cleanup Executed (File Reduction)
- Removed broken legacy pages: `chat.html`, `clasificacion.html`, `ranking.html`, `perfil-usuario.html`, `logros.html`, `prueba-ranking.html`.
- Removed deprecated JS modules and duplicates: `js/home-logic.js`, `js/data-converter.js`, `js/diario.js`, `js/ai-tactician.js`, `js/dashboard-evolution.js`, `js/ai-coach.js`, `js/notifications-service.js`, `js/services/notifications.js`, `js/services/player-assistant.js`, `js/services/matchmaking.js`, `js/services/ai-service.js`, `js/services/ai-context-service.js`, `js/prueba-ranking.js`, `js/provisional-ranking-logic.js`.
- Removed unused CSS files: `css/home.css`, `css/core.css`, `css/ui.css`, `css/app-core.css`, `css/admin.css`, `css/calendario-premium.css`, `css/dynamic-elements.css`, `css/ranking-recommendations.css`, `css/mistral-ui.css`.
- Removed icon backup/assets folder: `icons/`.
- Reduced `imagenes/` to runtime-used assets only (`Logojafs.png`, `default-avatar.png`).
- Reduced `css-padel/` to only `css-padel/ux-enhance.css` (still used by `css/padel-fusion.css`).
- Updated service worker precache and version after cleanup.

## Architectural Consolidation (Core Engine)
- Added js/core/core-engine.js as unified motor facade (session, competitive, ELO/division, ranking metric, IA context, notifications, presence).
- Migrated js/home-core.js, js/perfil.js, js/ranking.js, js/calendario.js and js/ai-orchestrator.js to consume core-engine APIs.
- Rebuilt css/global.css as shared base and normalized HTML pages to global.css + page.css.
- Updated SW cache to include global.css and core-engine.js (cache v7.8).
