> Nota: la validación se ha migrado a E2E de Electron en `tests/e2e`. Las referencias a tests unitarios de este plan describen la implementación anterior. Consulta `README.md` para los comandos actuales.

# Plan de refactorización de arquitectura

Aplicar a EPUB Translator los patrones observados en Nemeton: responsabilidades separadas, contratos compartidos, validación de entradas, persistencia recuperable y límites de recursos. La referencia de las reglas y dependencias está en [architecture.md](architecture.md).

El trabajo se organiza en cambios pequeños y verificables. Cada fase debe conservar las rutas HTTP, los archivos persistidos y los flujos de traducción, conversión y edición existentes, salvo correcciones descritas y probadas expresamente.

## Estado de partida

- [x] Compartir contratos de trabajos, metadatos, dispositivos y registro de lectura en `packages/contracts/src`.
- [x] Centralizar URL base, lectura del sobre HTTP y mensajes de error en `apps/web/src/services/http.ts`.
- [x] Unificar validación y normalización de metadatos EPUB y PDF.
- [x] Serializar explícitamente las fechas públicas de trabajos como cadenas ISO.
- [x] Añadir `pnpm check:architecture` y documentar sus límites.

Las seis fases están implementadas. La estructura y las garantías actuales se describen en [architecture.md](architecture.md). La validación usa pruebas locales y proveedores simulados; hardware MTP, proveedores de pago y fallos físicos de almacenamiento quedan fuera de esa verificación.

## Fase 1 Asegurar la verificación y la compatibilidad

**Objetivo:** disponer de pruebas que permitan extraer módulos sin perder comportamiento.

- [x] Ajustar el descubrimiento de pruebas para incluir todas las carpetas anidadas. El descubrimiento recursivo incluye `EpubTranslationStatus.test.ts` y todas las carpetas anidadas.
- [x] Revisar `jobs.test.ts` y `jobs.persistence.test.ts` y cubrir los comportamientos que falten: orden de cola por tipo, pausa durante ejecución, reanudación, restauración y apagado.
- [x] Añadir casos de persistencia concurrente, registros incompletos y checkpoints dañados antes de modificar esas operaciones.
- [x] Verificar que las respuestas públicas no exponen rutas locales, directorios de dispositivos ni memoria interna de traducción.

**Archivos:** `package.json`, pruebas de `apps/api/src/services`, pruebas de rutas y `scripts/check-architecture.mjs`.

**Criterio de cierre:** una sola ejecución de `pnpm test` descubre todas las pruebas; las pruebas relevantes describen comportamiento y compatibilidad, sin depender de la futura organización de módulos.

## Fase 2 Separar la persistencia de trabajos

**Objetivo:** aislar disco, rutas, serialización persistida y recuperación del servicio de trabajos.

- [x] Extraer generación y validación de rutas a `apps/api/src/services/jobs/paths.ts`.
- [x] Extraer `PersistedJobRecord`, sus conversiones, lectura y escritura de trabajos y fragmentos traducidos a `jobs/persistence.ts`.
- [x] Mantener escrituras atómicas y la serialización de escrituras por trabajo; definir cómo se vacían operaciones pendientes al cerrar o borrar un trabajo.
- [x] Validar registros cargados del disco antes de reconstruir el modelo interno. Definir qué sucede con registros inválidos y evitar descartes silenciosos de datos recuperables.
- [x] Mantener el formato persistido actual. No ha sido necesario introducir una versión nueva: se conserva el formato anterior.
- [x] Conservar `services/jobs.ts` como punto de entrada compatible durante la extracción.

**Criterio de cierre:** pausa y reinicio recuperan los mismos checkpoints; escrituras concurrentes no dejan JSON parcial ni permiten que una escritura pendiente recree un trabajo borrado.

## Fase 3 Separar cola, estados y ejecución

**Objetivo:** que las reglas de trabajos puedan probarse sin ejecutar proveedores ni acceder al disco.

- [x] Extraer transiciones de estado y cálculo de tiempo a `jobs/state.ts`, con reloj sustituible cuando sea necesario.
- [x] Extraer orden de cola, selección del siguiente trabajo y control de concurrencia a `jobs/queue.ts`.
- [x] Extraer ejecución EPUB y PDF y coordinación de checkpoints a `jobs/runner.ts`.
- [x] Definir dependencias pequeñas para los ejecutores y la persistencia, suficientes para sustituirlos en pruebas.
- [x] Componer las dependencias en un único lugar y mantener el servicio público como coordinador de operaciones.
- [x] Documentar transiciones válidas, comportamiento de pausa y política de concurrencia por tipo de trabajo.

**Orden interno:** extraer primero reglas puras, después cola y finalmente ejecución. Evitar que los módulos se importen circularmente o accedan a varias copias del estado global.

**Criterio de cierre:** no hay ejecuciones duplicadas; pausa, reordenación, reanudación y cierre funcionan con ejecutores controlados en pruebas; la integración real conserva el comportamiento cubierto en la fase 1.

## Fase 4 Separar reglas de lectura y SQLite

**Objetivo:** distinguir las reglas del registro de lectura de su almacenamiento.

- [x] Extraer apertura, esquema, migración JSON y consultas SQLite a `apps/api/src/services/readingLog/repository.ts`.
- [x] Extraer creación y actualización de libros a `readingLog/domain.ts`, incluyendo fechas al empezar y terminar una lectura.
- [x] Reutilizar `ReadingBookChanges` del contrato compartido.
- [x] Validar estados, puntuaciones, fechas y categorías en la entrada HTTP.
- [x] Revisar la migración JSON para que sus errores no se marquen como una importación completada; definir reintento y diagnóstico sin perder el archivo original.
- [x] Mantener `services/readingLog.ts` como punto de entrada de los casos de uso.

**Criterio de cierre:** las reglas se prueban sin SQLite; las pruebas de integración usan una base temporal y verifican migración, actualización y cierre de conexiones.

## Fase 5 Revisar límites y sustitución de archivos

**Objetivo:** aplicar las garantías de recursos y recuperación observadas en Nemeton a las integraciones existentes.

- [x] Inventariar límites actuales de tamaño, tiempo y concurrencia en EPUB, PDF, OCR, LLM y dispositivos.
- [x] Completar los límites que falten y definir errores comprensibles, sin cambiar silenciosamente de proveedor o calidad.
- [x] Revisar ZIP y extracción de documentos: rutas, cantidad de entradas y tamaño expandido.
- [x] Revisar sustituciones de EPUB, portadas y archivos de dispositivos; usar temporales en el mismo volumen y sustitución atómica cuando sea compatible con el destino.
- [x] Revisar conflictos entre edición, renombrado, descarga y eliminación del mismo archivo.
- [x] Mantener la recuperación y reutilización de checkpoints PDF durante cualquier extracción de proveedores.

**Archivos:** `services/epub.ts`, `epubMetadata.ts`, `pdf.ts`, `pdfOpenRouter.ts`, `devices.ts` y las rutas que escriben archivos.

**Criterio de cierre:** entradas malformadas y fallos externos tienen resultados definidos; una operación fallida no sustituye un archivo válido por contenido parcial; los límites relevantes tienen pruebas específicas.

## Fase 6 Consolidar contratos y dependencias

**Objetivo:** mantener las reglas de arquitectura al incorporar nuevos módulos.

- [x] Completar validadores de entradas HTTP de trabajos, dispositivos y lectura donde falten.
- [x] Añadir validación de respuestas externas donde exista una necesidad concreta; distinguirla de la comprobación del sobre HTTP.
- [x] Ampliar el comprobador de arquitectura para las nuevas fronteras entre dominio, persistencia y ejecución.
- [x] Incorporar el resolvedor de TypeScript al comprobador, con soporte para alias de imports.
- [x] Integrar el control de arquitectura en `pnpm check`. El proyecto no tiene CI configurada.
- [x] Actualizar `architecture.md` con la estructura final y marcar las fases completadas en este plan.

**Criterio de cierre:** las dependencias prohibidas fallan automáticamente y la documentación coincide con el código.

## Verificación de cada fase

Ejecutar `pnpm check:architecture`, `pnpm typecheck`, `pnpm test` y `pnpm build`. Añadir pruebas nuevas para riesgos de comportamiento, recuperación o concurrencia; evitar pruebas que solo reproduzcan la estructura de la implementación.

Cuando cambie ejecución o persistencia, comprobar además traducción EPUB y conversión PDF con pausa, reinicio, reanudación y descarga. Usar archivos y directorios temporales; cualquier prueba con un proveedor de pago debe quedar identificada como validación externa.

## Orden y decisiones de alcance

Completar las fases 1, 2 y 3 en ese orden. La fase 4 puede abordarse después de la fase 1 de forma independiente de la extracción de trabajos. Priorizar antes cualquier defecto de integridad encontrado en la fase 5. Consolidar las reglas de la fase 6 a medida que se incorporen módulos.

No introducir un contenedor de inyección, un bus de eventos o nuevos paquetes de infraestructura sin una necesidad demostrada. Extraer un núcleo independiente cuando existan reglas puras suficientes para justificarlo; mantener inicialmente esos módulos dentro de la API permite separar responsabilidades con menos cambios de estructura.
