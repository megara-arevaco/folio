# Revisión de implementación: mejoras no comerciales

Referencia: informe de 10 de octubre de 2026. Estado de este bloque: implementación y pruebas locales aisladas posteriores. Alcance: mejoras no comerciales de `../../REVISION-folio.md`; se mantienen fuera de alcance monetización, despliegue, bibliotecas reales y proveedores/dispositivos reales.

## Estado de las propuestas

| Propuesta | Estado | Implementación y límites |
|---|---|---|
| Revisión previa y límites IA | **Implementada, no financiera** | El preflight muestra proveedor, modo real/Mock/local, modelo, archivo/tamaño, límite heurístico de lote, límites del PDF y uso/límites configurados. Antes de cada solicitud remota se reserva persistentemente una llamada, bytes UTF-8 de entrada con margen como aproximación (no tokenizador) y el máximo de salida. Hay límites separados para despliegue, trabajo, total de muestras y muestra individual; incluyen glosario, revisión, PDF y reintentos. Las reservas fallidas no se devuelven y se preservan a través de reinicios/restauraciones. Al agotar un límite Folio falla antes de enviar esa solicitud. Esto limita las peticiones que pasan por Folio, no consumo externo, gasto del proveedor, cuotas, precios ni llamadas fuera del sistema. |
| Muestra del resultado | **Parcial, con límites explícitos** | EPUB: compara texto original con una muestra del primer capítulo antes de crear un trabajo. PDF local: hasta tres páginas con texto seleccionable; informa marcadores y si ve texto/estructura que parezca índice entre esas páginas, y avisa de posible escaneo; no aplica OCR. PDF remoto: muestra limitada a tres páginas y usa las reservas IA. Las muestras no reemplazan el original. La detección de índice es heurística y solo cubre páginas muestreadas; no valida la maquetación completa, calidad OCR real ni fidelidad editorial. Ninguna muestra certifica que el libro completo esté listo para leer. |
| Continuidad entre etapas | **Implementada para resultados** | Los resultados de traducción y PDF ofrecen la edición de metadatos y sus funciones compartidas: descarga del original, historial/restauración de versiones, añadir a lecturas y opción de dispositivo cuando hay uno disponible. La vista indica cuando no hay destino conectado. La integración con transferencia se ejercitó solo con lista de dispositivos vacía; no prueba envío a un lector físico. |
| Recuperación, originales y backup global | **Implementada, restauración probada en almacenamiento aislado** | El original, resultado, registro, checkpoints, glosario, revisiones, libros y lecturas se incluyen en una copia ZIP versionada; la base SQLite se copia con su API de backup. `scripts/folio-data.mjs` ofrece `backup`, `verify`, `restore` y recuperación `recover` fuera de línea. Verificación comprueba manifiesto, hashes, SQLite, rutas, enlaces, tamaños/compresión y coherencia de trabajos sin escribir en datos. Restaurar exige frase exacta, crea copia previa recuperable, valida/stagea antes de sustituir, usa diario de rollback, pausa trabajos activos y reubica rutas al nuevo directorio. El ledger IA se fusiona monotónicamente. `.env`, ajustes y claves quedan fuera. El CLI rechaza operar mientras la API mantiene el bloqueo. Se probó con datos ficticios, borrado y restauración a otra raíz temporal; no con datos reales ni volúmenes Docker. |
| Glosario editable | **Implementada** | Se edita el glosario del propio trabajo, reutilizando las entradas que consume el motor existente. No se crea un segundo motor ni un glosario global. |
| Diagnóstico de dispositivos | **Implementado, hardware no validado** | La vista muestra configuración/estado/respuesta del puente, cantidad detectada y orientación para resolver fallos. Un stub HTTP local permite probar disponible → desconectado → disponible. No inspecciona dispositivos conectados al navegador ni acredita una transferencia física. |
| Borrado masivo | **Confirmación explícita** | El archivo normal de resultados sigue siendo no destructivo. La ruta API heredada de borrado masivo responde 409 sin la frase exacta `DELETE COMPLETED JOBS`; solo una confirmación explícita la autoriza. La eliminación individual sigue siendo permanente. |

## Estado de las mejoras de experiencia

- **Identidad editorial:** conservada; no se reemplazaron paleta, tipografía ni dirección visual existentes.
- **Menos espacio operativo:** al seleccionar un archivo, el selector se compacta para dejar más espacio a la muestra y la cola.
- **Acciones explícitas:** botón de metadatos en resultados EPUB y PDF, descarga original/resultado, historial de versiones, añadir a lecturas y opciones de dispositivo desde el editor.
- **Progreso por fases:** se etiqueta la fase a partir del mensaje/progreso existente y se muestra la hora del último avance persistido. No se inventa una ETA.
- **Errores recuperables:** se expone el error del trabajo; saldo insuficiente y rechazo de clave tienen orientación diferenciada y los demás errores indican conservar el original y reanudar tras corregir la causa. Invalidación de archivos y desconexiones mantienen sus mensajes propios en sus flujos. La guía genérica no sustituye un diagnóstico técnico específico para cada proveedor.
- **Limpieza no destructiva:** «Archivar resultados listos» conserva libros, originales y versiones. La eliminación individual es permanente; `DELETE /api/jobs/completed` exige confirmación exacta y se prueba que no borra nada sin ella.
- **Alternativa al arrastre:** se conservan controles explícitos para subir/bajar trabajos en la cola, además del arrastre.
- **Diseño adaptable:** comprobación visual local en escritorio y móvil; a 390 px no hubo desbordamiento horizontal. El estado deshabilitado de botones conserva contraste legible.

## Cambios previos preservados

Antes de editar se revisaron el estado y el diff del repositorio y se guardó una referencia temporal de comparación en `/tmp/project-improvements-baseline/folio.diff` y `.status`. Los siguientes cambios ya existían en esa referencia y no se atribuyen a este bloque:

- Cambios previos en `DESIGN.md`, `README.md`, `apps/api/src/services/llm.ts` y la configuración OpenRouter de `apps/api/src/services/pdfOpenRouter.ts`.
- Integración previa de Ajustes/OpenRouter en `apps/api/src/routes/settings.ts`, `apps/api/src/services/openRouterSettings.ts`, `apps/web/src/components/SettingsPage.tsx`, `apps/web/src/services/settings.ts` y `tests/e2e/settings.spec.ts` (estaban sin seguimiento en el estado base).
- Cambios previos en `apps/api/src/server.ts`, `apps/web/src/App.tsx`, `apps/web/src/locales/resources.ts`, `apps/web/src/styles.css` y `tests/e2e/i18n.spec.ts`.

Se conservaron las modificaciones anteriores en los archivos compartidos. En la primera tanda no se modificaron `llm.ts`, `README.md`, `DESIGN.md` ni la integración de Ajustes. La segunda tanda amplió `llm.ts` con reservas IA, `README.md` con documentación y Ajustes con información de backup/límites, sin sustituir la configuración OpenRouter previa. No se revirtió ni se reaplicó el diff previo.

## Archivos del alcance no comercial

**Nuevos:**

- Backup/restauración: `scripts/folio-data.mjs`, `apps/api/src/services/maintenanceLock.ts`, `packages/data-safety/src/instanceLock.mjs`, `packages/data-safety/src/instanceLock.d.mts`, `docs/data-backup.md`.
- Límites IA persistentes: `apps/api/src/services/aiBudget.ts`, `docs/ai-usage-limits.md`.
- Límites IA y muestras: `apps/api/src/services/aiBudget.ts`, `apps/api/src/routes/previews.ts`, `apps/api/src/services/previews.ts`, `apps/web/src/components/ProcessingPreflightPanel.tsx`.
- Flujo existente: `apps/web/src/components/GlossaryEditor.tsx`, `tests/e2e/backup-budget.spec.ts`, `tests/e2e/improvements.spec.ts`, `tests/e2e/settings.spec.ts` (la integración OpenRouter/Settings ya existía; se amplió la vista/prueba).

**Cambios funcionales añadidos a archivos ya existentes:**

- API: `apps/api/src/routes/devices.ts`, `apps/api/src/routes/jobs.ts`, `apps/api/src/server.ts`, `apps/api/src/services/epub.ts`, `apps/api/src/services/jobs.ts`, `apps/api/src/services/jobs/queue.ts`, `apps/api/src/services/jobs/records.ts`, `apps/api/src/services/jobs/runner.ts`, `apps/api/src/services/llm.ts`, `apps/api/src/services/pdf.ts`, `apps/api/src/services/pdfOpenRouter.ts`, `apps/api/src/types.ts`.
- Web: `apps/web/src/App.tsx`, `apps/web/src/components/DevicePage.tsx`, `apps/web/src/components/FilePicker/FilePicker.component.tsx`, `apps/web/src/components/MetadataEditorPage.tsx`, `apps/web/src/components/SettingsPage.tsx`, `apps/web/src/components/TranslationsPage.tsx`, `apps/web/src/locales/resources.ts`, `apps/web/src/services/devices.ts`, `apps/web/src/services/translation.ts`, `apps/web/src/styles.css`.
- Contratos/documentación/pruebas: `packages/contracts/src/jobs.ts`, `README.md`, `docs/implementation-review.md`, `tests/e2e/fixtures.ts`, `tests/e2e/improvements.spec.ts`, `tests/e2e/settings.spec.ts`.

La configuración OpenRouter, sus rutas/servicios y la base visual/i18n de Settings que ya existían antes se preservaron; los cambios nuevos de Settings se limitaron a backup/límites IA y sus textos de interfaz. Los artefactos compilados y salidas de Playwright se generaron en rutas ignoradas/temporales; no se añadieron como fuentes. No hubo cambios de despliegue, volúmenes, credenciales reales o bibliotecas personales.

## Validación y alcance de las pruebas

Las pruebas E2E usan libros ficticios, servidores API temporales y directorios `folio-e2e-*` aislados. El proveedor de prueba es un servidor HTTP **solo en localhost**, con clave ficticia; devuelve transcripciones deterministas y un 503 para medir/rechazar el reintento sin una llamada adicional. No contacta OpenRouter ni otro proveedor externo. La suite cubre restore tras reinicio y en otra raíz, confirmación, SQLite, archivos excluidos, path traversal, enlaces, compresión, ZIP malformado, rollback con diario interrumpido, límites de muestras/despliegue/trabajo, reintentos LLM, lotes PDF y persistencia de reservas tras reiniciar. También cubre EPUB desde PDF hasta editor/lecturas, modo Mock, muestra PDF local, diagnóstico/reconexión de puente stub, glosario y trabajos.

Mock y respuestas deterministas no validan calidad de traducción/OCR. No se probó proveedor real, calidad editorial, coste, OCR real, dispositivo físico ni transferencia de libros a hardware.

Comandos finales ejecutados y resultado exacto:

- `node --check scripts/folio-data.mjs` — código de salida 0.
- `node_modules/.bin/tsc --noEmit` — código de salida 0, sin diagnósticos.
- `node scripts/check-architecture.mjs` — código de salida 0; `Dependencias de API, web y contratos verificadas.`
- `node scripts/build-api.mjs` — código de salida 0.
- `node_modules/.bin/vite build apps/web` — código de salida 0; 137 módulos transformados, build completado.
- `node_modules/.bin/playwright test` — **25 aprobadas, 0 fallidas** después del endurecimiento final; coordinación repitió la suite completa y confirmó 25 aprobadas (1,4 min).
- `git diff --check` — código de salida 0, sin errores de whitespace.

`pnpm` no está instalado en este entorno; se usaron binarios/scripts locales. No se ejecutaron despliegues ni operaciones sobre producción/volúmenes Docker.

## Endurecimiento final de restauración y concurrencia

- API y CLI comparten el mismo bloqueo exclusivo y validan PID positivo, rol y token. Un lock abandonado solo se reclama con `recover` explícito; un guard serializa la reclamación para no eliminar el bloqueo de otro proceso.
- La API rechaza arrancar si existe un diario de restauración, antes de recuperar trabajos o activar workers. Una transacción confirmada nunca se revierte por un fallo de limpieza; `recover` completa esa limpieza de manera idempotente. Los comandos ordinarios no recuperan diarios silenciosamente.
- Se rechazan identificadores reservados y mapas inseguros del ledger IA. Las reservas siguen fusionándose monotónicamente durante la restauración.
- Los E2E adicionales cubren fallos de limpieza después del commit, diarios `applying`/`committed`, rechazo de arranque, recuperación explícita, starters concurrentes y registros IA inseguros. Son fallos de filesystem inyectados en datos temporales, no pruebas de pérdida eléctrica.
- Si queda `.folio-instance.guard` tras un cierre forzado, no se autoreclama: requiere confirmar que no hay procesos Folio y revisión manual antes de retirarlo, conforme a `docs/data-backup.md`.

## Riesgos y decisiones pendientes

1. Los límites IA son topes internos de solicitudes, máximo de salida pedido y aproximación de entrada basada en bytes; no garantizan tokens/coste final, cuotas del proveedor ni consumo externo. Una muestra remota también puede consumir cuota; la interfaz lo declara.
2. La muestra EPUB es textual y pequeña; el PDF local no aplica OCR. El flujo PDF remoto solo se ejercitó contra stub local: sin evaluación de proveedor/modelo real o precisión de transcripción.
3. Versiones, originales y copias ocupan disco. Backups deben custodiarse fuera del volumen/instalación; Settings y secretos se excluyen intencionadamente y requieren conservación separada. El borrado individual sigue siendo permanente.
4. El servidor no tiene autenticación, como ya documenta el producto. No se añadió una superficie pública ni se desplegó nada.
5. El formato de backup actual es v1; restores se ejecutan offline y solo admiten las ubicaciones canónicas documentadas. Un ZIP dañado, diario corrupto, entorno de rutas distinto o falta de espacio requiere parar y conservar datos para revisión.
6. Monetización, cuentas/SaaS, DRM, despliegue, validación con biblioteca personal, calidad real y transferencia física quedan **fuera de alcance/no validados**.
