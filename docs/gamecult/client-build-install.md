# Ratatoskr client: build, install, verify, roll back

Who does what. The steward (Void) builds and hands off; Void holds no root and does not deploy.
Eureka installs on the chat.gamecult.org host, which is Eureka's. This page is the shared
procedure. Nothing here is run by the build step against the live host.

## Facts about the host

- Web root: `/srv/cinny/`. `current` is a symlink to one directory under `releases/`; the web
  server serves `current`. Releases are `releases/ratatoskr-<8hex>` (older ones are
  `ratatoskr-nemesis-<8hex>`). Previous releases stay on disk; that is the rollback.
- The client is static. `config.json` sits in the release root beside `index.html` and is read
  at load. Cinny's `Dockerfile` and `docker-nginx.conf` are upstream's container path, not the
  chat.gamecult.org path.
- Check the pointer before anything else: `readlink /srv/cinny/current`.

## 1. Build (steward)

Two builds exist, and they treat `config.json` differently.

**By hand (the repo's config).** `vite build` copies the repo's `config.json` into `dist/`
(`vite.config.js`, static copy of `config.json`). Ratatoskr #103 made the repo file the intended
served config, and #106 set `backgroundScene.style` to `ridge`; the served file has not caught up
(see Open). Do not hand-edit `dist/config.json`.

```sh
git clone https://eureka.gamecult.org/forge/GameCult/Ratatoskr.git && cd Ratatoskr
git checkout <full-40-hex-sha>           # build a named commit, not a branch tip
npm ci --ignore-scripts                  # .npmrc sets legacy-peer-deps; skips husky's prepare hook
node scripts/sync-poses.mjs              # pose art is not committed; this also rewrites the tracked
                                         # src/app/components/message/pose/catalogue.json
NODE_OPTIONS=--max_old_space_size=6144 npm run build    # writes dist/
```

Skip `sync-poses` and the build ships with no poses. Do not use `npm run build:preview` for
production: it rewrites `dist/config.json` for preview (hash router, chosen tier and style).

**The handoff build (what the host installs).**
`/opt/commons/handoff/ratatoskr-main-build/build-prod-dist.sh <full-sha>` (see its `README.md`)
writes `/opt/commons/handoff/ratatoskr-main-<full-sha>/{dist,SHA256SUMS,BUILD-INFO,build.log}`,
locks the files read-only and refuses to overwrite. The dist carries the repo's `config.json` at
that sha (BUILD-INFO `config_json_source`, `config_json_sha256`); there is no separate pinned copy.
Its live check always runs: it fetches the served config and compares it byte for byte with the
repo's. A difference prints the diff and stops the build. `ALLOW_CONFIG_DRIFT=1` builds anyway and
BUILD-INFO records `config_json_live_check: DIFFERS ...` and `config_json_live_sha256`, so the
handoff states which config differs and the installer decides. From Yggdrasil the public name does
not resolve: pass `LIVE_CURL_ARGS="--resolve chat.gamecult.org:443:127.0.0.1"`.
The folder, with the three pins (`SHA256SUMS` sha256, `BUILD-INFO` sha256, lockfile sha256) and
the node and npm versions, is what the install request names.
Every build stamps its commit into `index.html` (`scripts/buildSha.js`): `<meta name="build-sha" content="<40-hex>">`,
with `-dirty` appended when the tree had uncommitted changes and `unknown` when there was no git. An explicit `BUILD_SHA` names the commit where there is no git; where git
sees a changed tree it is suffixed `-dirty` too, so it never vouches for code it does not hold. The handoff
build refuses a dist whose stamp differs from the sha it was asked for, and prints the stamp in its block.
To read it from anywhere: `curl -s https://chat.gamecult.org/ | grep -o 'build-sha" content="[^"]*'`.

Before handing off:

```sh
cd <folder>/dist && sha256sum -c ../SHA256SUMS                 # 0 failures
grep -rl 'demo.invalid\|demo-preview-token' <folder>/dist       # must print nothing
# from Yggdrasil the public name may not resolve; --resolve points it at the local server
diff <(curl -fsS --resolve chat.gamecult.org:443:127.0.0.1 https://chat.gamecult.org/config.json) <folder>/dist/config.json
```

A config difference is a finding to report, not something to paper over: either live drifted or
the repo is wrong, and a ruling (Meta, for `backgroundScene.style`) says which ships.

## 2. Install (host owner, root, by hand)

Note the rollback target first: `readlink /srv/cinny/current`.

Unpack beside the live release; do not touch the live directory. The target must not exist, or
`cp -r` nests `dist` inside it.

```sh
R=ratatoskr-<8hex>
H=/opt/commons/handoff/ratatoskr-main-<full-sha>
test ! -e /srv/cinny/releases/$R
cp -r $H/dist /srv/cinny/releases/$R
cmp /srv/cinny/current/config.json /srv/cinny/releases/$R/config.json
(cd /srv/cinny/releases/$R && sha256sum -c $H/SHA256SUMS)
```

`cmp` is a drift check, not a pass check. Live has no trailing newline; the repo's file has one,
so even equal content differs. Read the difference (`diff` the two) and settle which config
ships. To keep the host's config byte-for-byte, as past installs did,
`cp /srv/cinny/current/config.json /srv/cinny/releases/$R/config.json`; `sha256sum -c` then flags
`config.json` only (read that one line; `--ignore-missing` does not hide a mismatch).

Switch (a single symlink swap; `ln -sfn` unlinks then links, so there is a moment with no link):

```sh
ln -sfn releases/$R /srv/cinny/current
```

## 3. Verify

- `readlink /srv/cinny/current` names `releases/$R`.
- `curl -s https://chat.gamecult.org/config.json | sha256sum` equals `sha256sum /srv/cinny/releases/$R/config.json`.
- Load https://chat.gamecult.org/ and hard-refresh (the service worker, `sw.js`, can hold the
  previous assets). Sign-in card shows, the background scene draws, the browser console has no
  page errors, a poses/asset request returns 200 and not index.html.

## 4. Roll back

Point `current` at the release noted before the switch. Live at the time of writing is
`ratatoskr-nemesis-9b9b495d`:

```sh
ln -sfn releases/ratatoskr-nemesis-9b9b495d /srv/cinny/current
```

Hard-refresh to clear `sw.js`. Do not delete the failed release; leave it for diagnosis.

## Open

- The served config (checked 2026-11-12) is not the repo's: it says `backgroundScene.style`
  `terrain` where the repo says `ridge` (#106, Meta 2026-11-11), lacks the repo's `dings`,
  `fileZoneShare` and `registration` blocks (all off in the repo), and has no trailing newline.
  The new keys default off or inert when absent, so only the style is a decision. Meta says which
  style ships. Until the served file is replaced, every handoff build stops at the live check
  unless `ALLOW_CONFIG_DRIFT=1` is set (section 1).
