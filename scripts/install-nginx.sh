#!/usr/bin/env bash
# Privileged, bounded installation step; Docker still runs as the deploying user.
set -Eeuo pipefail
umask 022
[[ $EUID -eq 0 && $# -eq 4 ]] || { echo "Uso (administrador): $0 ASSETS IP DOCKER_CONTEXT UID" >&2; exit 2; }
project=folio
web_port=8081
assets=$(realpath -- "$1")
lan_ip=$2
docker_context=$3
deploy_uid=$4
[[ $deploy_uid =~ ^[0-9]+$ && $deploy_uid -ne 0 ]] || exit 2
deploy_user=$(getent passwd "$deploy_uid" | cut -d: -f1)
[[ -n $deploy_user && -f $assets/index.html ]] || exit 2
[[ $lan_ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || exit 2
ip -o -4 addr show | awk -v expected="$lan_ip" '{split($4,a,"/"); if (a[1]==expected) found=1} END {exit !found}'
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v nginx >/dev/null
systemctl is-active --quiet nginx

user_docker() {
  runuser -u "$deploy_user" -- docker --context "$docker_context" "$@"
}

# Serialize changes to the one nginx service across both project installers.
exec 9>/run/lock/projects-nginx.lock
flock -x 9
site="/etc/nginx/sites-available/$project"
enabled="/etc/nginx/sites-enabled/$project"
www="/srv/www/$project"
backup=$(mktemp -d "/var/backups/nginx-$project-XXXXXXXX")
chmod 700 "$backup"
had_site=false
had_enabled=false
had_current=false
old_web_running=false
[[ ! -e $site && ! -L $site ]] || { cp -a "$site" "$backup/site"; had_site=true; }
[[ ! -e $enabled && ! -L $enabled ]] || { cp -a "$enabled" "$backup/enabled"; had_enabled=true; }
[[ ! -e $www/current && ! -L $www/current ]] || { cp -a "$www/current" "$backup/current"; had_current=true; }
release="$www/releases/$(date -u +%Y%m%dT%H%M%S)-$$"

rollback() {
  rc=$?
  trap - ERR
  rm -f "$site" "$enabled" "$www/current.next"
  if [[ $had_site == true ]]; then cp -a "$backup/site" "$site"; fi
  if [[ $had_enabled == true ]]; then cp -a "$backup/enabled" "$enabled"; fi
  rm -f "$www/current"
  if [[ $had_current == true ]]; then cp -a "$backup/current" "$www/current"; fi
  nginx -t && systemctl reload nginx || true
  if [[ $old_web_running == true ]]; then user_docker start "$project-web-1" >/dev/null || true; fi
  echo "No se ha activado el despliegue. Configuración anterior recuperada; respaldo: $backup" >&2
  exit "$rc"
}
trap rollback ERR

install -d -m 755 "$www/releases" "$release"
cp -a "$assets/." "$release/"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
ln -s "$release" "$www/current.next"
mv -Tf "$www/current.next" "$www/current"
listen_line=
if [[ $lan_ip != 127.0.0.1 ]]; then listen_line="listen $lan_ip:$web_port;"; fi
sed "s/# LAN_LISTEN/$listen_line/" "$project_dir/deploy/nginx/$project.conf" > "$site"
chmod 644 "$site"
ln -sfn "$site" "$enabled"
nginx -t

# Release the old Docker listener only after authentication and configuration validation.
if [[ $(user_docker inspect --format '{{.State.Running}}' "$project-web-1" 2>/dev/null || true) == true ]]; then
  old_web_running=true
  user_docker stop --time 30 "$project-web-1" >/dev/null
fi
systemctl reload nginx
# A reload request can succeed even if the new workers fail: check the actual release.
for attempt in {1..20}; do
  if curl --noproxy '*' -fsS "http://127.0.0.1:$web_port/" | cmp -s "$release/index.html" -; then break; fi
  sleep 0.5
done
curl --noproxy '*' -fsS "http://127.0.0.1:$web_port/" | cmp -s "$release/index.html" -
if [[ $lan_ip != 127.0.0.1 ]]; then
  curl --noproxy '*' -fsS "http://$lan_ip:$web_port/" | cmp -s "$release/index.html" -
fi
trap - ERR
if user_docker container inspect "$project-web-1" >/dev/null 2>&1; then
  user_docker rm "$project-web-1" >/dev/null
fi
echo "Nginx compartido actualizado: $project en http://127.0.0.1:$web_port"
echo "Versión web: $release; respaldo de configuración: $backup"
