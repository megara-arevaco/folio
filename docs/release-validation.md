# Comprobación local de candidatos Linux / Windows

Estado: **release todavía bloqueada por validaciones pendientes**. La primera fase se
hizo sin instalar ni modificar el sistema. Después de autorización explícita del usuario,
se instaló el .deb en el anfitrión; el apartado siguiente recoge esa comprobación.
No se publican releases ni se crean tags.

## Entorno comprobado

Ubuntu 26.04.1 LTS x86_64, Node.js 24.21.0. User namespaces habilitados en el kernel,
pero restringidos por AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`).
`unshare -Ur true` falla con operación no permitida.

## Resultados

| Comprobación | Resultado | Alcance |
|---|---|---|
| SHA-256 de .deb y AppImage | Correcto | Integridad local, no firma de origen |
| Dependencias .deb con apt-get --simulate | Correcto | Solo añadiría Folio en este equipo; no se instaló |
| Bibliotecas del ejecutable con ldd | Sin bibliotecas ausentes detectadas | No acredita máquina limpia |
| Contenido .deb | Completo para shell/API/mantenimiento | Incluye preload, preferencias, CLI y perfil AppArmor |
| Arranque directo de linux-unpacked con sandbox | Falla | Helper SUID sin root:4755 |
| Arranque del .deb extraído, sin instalar | Falla | Mismo helper SUID; no se ejecuta postinst al extraer |
| Arranque directo de AppImage | Falla | Falta libfuse.so.2; FUSE3 no satisface ese runtime |
| Smoke Playwright exigiendo sandbox | Falla al arrancar | Confirma que el resultado anterior no acreditaba sandbox |
| Windows | No ejecutado | Sin Windows/Wine disponible; CI de escritorio aún no subido |
| Instalación/desinstalación real | No ejecutada | Requiere autorización en anfitrión o runner/VM desechable |

El postinst generado para .deb configura el helper según user namespaces e instala un
perfil AppArmor que autoriza userns para `/opt/Folio/folio`. Esto puede resolver el
bloqueo al instalar correctamente, pero no se declara validado antes de probarlo.
No se debe recomendar `--no-sandbox` como solución de distribución.

## Falso positivo corregido en el smoke

Playwright añade `--no-sandbox` por defecto si no se especifica `chromiumSandbox`.
Por tanto, eliminar el flag de nuestros argumentos no era suficiente.

`scripts/smoke-desktop.mjs` ahora especifica `chromiumSandbox: true` por defecto y
comprueba `app.commandLine.hasSwitch('no-sandbox')`. La excepción aislada
`FOLIO_TEST_NO_SANDBOX=1` es explícita y se imprime como advertencia.
Las preferencias `sandbox: true` del renderizador, por sí solas, no prueban el sandbox
real del sistema operativo.

## Segunda fase: .deb instalado en el anfitrión

Instalación autorizada con `pkexec apt-get install`: Folio `0.1.0~beta.1` instalado en
`/opt/Folio`, lanzador en `/usr/bin/folio`, entrada de escritorio y perfil
`/etc/apparmor.d/folio`. El helper queda root:root con modo 0755; el perfil AppArmor
permite user namespaces sin necesitar desactivar el sandbox.

Resultados sobre `/opt/Folio/folio`, sin `--no-sandbox`:

- Smoke completo aprobado con datos temporales: puente, idioma entre aperturas,
  diagnóstico, copia, cancelación, verificación, restauración y cierre.
- Renderizador Linux: `NoNewPrivs=1`, `Seccomp=2` (filtro activo).
- Reinicio real tras crear una copia: se observa un PID nuevo en el lock de la API,
  la biblioteca y el idioma se conservan y la nueva instancia responde.
- La instancia nueva cierra limpiamente y libera el lock de datos.
- Solo se simulan selección de archivo y confirmación; el relaunch crea un proceso
  real. El test añade un puerto CDP temporal para conectar con la nueva instancia.

Esto valida el equipo anfitrión, no una máquina limpia. El AppImage sigue requiriendo
FUSE2 y validación propia; la instalación .deb no resuelve esa dependencia.

## CI preparado, pendiente de ejecución

El workflow ahora instala .deb y NSIS en runners desechables, prueba el ejecutable
instalado con sandbox y desinstala comprobando un archivo centinela en la carpeta de
datos. No equivale a validar Windows 10/11 manualmente ni actualización entre versiones.
No se ejecutó este workflow remoto: sigue siendo un archivo local sin subir.

## Siguiente comprobación

1. Completar pruebas en runner/VM desechable; instalación local y relaunch ya comprobados.
2. Subir la rama de trabajo autorizada, sin tags de release, y ejecutar CI Linux/Windows.
3. Registrar resultados de CI y validar Windows 10/11 manualmente.
4. Revisar AppImage: dependencia FUSE2 y compatibilidad del sandbox por distribución.
5. Elegir licencia: el control Debian actual indica `License: unknown`.
