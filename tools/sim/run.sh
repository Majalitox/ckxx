#!/usr/bin/env bash
# Ejecuta una prueba sobre el mock de la API (Node), con una copia aislada de los scripts del BP.
# Uso: tools/sim/run.sh [test.mjs|test_xxx.mjs]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TEST="${1:-test.mjs}"
RUN="$(mktemp -d "$HERE/.run_XXXXXX")"
trap 'rm -rf "$RUN"' EXIT
cp -r "$ROOT/packs/AetheriaRPG_BP/scripts" "$RUN/scripts"
cp "$HERE/$(basename "$TEST")" "$RUN/test.mjs"
cd "$RUN"
node test.mjs
