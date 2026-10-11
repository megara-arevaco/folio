# Release gratuita de Folio Desktop

Objetivo: `0.1.0-beta.1`, Linux x64 y Windows x64. Sin cuentas, pagos ni activación.
La licencia de distribución del código sigue pendiente; gratuito no implica código abierto.

## Infraestructura preparada

- [x] Configuración de paquetes Linux (.deb y AppImage) y Windows (NSIS).
- [x] Instalador Windows por usuario; no solicitar borrado automático de datos al desinstalar.
- [x] Workflow nativo en Ubuntu 24.04 y Windows Server 2022.
- [x] Prueba automatizada del paquete con perfil temporal y sin proveedores reales.
- [x] Generación de SHA-256.
- [x] Releases por tag como borradores prerelease, nunca publicación automática.

La existencia del workflow no significa que haya pasado en GitHub.
Resultados de la comprobación local: [release-validation.md](release-validation.md).
El smoke se corrigió para evitar que Playwright añadiera `--no-sandbox` implícitamente.
El .deb instalado en el anfitrión ya pasa con sandbox efectivo y relaunch real, pero
falta una instalación limpia. El CI prueba instalación, relaunch y desinstalación en
runners desechables; se dispara en ramas `desktop/**`, sin publicar releases.

## Bloqueos de publicación

- [ ] Elegir licencia del proyecto y añadir el archivo correspondiente.
- [ ] Revisar y distribuir avisos/licencias de dependencias, fuentes y modelos OCR.
- [ ] Completar CI en ambos sistemas; registrar enlace al run.
- [ ] Probar `.deb` en instalación limpia y arranque con sandbox, sin flags que lo desactiven.
- [ ] Probar AppImage con sandbox; si falla, no distribuirlo como soportado.
- [ ] Probar instalador Windows en Windows 10/11 x64, no solo en el runner Server.
- [ ] Verificar instalación, actualización, desinstalación y conservación de datos.
- [ ] Verificar llavero Linux y cifrado de claves Windows con claves ficticias.
- [x] Persistencia del idioma en el perfil, independiente del puerto; probada entre aperturas.
- [x] Diagnóstico de dependencias/llavero en Ajustes y errores accionables antes de usar herramientas ausentes.
- [x] Backup/verificación/restauración desde Ajustes y menú nativo, con cierre del motor y petición de reinicio.
- [ ] Validar diálogos y relanzamiento real manualmente en ambos instaladores (el smoke los simula).
- [ ] Validar manualmente recuperación al arrancar tras cierre forzado/diario pendiente en ambos sistemas.
- [ ] Probar EPUB reales autorizados, con llamadas reales solo tras autorizar presupuesto.
- [ ] Probar PDF de texto y delimitar tipos soportados.
- [ ] Probar cierres forzados, recuperación, suspensión, disco lleno y archivos grandes.
- [ ] Iconos de aplicación/instalador y guía de primer uso.
- [ ] Revisar privacidad, paquete final, ASAR/unpack y ausencia de archivos privados.
- [ ] Decidir firma de Windows o aceptar/documentar explícitamente una beta sin firma.
- [ ] Editar notas de release con resultados reales, no promesas.

## Generar candidatos locales

Ejecutar en el sistema correspondiente:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dist:linux
# En Windows:
pnpm desktop:dist:windows
pnpm desktop:checksums
```

Los resultados quedan en `dist-desktop/`. `desktop:dist:*` no publica nada.

## CI y borrador de GitHub Release

- PRs relevantes: compilan ambos sistemas y adjuntan artefactos si pasan pruebas.
- `workflow_dispatch`: genera artefactos descargables sin crear release.
- Tag `v0.1.0-beta.1`: valida coincidencia con package.json, compila y crea borrador
  prerelease con los artefactos y checksums si ambos jobs pasan.

No crear ni subir el tag hasta decidir que corresponde generar el candidato.
Revisar el borrador manualmente y publicar solo al cerrar los bloqueos.
No se han configurado credenciales de firma, notificaciones ni autoactualización.

## Registro de pruebas manuales

| Sistema y versión | Artefacto/hash | Instalación | Sandbox | Archivos/descargas | Cierre/reapertura | Claves | Actualización/desinstalación |
|---|---|---|---|---|---|---|---|
| Pendiente | | | | | | | |
