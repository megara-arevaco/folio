#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"

usage() {
  echo "Uso: ./scripts/deploy.sh [--lan-ip IP | --local-only]"
  echo "Despliega web, API y SQLite persistente. Publica la web en el Nginx compartido del anfitrión; requiere autenticación de administrador."
}
while (($#)); do
  case "$1" in
    --lan-ip)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      export FOLIO_LAN_IP="$2"
      shift 2
      ;;
    --local-only) export FOLIO_LAN_IP=127.0.0.1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker no está instalado." >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null 2>&1 || { echo "Arranca Docker Desktop o el motor Docker y vuelve a ejecutar el script." >&2; exit 1; }

if [[ -n "${FOLIO_LAN_IP:-}" ]]; then
  if ! ip -o -4 addr show | awk -v expected="$FOLIO_LAN_IP" '{split($4,a,"/"); if (a[1]==expected) found=1} END {exit !found}'; then
    echo "La IP indicada no está asignada a esta máquina: $FOLIO_LAN_IP" >&2
    exit 1
  fi
fi

if [[ ! -e .env ]]; then
  if [[ -z "${FOLIO_LAN_IP:-}" ]]; then
    office_interface=$(ip -4 route show default | awk 'NR == 1 {for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}')
    [[ -n "$office_interface" ]] || { echo "Indica --lan-ip IP o --local-only." >&2; exit 1; }
    export FOLIO_LAN_IP
    FOLIO_LAN_IP=$(ip -o -4 addr show dev "$office_interface" scope global | awk 'NR == 1 {split($4,a,"/"); print a[1]}')
    [[ -n "$FOLIO_LAN_IP" ]] || { echo "No se ha encontrado IP LAN; indica --lan-ip IP." >&2; exit 1; }
  fi
  cp deploy/folio.env.example .env
  printf '\nFOLIO_LAN_IP=%s\n' "$FOLIO_LAN_IP" >> .env
  chmod 600 .env
  echo "Creado .env con traducción simulada y conversión PDF local."
fi

# Validate without printing configuration: it can contain API keys.
docker compose config --quiet
# Compose no longer publishes LAN ports; read just the IP from .env without exposing secrets.
if [[ -z "${FOLIO_LAN_IP:-}" ]]; then
  FOLIO_LAN_IP=$(docker compose config --environment | awk -F= '$1 == "FOLIO_LAN_IP" {print $2}')
  FOLIO_LAN_IP=${FOLIO_LAN_IP:-127.0.0.1}
fi
if [[ ! $FOLIO_LAN_IP =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || ! ip -o -4 addr show | awk -v expected="$FOLIO_LAN_IP" '{split($4,a,"/"); if (a[1]==expected) found=1} END {exit !found}'; then
  echo "IP no asignada a esta máquina: $FOLIO_LAN_IP" >&2
  exit 1
fi
command -v nginx >/dev/null || { echo "Instala Nginx en el anfitrión antes de desplegar." >&2; exit 1; }
web_stage=$(mktemp -d)
trap 'rm -rf "$web_stage"' EXIT
echo "Construyendo API y exportando React para el Nginx compartido..."
docker compose build api
docker build --file apps/api/Dockerfile --target web --output "type=local,dest=$web_stage" .
[[ -f $web_stage/index.html ]]

was_running=false
backup_file=
resume_on_error() {
  rc=$?
  if [[ "$was_running" == true ]]; then
    docker compose start api >/dev/null 2>&1 || true
  fi
  echo "Despliegue interrumpido. Los datos persistentes se conservan." >&2
  [[ -z "$backup_file" ]] || echo "Copia de datos: $backup_file" >&2
  exit "$rc"
}
trap resume_on_error ERR

# Stop the writer before taking a consistent SQLite/jobs backup.
if [[ -n "$(docker compose ps --status running --quiet api)" ]]; then
  was_running=true
fi
if docker volume inspect folio_folio_data >/dev/null 2>&1; then
  docker compose stop api
  mkdir -p backups
  backup_file="backups/folio-$(date -u +%Y%m%dT%H%M%S)-$$.tar.gz"
  docker compose run --rm --no-deps -T api tar -czf - -C /data . > "${backup_file}.partial"
  mv "${backup_file}.partial" "$backup_file"
  echo "Copia de datos: $backup_file"
fi

echo "Arrancando API..."
docker compose up -d --force-recreate --wait --wait-timeout 180 api
echo "Instalando web y configuración en el Nginx compartido (autenticación de administrador)..."
installer=(bash "$project_dir/scripts/install-nginx.sh" "$web_stage" "$FOLIO_LAN_IP" "$(docker context show)" "$(id -u)")
if sudo -n true 2>/dev/null; then
  sudo "${installer[@]}"
elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v pkexec >/dev/null; then
  pkexec "${installer[@]}"
else
  sudo "${installer[@]}"
fi
trap - ERR
docker compose ps
echo "Despliegue terminado: http://127.0.0.1:8081"
[[ $FOLIO_LAN_IP == 127.0.0.1 ]] || echo "Oficina: http://$FOLIO_LAN_IP:8081"
echo "Los datos están en folio_folio_data. No uses 'docker compose down --volumes' si quieres conservarlos."
