#!/bin/sh
# Runs npm in the MagicMirror image, so no local Node.js is needed and the Node version
# matches the one the module runs on. Examples:
#   scripts/dev.sh install
#   scripts/dev.sh run check
set -eu
IMAGE=${MM_IMAGE:-karsten13/magicmirror:v2.38.0}
cd "$(dirname "$0")/.."
exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e NODE_ENV=development -v "$PWD:/work" -w /work --entrypoint npm "$IMAGE" "$@"
