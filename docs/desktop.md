# Folio Desktop — base Electron

La aplicación de escritorio reutiliza React y Fastify sin Docker ni un servidor externo.
El objetivo actual es una beta gratuita para Linux x64 y Windows x64, sin cuentas ni
activación. Sigue siendo una base de desarrollo: no tiene actualizaciones automáticas,
firma de código ni onboarding nuevo. La licencia de distribución sigue pendiente.
Véase [la checklist de release](release-checklist.md).

## Desarrollo

Requisitos: Node.js 24, Corepack/pnpm 10 y un entorno gráfico. La primera instalación
o ejecución de Electron puede descargar su runtime.

```sh
corepack pnpm install --frozen-lockfile
# Si pnpm no está en PATH, habilitar el shim solo dentro del proyecto:
corepack enable --install-directory node_modules/.bin pnpm
corepack pnpm desktop:dev
```

`desktop:dev` compila la interfaz y el motor antes de abrir la ventana; todavía no hay
hot reload. No necesita ni utiliza el Vite ni la API del despliegue web.

## Datos y configuración

Los datos están en `app.getPath('userData')/data`, no en el volumen Docker ni en la
biblioteca del checkout. En Linux normalmente es `~/.config/Folio/data`; la ubicación
exacta depende del sistema y de XDG_CONFIG_HOME. En Windows normalmente es
`%APPDATA%/Folio/data`. No se migran bibliotecas existentes.

El idioma se guarda atómicamente en `userData/desktop-preferences.json`, independiente
del puerto y localStorage del navegador. Se conserva entre aperturas y restauraciones
de biblioteca. Un archivo corrupto se conserva y se muestra un error; no se sobrescribe
silenciosamente. Aún no se guardan tamaño/posición de ventana ni zoom.

No se carga el `.env` del repositorio. Opcionalmente se lee `desktop.env` dentro de
`userData`. El escritorio fija sus rutas privadas, desactiva Mock y utiliza conversión
PDF local por defecto. Las variables heredadas del proceso tienen precedencia sobre
el archivo; no iniciar Folio desde un entorno con credenciales o puentes ajenos.

Las claves guardadas desde Ajustes se cifran mediante `safeStorage` de Electron y se
almacenan como ciphertext en settings.json. En Linux se rechaza `basic_text`: hace
falta un llavero compatible. No hay fallback a guardar la clave sin cifrar. Estas claves
no son portables entre equipos; los backups existentes excluyen los ajustes.
La traducción envía texto a OpenRouter cuando se inicia una operación real: local no
significa offline. No se han hecho solicitudes a proveedores reales durante las pruebas.

## Seguridad y ciclo de vida

- Una sola instancia por perfil; otra apertura enfoca la ventana existente.
- Motor en el proceso principal, puerto aleatorio y enlace exclusivo a 127.0.0.1.
- Secreto aleatorio por ejecución en todas las rutas, incluidos los recursos web.
- El proceso principal añade el secreto solo a peticiones del origen de Folio.
- Renderizador con sandbox, contextIsolation, webSecurity y sin Node.
- Preload aislado con puente limitado a idioma, diagnóstico y mantenimiento. Se verifica
  ventana, frame principal y origen en cada IPC. No expone rutas arbitrarias, comandos,
  filesystem, secretos ni ipcRenderer.
- CSP restringida, ventanas emergentes/webviews y navegación externa bloqueadas.
- Permisos solicitados por páginas denegados; las descargas muestran diálogo de guardado.
- Al salir se espera a cerrar Fastify y persistir/pausar trabajos antes de terminar.

Al fallar el arranque por un lock abandonado o diario de restauración se ofrece recuperación
explícita y reinicio. El CLI mantiene la validación de PID/rol/token y nunca reclama un
lock de un proceso vivo. Un guard abandonado o un archivo corrupto exige revisión manual.

No se han diseñado aún enlaces externos, una política completa de permisos de archivos
ni diagnóstico exportable. El motor comparte
el proceso principal: falta medir la respuesta de la ventana bajo trabajos grandes antes
de decidir si se mueve a un proceso auxiliar.

## Comprobaciones

```sh
corepack pnpm desktop:build
corepack pnpm desktop:test
node scripts/smoke-desktop.mjs
corepack pnpm typecheck
corepack pnpm check:architecture
corepack pnpm test:e2e
```

El test API usa datos temporales y un codec ficticio; comprueba acceso, orígenes y que
la clave no se guarda ni devuelve en claro. No acredita el llavero real del equipo.
Los cinco tests de escritorio comprueban autorización, codec de claves, persistencia de
idioma, detección de herramientas ausentes, exclusión mutua y operaciones reales de
backup/verificación/restauración/recuperación en datos temporales.
El smoke abre Electron con un perfil temporal, comprueba puente, autorización, diagnóstico,
idioma entre aperturas y backup/restauración desde el proceso principal. Usa diálogos nativos
simulados y reabre el perfil explícitamente en vez de ejecutar el relaunch automático.
No acredita la interacción manual con los diálogos ni el relanzamiento real del instalador.
No utiliza bibliotecas personales ni proveedores externos.

Con `FOLIO_TEST_SCREENSHOTS=1` captura Ajustes a 1280 y 760 px en test-results/desktop;
Playwright puede limpiar esta carpeta al ejecutar después la suite web.

En esta máquina Electron aborta sin configurar el helper SUID del sandbox. Las pruebas
de ventana se ejecutaron con `FOLIO_TEST_NO_SANDBOX=1`, una excepción explícita **solo
para el smoke aislado**. La aplicación y sus comandos normales no desactivan el sandbox.
No utilizar ese flag para trabajo habitual o distribución; resolver la configuración
compatible del sandbox en el equipo de destino. Las preferencias del renderizador se
comprueban, pero este smoke no acredita aislamiento efectivo del SO con ese flag.
Playwright desactiva el sandbox por defecto: el script ahora fuerza `chromiumSandbox`
y verifica que `--no-sandbox` no esté presente salvo excepción explícita. El arranque
sin excepción fallaba con el ejecutable sin instalar. Tras instalar el .deb autorizado,
`/opt/Folio/folio` pasa con sandbox: renderizador `NoNewPrivs=1`, `Seccomp=2`.
Véase [la comprobación local](release-validation.md).

`FOLIO_TEST_EXECUTABLE=/opt/Folio/folio node scripts/smoke-desktop-relaunch.mjs`
comprueba además un reinicio real después de crear copia: PID nuevo, datos e idioma
conservados y cierre limpio. Los diálogos se simulan, pero no el relanzamiento.

## Copia, restauración y dependencias

En **Ajustes** y en el menú **Folio** hay acciones para crear, verificar y restaurar copias.
Las rutas se eligen en diálogos nativos: la página no puede enviar rutas o comandos.

- Cancelar no detiene el motor ni modifica datos.
- Verificar no reinicia ni modifica la biblioteca.
- Crear o restaurar exige confirmar; se cierra el motor y se ejecuta la herramienta CLI
  empaquetada en un proceso separado. Se impide cerrar Folio durante la operación.
- Después de cerrar el motor se pide un arranque nuevo incluso si falla la herramienta;
  no se reutilizan mapas de trabajos ni ledgers de memoria tras restaurar.
- Restaurar verifica primero el ZIP y crea una copia previa recuperable en data/backups.
- No se sobrescriben archivos de copia existentes. Guarda cambios de formularios antes
  de continuar: no se recuperan borradores sin guardar.
- Claves, desktop.env y preferencias de escritorio quedan fuera del archivo.

Ajustes muestra detección de Poppler, Calibre, GIO (Linux) y almacén seguro, con botón
para comprobar otra vez. La clave no se puede introducir/guardar desde esa vista si el
almacén seguro no está disponible. Para PDF escaneado, conversión AZW3 y transferencia
MTP se comprueba la herramienta antes de usarla y se explica cómo resolver su ausencia;
PDF con texto y descarga manual siguen disponibles. Detectar ejecutables no garantiza
calidad OCR, drivers, permisos o compatibilidad con hardware.

## Empaquetado

```sh
corepack pnpm desktop:pack   # directorio ejecutable para el sistema actual
corepack pnpm desktop:dist   # artefacto distribuible para el sistema actual
```

En Linux el directorio es `dist-desktop/linux-unpacked/`, con ejecutable `folio`.
Para probarlo con datos temporales en Linux:

```sh
FOLIO_TEST_EXECUTABLE=dist-desktop/linux-unpacked/folio node scripts/smoke-desktop.mjs
```

Configurados objetivos Linux x64 (.deb y AppImage) y Windows x64 (NSIS); macOS queda
fuera de esta release. El workflow `.github/workflows/desktop.yml` compila en ambos
sistemas y ejecuta un smoke del directorio empaquetado. Esto no sustituye la prueba
manual de los instaladores. El CI aprobado instala/desinstala .deb y NSIS y prueba el
sandbox y el relaunch real en Ubuntu 24.04 y Windows Server 2022. Windows 10/11 y VM
mínima siguen pendientes. Véanse los enlaces y alcance en release-validation.md.
El primer empaquetado puede descargar Electron. Las releases por tag se crean como
borradores; no se publican automáticamente.

Por ahora se empaqueta sin ASAR para facilitar la compatibilidad de herramientas y
workers; antes de distribución comercial revisar ASAR/unpack, integridad y firma.
Los modelos OCR eng/spa se incluyen en resources/ocr. Poppler (`pdftoppm`), Calibre,
GIO y las dependencias del sistema **no se incluyen**: OCR de PDF escaneado y transferencias
pueden requerir herramientas instaladas. No se promete funcionamiento de esas funciones
en una máquina limpia. Revisar licencias de redistribución antes de incorporarlas.

## Siguiente fase

1. Probar instalación limpia y llavero real en Linux y Windows.
2. Revisar distribución de dependencias y probar mensajes de diagnóstico en máquinas limpias.
3. Probar manualmente diálogos, reinicio real y recuperación de errores del instalador.
4. Validar calidad de EPUB/PDF y transferencias a hardware real.
5. Añadir onboarding, iconos y gestión nativa de archivos.
6. Elegir licencia gratuita, avisos de terceros y condiciones de privacidad.
7. Completar [la checklist de release](release-checklist.md) antes de publicar.
