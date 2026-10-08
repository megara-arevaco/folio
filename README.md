# Folio

Tu taller web de libros digitales: traduce EPUB, convierte PDF a EPUB, edita metadatos y portadas, transfiere libros al lector y guarda tus lecturas. React en el navegador y una API Fastify con persistencia local en el servidor.

Repositorio: [megara-arevaco/folio](https://github.com/megara-arevaco/folio). La carpeta del proyecto es `folio`. El icono está en `apps/web/public/icon.svg`.

## Desarrollo

Necesitas Node.js 24 y pnpm 10.

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Abre `http://localhost:5173`. Un solo comando arranca Vite y Fastify con recarga automática. También puedes usar `pnpm dev:api` y `pnpm dev:web` por separado. Vite redirige `/api` al servidor en el puerto 3001.

## Ejecución web

```sh
pnpm build
pnpm start
```

Abre `http://127.0.0.1:3001`. Fastify sirve la web compilada y la API desde el mismo origen, incluidas las rutas de navegación directa. `HOST` y `PORT` configuran la escucha. Es una herramienta personal sin cuentas ni autenticación; un despliegue público requiere controlar el acceso al servidor. Si usas un proxy HTTPS, añade su origen a `FOLIO_ALLOWED_ORIGINS` (lista separada por comas).

También puedes ejecutar `docker compose up --build` y abrir `http://localhost:3001`. Los datos se conservan en el volumen `folio_data`. Las variables de proveedores se leen del `.env`; para conectar dispositivos al anfitrión, configura `DEVICE_BRIDGE_URL` y `DEVICE_BRIDGE_TOKEN`.

## Configuración y datos

El servidor carga el `.env` del directorio de ejecución; `FOLIO_ENV_FILE` permite elegir otro. Las variables suministradas por el entorno tienen prioridad. El ejemplo usa `FOLIO_DATA_DIR=./data`, donde se guardan `reading-log.sqlite`, `jobs/` y `books/`. Sin esa variable se conservan las rutas anteriores del servidor. `JOBS_TMP_ROOT`, `OUTPUT_DIR`, `READING_DB_PATH` y `READING_LOG_PATH` permiten reutilizar datos existentes, incluidos los de una instalación anterior de Folio. No muevas trabajos mientras siguen procesándose.

Para traducción real, configura `LLM_API_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` y `LLM_MOCK=false`. Para PDF elige `PDF_CONVERSION_PROVIDER=local` o configura OpenRouter. Las claves solo se usan en el servidor.

La edición local usa permisos de escritura del navegador cuando File System Access está disponible en un contexto seguro (HTTPS o localhost). En otros navegadores puedes subir el archivo y descargar una copia con los metadatos modificados. Los libros procesados y los del dispositivo se editan a través de la API.

El navegador no accede directamente a lectores USB/MTP. Para lectores conectados al equipo del servidor usa `EBOOK_DEVICE_ROOTS`; para el puente local ejecuta `pnpm dev:device-bridge`. En Linux puedes instalar `systemd/folio-device-bridge.service` como servicio de usuario. Mantén el mismo token en API y puente. GIO gestiona MTP en Linux y Calibre puede ser necesario para Kindle.

El OCR local requiere `pdftoppm` (Poppler) y, para funcionar sin red, los archivos de idioma indicados por `TESSDATA_PREFIX`. El contenedor incluye Poppler y Calibre.

## Validación

```sh
pnpm exec playwright install chromium
pnpm check
```

Playwright prueba Chromium contra la web compilada y Fastify real, con datos temporales independientes. Cubre navegación, traducción simulada, PDF local, edición y descarga, lecturas, persistencia al reiniciar y rechazo de entradas inválidas. No utiliza proveedores de pago ni dispositivos físicos. `pnpm test` ejecuta la suite; `pnpm typecheck` y `pnpm check:architecture` verifican tipos y límites entre capas. Los informes de fallos se guardan en `playwright-report/` y `test-results/`.

La estructura y los contratos se describen en [docs/architecture.md](docs/architecture.md). [SPEC_FOLIO.md](SPEC_FOLIO.md) conserva la especificación inicial de traducción; [PRODUCT.md](PRODUCT.md) define el alcance actual.
