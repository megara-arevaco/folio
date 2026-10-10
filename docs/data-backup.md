# Copias y restauración de datos de Folio

`folio-data.mjs` es una utilidad offline para los datos de aplicación. No cambia el volumen ni ejecuta el despliegue; detén la API antes de operar. El bloqueo exclusivo del directorio también rechaza backup/restauración mientras Folio esté activo. La API adquiere el bloqueo antes de recuperar trabajos o iniciar workers y rechaza el arranque si encuentra un diario de restauración pendiente.

## Crear y verificar una copia

Sustituye las rutas por las del servidor. Guarda el ZIP en otro disco o destino privado y no sobrescribas una copia existente:

```sh
DATA_DIR=/ruta/de/datos/folio
ARCHIVE=/ruta/segura/folio-backup.zip

env -u JOBS_TMP_ROOT -u OUTPUT_DIR -u READING_DB_PATH -u READING_LOG_PATH \
  FOLIO_DATA_DIR="$DATA_DIR" \
  node scripts/folio-data.mjs backup --data-dir "$DATA_DIR" --file "$ARCHIVE"

node scripts/folio-data.mjs verify --file "$ARCHIVE"
```

Si la aplicación usa ubicaciones de trabajos/libros/lecturas no canónicas, el CLI rechaza la operación para evitar una copia global incompleta. La copia incluye trabajos (originales, resultados, estados, checkpoints, glosarios y versiones), libros, historial de lecturas/SQLite y el ledger de reservas IA. Se valida el snapshot SQLite. `.env`, `settings.json`, credenciales y claves de proveedor se excluyen: guárdalos por separado con las protecciones apropiadas. Restaurar datos no cambia ni devuelve ajustes o secretos.

`verify` comprueba el formato/versionado, hashes, trabajos, SQLite y límites de ZIP/rutas sin escribir en el directorio de datos. Trabaja sobre un archivo de confianza; sus límites actuales son 50 000 entradas, 1 GiB por archivo, 2 GiB descomprimidos y ratio máximo 1000:1.

## Restaurar

Detén el servidor y asegúrate de que el directorio de destino/entorno esté configurado para los paths canónicos. Para restaurar a otro directorio, `FOLIO_DATA_DIR` debe apuntar exactamente a ese destino; desactiva solo los overrides heredados que apunten a la instalación anterior:

```sh
DATA_DIR=/ruta/de/datos/folio-restaurados
ARCHIVE=/ruta/segura/folio-backup.zip

env -u JOBS_TMP_ROOT -u OUTPUT_DIR -u READING_DB_PATH -u READING_LOG_PATH \
  FOLIO_DATA_DIR="$DATA_DIR" \
  node scripts/folio-data.mjs restore --data-dir "$DATA_DIR" \
  --file "$ARCHIVE" --confirm "RESTORE FOLIO DATA"
```

La frase es obligatoria. Antes de sustituir datos se crea una copia previa recuperable dentro de `backups/`; el ZIP se verifica y prepara en staging, SQLite se valida, y las rutas internas de los trabajos se actualizan al nuevo directorio. Los trabajos que estaban pendientes o activos quedan pausados, no se inician llamadas a proveedores. El uso IA se fusiona de forma monotónica para no reducir reservas previas. Si el proceso se interrumpe, recupera o limpia el diario con la API detenida:

```sh
env -u JOBS_TMP_ROOT -u OUTPUT_DIR -u READING_DB_PATH -u READING_LOG_PATH \
  FOLIO_DATA_DIR="$DATA_DIR" \
  node scripts/folio-data.mjs recover --data-dir "$DATA_DIR"
```

La recuperación revierte una sustitución incompleta o limpia de forma idempotente el staging de una operación ya confirmada: tras `committed`, los datos nuevos nunca se revierten por un fallo de limpieza. Conserva el ZIP externo y no borres manualmente el diario/staging. `backup` y `restore` no recuperan diarios automáticamente; usa `recover` de forma explícita. Si el CLI informa que el diario está dañado, detente y conserva los datos para inspección manual.

El bloqueo compartido API/CLI valida rol permitido, token UUID y PID entero seguro positivo. Un bloqueo válido con proceso ya terminado no se elimina al arrancar la API ni al ejecutar backup/restore. El comando explícito `recover` puede reclamar un bloqueo de instancia obsoleto bajo un bloqueo de coordinación que serializa creadores y borradores; no se ejecuta `kill` con PID inválido. Si queda `.folio-instance.guard` (por ejemplo, tras un crash dentro de la sección crítica), no se recupera automáticamente: confirma que no hay procesos Folio, conserva una copia del directorio y solicita revisión antes de retirar manualmente ese guard. Bloqueos dañados o diarios no válidos se tratan como fail-closed.

Las pruebas E2E aisladas inyectan un fallo después de que el commit está escrito y parte de `previous/` ya se haya borrado; comprueban que la API no arranca, el resultado confirmado permanece y dos ejecuciones de `recover` limpian de forma idempotente. También simulan un diario `applying`, dos starters ante un lock obsoleto, PIDs inválidos, un job ID `__proto__` y un ledger con una clave prototype-unsafe. Son pruebas de filesystem y libros ficticios, no una ejecución contra datos personales ni garantía de calidad de traducción/OCR.

## Alcance y límites

Esta herramienta no comprueba la calidad de traducciones/OCR, no hace backup de archivos de configuración, no migra volúmenes Docker ni sustituye una política externa de backup. La verificación/restauración se probó con libros ficticios y almacenamiento temporal aislado; no se ha probado con la biblioteca real ni con datos de producción. No ejecutes comandos de despliegue o eliminación de volúmenes como parte de este procedimiento.
