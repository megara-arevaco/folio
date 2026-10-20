#!/bin/sh
set -eu
if [ "$#" -eq 2 ] && [ "$1" = node ] && [ "$2" = dist/api/start.js ]; then
  node --input-type=module -e 'import { recoverStoppedInstanceLock, assertNoRestoreJournal } from "/app/packages/data-safety/src/instanceLock.mjs"; await assertNoRestoreJournal("/data"); await recoverStoppedInstanceLock("/data", true);'
fi
exec "$@"
