#!/usr/bin/env bash
# Build this checkout as the offline demo for the standing dev preview: base /void/rat-dev/, the pretend
# homeserver, scene tier $TIER (default full). Output: ./dist, ready for the shared publisher
# (gamecult-ops scripts/publish-mind-preview.sh dist rat-dev), which owns publishing. Publishes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/sync-poses.mjs >/dev/null
VITE_PREVIEW_DEMO=1 CINNY_BASE=/void/rat-dev/ NODE_OPTIONS=--max_old_space_size=4096 nice -n 10 npx vite build
node scripts/preview-config.js "${TIER:-full}" --demo
