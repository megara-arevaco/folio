# Folio

Tu taller local de libros digitales: traduce EPUB, convierte PDF a EPUB, edita metadatos y portadas, transfiere libros al lector y guarda tus lecturas. Aplicación de escritorio con Electron, React y una API Fastify integrada.

El nombre alude a la hoja de un libro y abarca todo el flujo editorial. El icono es un libro abierto con un marcapáginas verde, sobre el nogal de la interfaz. Su fuente vectorial está en `apps/web/public/icon.svg`; la compilación genera el PNG usado por Electron y los instaladores.

## Desarrollo

Necesitas Node.js 24 y pnpm 10.

```sh
pnpm install
pnpm dev
```

`pnpm dev` compila y abre Electron con la API incorporada. Después de cambiar código, vuelve a ejecutarlo. `pnpm start` abre la última compilación. Para trabajar con recarga automática en el navegador, ejecuta `pnpm dev:api` y `pnpm dev:web` en terminales separadas.

## Configuración y datos

Folio guarda datos en la carpeta `userData` de Electron: normalmente `~/.config/Folio` en Linux, `~/Library/Application Support/Folio` en macOS y `%APPDATA%/Folio` en Windows. `FOLIO_DATA_DIR` permite elegir otra carpeta.

Coloca allí un `.env` basado en `.env.example`. Para traducir de verdad, configura `LLM_API_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` y `LLM_MOCK=false`. Para PDF puedes elegir `PDF_CONVERSION_PROVIDER=local` o configurar OpenRouter. El modo simulado de traducción se usa solo para validación. El `.env` del repositorio se usa únicamente en el servidor web independiente y nunca se incluye en el instalador.

En la carpeta de datos se guardan `reading-log.sqlite`, `jobs/` (estado y checkpoints), `books/` (resultados) y temporales de OCR. Los archivos previos del repositorio se conservan. Puedes seguir usando sus rutas mediante `JOBS_TMP_ROOT`, `OUTPUT_DIR`, `READING_DB_PATH` y `READING_LOG_PATH` en el `.env` de Folio. No copies trabajos mientras la instancia anterior sigue procesándolos.

El OCR local necesita `pdftoppm` (Poppler) instalado y, para funcionar sin red, los archivos de idioma indicados por `TESSDATA_PREFIX`. La conversión para Kindle puede necesitar Calibre; las transferencias MTP en Linux usan GIO. Estas herramientas externas no se incluyen en el instalador.

La API escucha solo en `127.0.0.1`, en un puerto disponible. El renderer está aislado, usa sandbox y no tiene acceso a Node. La edición local usa un selector nativo de Electron y permisos temporales limitados al archivo elegido; detecta cambios externos antes de sobrescribirlo.

## Validación E2E

```sh
pnpm test
pnpm check
```

Playwright abre Electron real y utiliza una carpeta temporal nueva por prueba. No toca la biblioteca personal, dispositivos físicos ni proveedores de pago. La suite valida navegación, carga de archivos, traducción simulada de EPUB, conversión local de PDF, edición de metadatos, sobrescritura nativa, lecturas, persistencia y rechazo de entradas inválidas. El resultado del selector del sistema se simula porque Playwright no controla diálogos nativos; el resto del flujo usa la API y los archivos reales.

En Linux sin sesión gráfica, ejecuta `xvfb-run -a pnpm test`. `FOLIO_E2E_NO_SANDBOX=true` está disponible para entornos de pruebas que no permiten el sandbox de Chromium; no cambia la configuración de la app. Los informes y trazas de fallos se guardan en `playwright-report/` y `test-results/`. No hay tests unitarios.

## Empaquetado

```sh
pnpm package  # carpeta ejecutable en release/
pnpm dist     # instalador para el sistema actual
```

La configuración incluye AppImage en Linux, DMG en macOS y dos distribuibles para Windows x64:

```sh
pnpm dist:win
```

- `release/Folio-0.1.0-windows-x64-setup.exe`: instalador NSIS, permite elegir carpeta y crea accesos directos.
- `release/Folio-0.1.0-windows-x64.zip`: aplicación sin instalación. Extrae todo el ZIP y abre `Folio.exe`; conserva las demás carpetas y archivos junto al ejecutable.

Los artefactos contienen Electron y no necesitan Node.js ni pnpm en el equipo del usuario. La configuración y los datos se guardan en `%APPDATA%/Folio`, también al ejecutar el ZIP. Los instaladores se generan sin firma mientras no se proporcionen las credenciales del distribuidor.

En Windows el comando usa electron-builder directamente. Desde Linux o macOS necesita Docker y usa una imagen fijada de `electronuserland/builder:wine`, copiando únicamente las entradas de compilación al contenedor. No copia el `.env` ni los libros del usuario. La sección `pnpm.supportedArchitectures` de `package.json` instala también los binarios opcionales de Windows que necesita la aplicación, incluido el backend de PDF. El flujo `.github/workflows/windows.yml` compila, ejecuta las pruebas E2E sobre Windows y sobre el ejecutable empaquetado, y adjunta ambos distribuibles como artefactos; se puede lanzar manualmente o mediante una etiqueta `v*`.

Para un lector que aparece como unidad de disco en Windows, configura `EBOOK_DEVICE_ROOTS=E:\` en el `.env` de Folio. Separa varias rutas con `;`, por ejemplo `E:\;F:\`. La integración MTP mediante GIO es específica de Linux. OCR y conversión Kindle siguen necesitando las herramientas externas indicadas arriba.

Genera y valida macOS en su sistema correspondiente. La firma y notarización requieren las credenciales del distribuidor.
