# Arquitectura de Folio

La API y la web comparten contratos públicos y mantienen sus implementaciones separadas. Los trabajos distinguen reglas, cola, ejecución y persistencia; el registro de lectura distingue reglas y SQLite. El [plan de refactorización](architecture-plan.md) recoge las fases implementadas.

## Referencias de Nemeton

Los patrones se identificaron en el código y la documentación local de Nemeton; no se encontró allí un documento explícito de principios de arquitectura.

- `packages/core` separa lógica de biblioteca e integración Steam de Electron.
- `apps/desktop/src/shared/ipc-contracts.ts` centraliza contratos y validación.
- `apps/desktop/src/main/savegames` separa descubrimiento, archivos, restauración y retención.
- `docs/audit-remediation.md` explica escrituras atómicas, serialización de operaciones, límites de recursos y recuperación.

## Responsabilidades y dependencias

| Ubicación | Responsabilidad |
| --- | --- |
| `packages/contracts/src` | Contratos públicos y validadores puros compartidos |
| `apps/api/src/routes` | Validar entradas HTTP y adaptar respuestas |
| `services/jobs.ts` | Componer dependencias y coordinar los casos de uso de trabajos |
| `services/jobs/paths.ts` | Directorios, identificadores y nombres de archivos |
| `services/jobs/records.ts` | Formato persistido, validación y reconstrucción del modelo |
| `services/jobs/persistence.ts` | Escrituras, checkpoints, borrado y recuperación del disco |
| `services/jobs/state.ts` | Estados y cálculo de tiempo activo con reloj sustituible |
| `services/jobs/queue.ts` | Orden y concurrencia por tipo de trabajo |
| `services/jobs/runner.ts` | Ejecutar EPUB y PDF mediante dependencias sustituibles |
| `services/readingLog.ts` | Casos de uso del registro de lectura |
| `services/readingLog/domain.ts` | Creación de libros y reglas de actualización de fechas |
| `services/readingLog/repository.ts` | SQLite, transacciones, esquema y migración JSON |
| `services/shared` | Escrituras, exclusión de operaciones, límites, transporte externo y ZIP |
| `apps/web/src/services` | Transporte HTTP y adaptación de datos para la interfaz |
| `apps/web/src/components` | Presentación e interacción |

`pnpm check:architecture` usa el resolvedor de TypeScript, incluidos los alias que se definan en `tsconfig.json`. Comprueba imports, reexports, tipos e imports dinámicos con rutas literales. Impide dependencias entre las implementaciones de API y web, imports de Node en web y dependencias de servicios hacia rutas o arranque HTTP. Los contratos solo dependen de otros contratos. Estado, cola, registros y dominio de lectura no importan implementaciones en ejecución; la persistencia no depende de coordinadores ni ejecutores.

Las pruebas pueden importar Node y módulos de implementación. El control no analiza imports calculados ni dependencias transitivas de paquetes externos.

## Contratos y validación

Los tipos públicos de trabajos, metadatos, dispositivos y lectura tienen una definición compartida. Los módulos anteriores reexportan sus tipos para conservar los imports de sus consumidores. Las fechas públicas son cadenas ISO. Rutas locales, memoria de traducción, checkpoints y raíces de dispositivos pertenecen al modelo interno.

Las rutas validan identificadores, posiciones de cola, metadatos, estados de lectura, puntuaciones, fechas y categorías antes de invocar los servicios. El transporte web comprueba el sobre `{ ok: true, data }`; esta comprobación no valida todos los campos de cada respuesta. El puente de dispositivos sí se valida y se serializa mediante una lista explícita de campos públicos. Los catálogos externos tienen tamaño limitado y validación de la colección antes de normalizar sus elementos.

## Ciclo de vida de trabajos

| Estado de origen | Acción | Resultado |
| --- | --- | --- |
| `pending` | El ejecutor obtiene el turno | `processing` |
| `pending` | Pausa del usuario | `paused` |
| `processing` | Pausa del usuario | `pausing`, seguido de `paused` al detenerse el ejecutor |
| `processing` | Finalización o fallo | `done` o `error` |
| `paused` o `error` | Reanudación con ejecutor detenido | `pending` |
| `processing` o `pausing` persistidos | Reinicio del servidor | `paused` |
| Trabajo activo o pendiente | Apagado controlado | `paused`; se espera al ejecutor y se vacían escrituras |

Se ejecuta un trabajo EPUB y uno PDF como máximo a la vez. Una cabeza de cola pausada espera a la reanudación; iniciar expresamente otro trabajo pendiente lo coloca delante. Restaurar reconstruye la cola sin duplicados y habilita un nuevo ciclo tras el cierre. Los tiempos restaurados excluyen el tiempo que el servidor estuvo apagado.

La persistencia conserva el formato JSON anterior y sus campos opcionales. Las escrituras de cada trabajo se serializan con snapshots. Borrar impide nuevas escrituras antes de vaciar las anteriores. Los registros inválidos quedan intactos y la carga devuelve diagnósticos. Los checkpoints EPUB comprueban contenido, IDs y correspondencia con los lotes del documento. Un checkpoint inconsistente produce un error y se conserva para revisión.

El PDF local guarda páginas en una caché asociada al contenido y la configuración; la reanudación reutiliza las páginas guardadas. OpenRouter conserva su caché, anotaciones y checkpoints existentes. Los nombres de salidas nuevas resuelven colisiones sin reemplazar un libro ya publicado.

## Persistencia de lectura y archivos

El repositorio hace las actualizaciones de lectura dentro de transacciones y cierra las conexiones también ante errores. La migración JSON valida todos los libros y confirma sus datos y el marcador de migración en una misma transacción. Un fallo deja el JSON original y permite reintentar después de corregirlo.

Edición, renombrado y borrado de trabajos comparten exclusión por identificador. Las escrituras de metadatos y portadas comparten exclusión por archivo y sustituyen el destino mediante un temporal en el mismo directorio. El renombrado publica el nuevo nombre sin reemplazar destinos existentes y guarda la nueva ruta antes de retirar la anterior. Las subidas locales a dispositivos publican temporales completos sin sobrescribir libros, y rechazan carpetas simbólicas fuera del dispositivo.

Estas exclusiones operan dentro de cada proceso. La publicación de archivos nuevos evita colisiones también entre procesos mediante enlaces de archivos. Las copias GIO sobre MTP dependen de las garantías del dispositivo: no se promete sustitución atómica allí. Si una mutación del puente no puede confirmarse, la API devuelve un error y evita repetirla automáticamente sobre otro destino.

## Límites de recursos

| Operación | Límite |
| --- | --- |
| Documento o subida | `MAX_UPLOAD_MB`: 100 MiB por defecto, entero entre 1 y 1024 |
| Solicitud multipart | 2 archivos, 10 campos y 12 partes |
| EPUB ZIP | 10000 entradas, 64 MiB por entrada y 512 MiB expandidos; rutas y duplicados validados |
| PDF | `PDF_MAX_PAGES`: 2000 por defecto, máximo 10000 |
| Render y reconocimiento OCR local | `PDF_OCR_TIMEOUT_MS`: 120 s por defecto; imagen hasta 2400 píxeles en su lado mayor |
| LLM de traducción | `LLM_TIMEOUT_MS`: 120 s por defecto; respuestas JSON hasta 8 MiB |
| PDF OpenRouter | `PDF_TIMEOUT_MS`: 180 s por defecto; respuestas JSON hasta 8 MiB; conserva límites de lotes, reintentos y figuras |
| Catálogos de libros | 8 s y respuestas hasta 2 MiB por catálogo |
| Puente HTTP | 30 s por defecto; selector local hasta 10 minutos; descargas hasta el límite de documento |
| Conversión Kindle y transferencias GIO | 2 operaciones simultáneas y hasta 8 en espera por grupo; procesos hasta 5 minutos |
| Exploración de dispositivos | 1000 libros, profundidad 10 y 12 consultas de archivos concurrentes |

Los límites de ZIP se comprueban antes de leer entradas; la inflación también se limita aunque el tamaño declarado sea falso. Las lecturas asíncronas de documentos y respuestas externas cuentan los bytes recibidos. El puente valida el tamaño de archivos locales antes de enviarlos.

Los límites de contenido no equivalen a un límite absoluto de memoria del proceso. La inicialización y descarga de datos de Tesseract dependen de la biblioteca; el timeout de reconocimiento comienza una vez creado el trabajador. Las escrituras atómicas y las transacciones no garantizan recuperación frente a fallos físicos del almacenamiento. Una interrupción entre publicación y limpieza puede dejar un archivo completo adicional.

## Aplicación web y verificación

Folio se abre en el navegador. En desarrollo, Vite redirige `/api` a Fastify; en producción, Fastify sirve la compilación React y la API desde el mismo origen. El servidor carga `.env` antes de inicializar servicios y admite `FOLIO_DATA_DIR` para datos persistentes. Al recibir SIGINT o SIGTERM cierra Fastify y conserva checkpoints. La edición de archivos usa File System Access cuando está disponible y descarga una copia en otros navegadores. El puente local permite acceder a lectores conectados al equipo anfitrión.

`pnpm check` ejecuta el control de arquitectura, TypeScript, E2E con Chromium y la compilación de web y API. Cada prueba arranca Fastify con datos temporales. Cubre navegación, EPUB simulado, PDF local real, edición y descarga, persistencia tras reiniciar el servidor y rechazo de entradas y orígenes no autorizados. OCR, OpenRouter y hardware MTP requieren validación adicional en su entorno.

Las instrucciones de ejecución están en `README.md`.
