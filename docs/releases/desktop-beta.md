# Folio Desktop — beta gratuita

Folio reúne traducción EPUB, conversión PDF, edición de metadatos y registro de lecturas
en una aplicación local. No requiere cuenta de Folio ni suscripción.

## Descargas

- **Linux x64:** paquete `.deb` y AppImage. El `.deb` es el candidato principal para
  Debian/Ubuntu; el AppImage requiere verificar compatibilidad de sandbox en cada distribución.
- **Windows x64:** instalador `.exe` por usuario, con elección de carpeta.
- `SHA256SUMS.txt`: hashes para verificar las descargas; no sustituyen la firma de código.

## Límites de esta beta

- Los paquetes no están firmados. Windows puede mostrar advertencias de SmartScreen.
- Traducción requiere una clave propia de OpenRouter y puede generar cargos del proveedor.
  Folio gratuito no significa procesamiento IA gratuito. La muestra remota también puede consumir saldo.
- Archivos y trabajos se guardan en el equipo. Traducción remota envía texto al proveedor;
  las búsquedas de catálogos también contactan servicios externos.
- Linux necesita un llavero compatible para guardar claves. No se guardan sin cifrar
  cuando no existe un almacén seguro.
- Poppler, Calibre y herramientas de dispositivos no están incluidas. OCR de PDF escaneado
  y transferencias pueden requerir dependencias externas. No se anuncia compatibilidad
  general con lectores físicos.
- Copia, verificación y restauración disponibles desde Ajustes y menú nativo. Crear o
  restaurar una copia pausa trabajos y reinicia Folio; guarda cambios de formularios antes.
  Las claves y preferencias no se incluyen. No hay actualización automática.

## Antes de publicar este borrador

Estas notas son una plantilla de release, no una certificación de funcionamiento.
La publicación queda bloqueada hasta completar `docs/release-checklist.md`, elegir
la licencia del proyecto y registrar pruebas de instalación en Linux y Windows.
No recomendar arrancar con `--no-sandbox` para resolver problemas.

Al comunicar un error, indicar sistema, versión, pasos y mensaje. No adjuntar claves,
libros privados ni logs con información personal sin revisarlos.
