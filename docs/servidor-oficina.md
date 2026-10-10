# Folio con nginx compartido y API en Docker

Actualizado el 9 de octubre de 2026.

## Arquitectura

Un único servicio nginx del anfitrión sirve las webs de Folio y Calos. Cada proyecto conserva solo su API en Docker y su volumen de datos independiente.

```text
Navegador → nginx Ubuntu :8081
               ├─ / → /srv/www/folio/current (React compilado)
               └─ /api/ → 127.0.0.1:3001 → API Docker → folio_folio_data
```

El sitio se mantiene en `deploy/nginx/folio.conf`, se instala en `/etc/nginx/sites-available/folio` y se habilita mediante un enlace en `sites-enabled`. Conserva los sitios existentes del anfitrión en 80 y 8080. El backend solo se publica en loopback; la web escucha en loopback y, si se elige, en una IP LAN concreta. No se añaden dominios ni HTTPS.

La etapa Docker `web` es ahora un exportador de archivos basado en `scratch`: **no es un contenedor ejecutable ni contiene nginx**. El script exporta React, lo copia a una versión bajo `/srv/www/folio/releases/` y cambia atómicamente el enlace `current`. La API mantiene los datos en el volumen `folio_folio_data`, montado en `/data`: SQLite, trabajos, libros y registro de lecturas.

## Despliegue

Requisitos: nginx activo en Ubuntu, Docker con BuildKit/Compose y autenticación de administrador para escribir en `/etc/nginx` y `/srv/www`. Ejecutar como usuario normal; el script eleva únicamente la instalación del sitio.

```sh
cd /home/baul/Projects/folio
./scripts/deploy.sh --lan-ip 192.168.68.51
# O, para escucha exclusivamente local:
./scripts/deploy.sh --local-only
```

El script conserva `.env` si existe. En el primer despliegue detecta la IP de la interfaz de salida si no se indica una. `FOLIO_LAN_IP` sigue siendo la variable de configuración, pero ahora determina la escucha del nginx del anfitrión, no una publicación Docker. Las opciones la sustituyen solo durante esa ejecución; para persistir el cambio, editar `.env`. Se valida que sea una dirección IPv4 asignada a la máquina.

Pasos de una actualización:

1. Validar Compose sin mostrar secretos, construir la API y exportar la web compilada a una carpeta temporal.
2. Detener la API, si existe el volumen, y guardar un respaldo consistente en `backups/` con permisos restringidos.
3. Recrear solo `api` y esperar su healthcheck.
4. Solicitar autenticación mediante sudo o el diálogo gráfico de polkit (`pkexec`).
5. Instalar la versión web y el sitio; validar **la configuración completa** con `nginx -t`.
6. Durante la migración, detener el antiguo `folio-web-1`, recargar nginx y comprobar que loopback y la IP LAN entregan el HTML exacto de la nueva versión.
7. Eliminar únicamente el antiguo contenedor web cuando la comprobación ha pasado. No eliminar volúmenes.

`install-nginx.sh` usa un bloqueo compartido para serializar cambios de Folio y Calos al mismo nginx. Conserva la configuración y el enlace web anteriores en `/var/backups/nginx-folio-...`; mantiene las versiones web previas en `releases`. Si falla la instalación, recupera esos archivos e intenta reactivar el antiguo contenedor web. Esto no revierte una actualización previa de la API ni restaura datos automáticamente.

Hay una ventana de indisponibilidad durante el respaldo/reinicio de API y una breve transición al transferir el puerto desde Docker. Si se cancela la autenticación, la instalación del sitio no se ejecuta y la web anterior continúa. Una actualización debe completarse antes de considerar sincronizadas API y web.

## HTTP y acceso

La web conserva `http://127.0.0.1:8081` y, con la IP actual, `http://192.168.68.51:8081`. Nginx sirve archivos existentes y usa `index.html` para las rutas de React. `/api/` conserva su prefijo al pasar al backend y mantiene `Host` con el puerto, necesario para comprobar `Origin`.

No se ha añadido autenticación de usuarios. Restringir la IP de escucha no filtra por sí solo las direcciones de los clientes; el acceso efectivo depende también de la red y del firewall. Los perfiles de Calos no son cuentas con contraseña. Para HTTPS habría que configurar certificados y revisar expresamente los orígenes permitidos y la confianza en el proxy.

La IP Wi-Fi es dinámica; si cambia, editar `FOLIO_LAN_IP` y desplegar otra vez. No se modifican DNS, DHCP, rutas, firewall, NAT, VPN ni router. Las API dejan de responder si Docker Desktop está parado; nginx puede seguir entregando la interfaz estática y devolver 502 en `/api/`.

## Operación y datos

```sh
docker compose ps
docker compose logs --tail=100 api
docker compose stop api
docker compose up -d --wait api
sudo nginx -t
systemctl status nginx --no-pager
sudo tail -n 100 /var/log/nginx/folio.error.log
```

`docker compose stop api` no detiene nginx ni retira la web estática. `docker compose down` conserva el volumen; **`docker compose down --volumes` elimina los datos**. Los respaldos locales contienen información privada y no sustituyen una copia fuera de esta máquina. No hay limpieza automática de respaldos ni versiones web.

Para restaurar datos, detener la API, conservar el estado actual y revisar el respaldo antes de extraerlo en un volumen vacío con UID/GID 1000. No restaurar sobre una API activa ni mezclar instalaciones sin revisar sus perfiles o registros. El despliegue no busca ni migra datos de otras instalaciones automáticamente.

La API usa el usuario `node`, elimina capacidades, impide nuevos privilegios y limita recursos. Mantiene hasta cinco minutos de cierre y rotación de logs Docker. Nginx ejecuta sus workers como `www-data`; los archivos publicados tienen directorios 755 y archivos 644. `.env`, fuentes y datos no se copian a la raíz web.

## Comprobaciones

La configuración se ha probado con nginx real en puertos temporales contra las API existentes: HTML, navegación SPA, respuesta JSON, 404 de API y rechazo de orígenes no autorizados. Las suites E2E usan datos temporales y proveedores simulados; el acceso desde otro ordenador y el hardware físico requieren comprobación en su entorno.

**Migración activada el 9 de octubre de 2026.** El sitio está habilitado en nginx Ubuntu y el antiguo contenedor `folio-web-1` se ha eliminado después de comprobar la versión publicada. La API está saludable; web y API responden por loopback y por la IP LAN desde el anfitrión. Chromium carga la interfaz sin errores JavaScript. Han pasado siete pruebas E2E en la primera ejecución y la octava al repetirla con el texto de interfaz actualizado. Los respaldos y detalles finales están en [el informe global](../../NGINX-Y-DESPLIEGUE.md).

## Particularidades de Folio

Se mantienen Poppler, Calibre y los modelos OCR en la imagen de API. El primer `.env` usa traducción simulada y PDF local; configurar proveedor y `LLM_MOCK=false` para traducción real. Las claves permanecen en el servidor.

Nginx admite 210 MiB de petición, con dos archivos de hasta 100 MiB por defecto en la API. Los temporales usan ahora el almacenamiento del nginx del anfitrión y ya no están limitados por el tmpfs de 64 MiB del antiguo contenedor web. Vigilar espacio libre y concurrencia; subir `MAX_UPLOAD_MB` requiere revisar también el límite de nginx. El timeout de cuerpo es 120 segundos entre lecturas y los del proxy son 300 segundos entre operaciones, no un plazo máximo global.

Los lectores USB/MTP no son accesibles automáticamente desde Docker Desktop. Configurar y verificar el puente de dispositivos si se necesita; esta migración no cambia ese puente.
