#!/bin/sh
set -eu
# Every container command shares this kernel lock, including offline maintenance.
# The kernel releases it on exit, SIGKILL and Docker/host shutdown.
exec flock --exclusive --nonblock --no-fork /data/.folio-container.lock sh /app/scripts/container-command.sh "$@"
