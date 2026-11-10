#!/usr/bin/env bash
# The one way the dev preview is published: build origin/dev as the offline demo (previewDemo, pretend
# homeserver) and publish it in place at $PUBLISH_ROOT/rat-dev/ (served as /void/rat-dev/), keeping the
# previous publish at $PUBLISH_ROOT/.rat-dev-prev as the single rollback.
#
#   scripts/publish-dev-preview.sh            build origin/dev, publish
#   scripts/publish-dev-preview.sh rollback   swap rat-dev and the kept previous publish
#
# Env: PUBLISH_ROOT (default /srv/minds-web/void), TIER (scene tier, default full), REF (default
# origin/dev), WORK (scratch, default $TMPDIR or /tmp). The build runs from a scratch worktree, niced,
# one at a time (flock); nothing is written into the checkout it is run from. No per-sha directories.
set -euo pipefail

ROOT=${PUBLISH_ROOT:-/srv/minds-web/void}
LIVE=$ROOT/rat-dev PREV=$ROOT/.rat-dev-prev NEW=$ROOT/.rat-dev-new

if [ "${1:-}" = rollback ]; then
  [ -d "$PREV" ] || { echo "no previous publish at $PREV" >&2; exit 1; }
  rm -rf "$ROOT/.rat-dev-swap"
  mv -T "$LIVE" "$ROOT/.rat-dev-swap" && mv -T "$PREV" "$LIVE" && mv -T "$ROOT/.rat-dev-swap" "$PREV"
  echo "rolled back: $(cat "$LIVE/VERSION")"
  exit 0
fi

REPO=$(git rev-parse --show-toplevel)
exec 9>"${WORK:-${TMPDIR:-/tmp}}/publish-dev-preview.lock"
flock -n 9 || { echo "another publish is running" >&2; exit 1; }

git -C "$REPO" fetch -q origin dev
SHA=$(git -C "$REPO" rev-parse "${REF:-origin/dev}")
TREE=$(mktemp -d "${WORK:-${TMPDIR:-/tmp}}/rat-dev-publish.XXXXXX")
trap 'git -C "$REPO" worktree remove --force "$TREE" 2>/dev/null || rm -rf "$TREE"' EXIT
git -C "$REPO" worktree add -q --detach "$TREE" "$SHA"
cd "$TREE"

# node_modules: hardlink the checkout's when same filesystem and lockfile-identical, else npm ci.
if [ -d "$REPO/node_modules" ] && cmp -s "$REPO/package-lock.json" package-lock.json && cp -al "$REPO/node_modules" node_modules 2>/dev/null; then :; else
  rm -rf node_modules
  npm_config_cache=${npm_config_cache:-${WORK:-${TMPDIR:-/tmp}}/npm-cache} nice -n 10 npm ci --ignore-scripts --no-audit --no-fund
fi

node scripts/sync-poses.mjs >/dev/null
VITE_PREVIEW_DEMO=1 CINNY_BASE=/void/rat-dev/ NODE_OPTIONS=--max_old_space_size=4096 nice -n 10 npx vite build >/dev/null
node scripts/preview-config.js "${TIER:-full}" --demo
printf '%s\n' "$SHA" > dist/VERSION

rm -rf "$NEW"; cp -r dist "$NEW"
if [ -e "$LIVE" ] || [ -L "$LIVE" ]; then
  rm -rf "$PREV"; mv -T "$LIVE" "$PREV"
fi
mv -T "$NEW" "$LIVE"
echo "published ${SHA:0:8} at $LIVE (rollback: $PREV)"
