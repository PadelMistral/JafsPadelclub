# Final Smoke Checklist

## 1. Acceso y sesion

- Abrir `index.html` y verificar login correcto.
- Verificar redireccion a `home.html` tras iniciar sesion.
- Cerrar sesion desde `perfil.html` y confirmar que vuelve a `index.html`.

## 2. Home

- Verificar que cargan tarjetas principales sin errores de consola.
- Verificar que los partidos muestran nombres reales de jugadores o parejas.
- Verificar que no aparecen `Equipo A`, `Equipo B` o `TBD` cuando ya hay jugadores reales.
- Verificar que abrir un partido desde Home muestra el modal por encima del resto.

## 3. Calendario

- Verificar que los ultimos 5 resultados recientes aparecen.
- Crear un partido nuevo.
- Entrar con otro usuario y comprobar que el partido aparece si debe ser visible.
- Confirmar que un partido privado solo lo ven invitados, organizador o participantes.
- Probar el sorteo de equipos y confirmar que el modal de preferencias aparece antes del reparto.
- Confirmar que, tras sortear, la alineacion queda limpia y compacta.

## 4. Resultado y ranking

- Anotar resultado en un partido amistoso.
- Verificar que el partido pasa a jugado.
- Verificar que `historial.html` lo muestra.
- Verificar que `mi-elo.html` refleja el cambio.
- Verificar que `ranking.html` muestra el resultado y el modal de desglose por encima de otros modales.

## 5. Eventos

- Crear evento.
- Inscribirse.
- Aprobar usuario desde admin o desde evento si procede.
- Generar grupos o fase.
- Crear o abrir partido de evento.
- Anotar resultado.
- Confirmar que el evento, el partido vinculado, el historial y el ranking quedan sincronizados.

## 6. Admin

- Crear partido manual.
- Editar partido.
- Anotar resultado.
- Resetear partido como no jugado.
- Recalcular ELO de un partido.
- Recuperar ELO desde logs.
- Reconstruir partidos desde logs.
- Verificar que las acciones piden confirmacion con modal propio.

## 7. Notificaciones

- Abrir `notificaciones.html`.
- Verificar que el estado del permiso y del canal aparece claro.
- Probar `Activar`, `Probar`, `Reconectar`, `Reparar`, `Limpiar` y `Recargar`.
- Borrar una notificacion individual.
- Vaciar bandeja completa.
- Confirmar que no aparecen prompts nativos del navegador salvo el permiso real de notificaciones.

## 8. PWA

- Verificar que el boton instalar app aparece cuando corresponde.
- Instalar la app.
- Verificar que el boton desaparece si ya esta instalada.
- Abrir en modo app instalada.
- Probar recarga offline en:
  - `home.html`
  - `calendario.html`
  - `historial.html`
  - `mi-elo.html`
  - `palas.html`

## 9. Consola

- Recorrer `home`, `calendario`, `ranking`, `historial`, `mi-elo`, `eventos`, `evento-detalle`, `perfil`, `notificaciones`, `admin`.
- Confirmar que no hay:
  - `Uncaught SyntaxError`
  - `ReferenceError`
  - errores de imports
  - errores por `resultado.sets` o helpers no definidos

## 10. Cierre

- Confirmar que la experiencia es consistente en escritorio y movil.
- Confirmar que todos los modales abren delante, cierran bien y no quedan detras.
- Confirmar que los toast salen con copy legible y no muestran texto roto.
