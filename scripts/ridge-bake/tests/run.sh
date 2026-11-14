#!/bin/sh
# Usage: RIDGE_PY=<venv python> RIDGE_TILES=<tiles dir> tests/run.sh [test_ridge.py|mutate.py]
# RIDGE_WORK (cache dir) defaults to a fresh directory under $TMPDIR.
: "${RIDGE_PY:?RIDGE_PY must name the python of the baker venv}"
export RIDGE_WORK="${RIDGE_WORK:-${TMPDIR:-/tmp}/ridge-bake-work}"; mkdir -p "$RIDGE_WORK"
HERE=$(cd "$(dirname "$0")" && pwd)
exec "$RIDGE_PY" -I "$HERE/${1:-test_ridge.py}"
