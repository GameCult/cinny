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

The repo's `config.json` is the served config. It must equal what `https://chat.gamecult.org/config.json`
serves (Ratatoskr #103); `vite build` copies it into `dist/` (`vite.config.js`, static copy of
`config.json`). Do not hand-edit `dist/config.json`.

```sh
git clone https://eureka.gamecult.org/forge/GameCult/Ratatoskr.git && cd Ratatoskr
git checkout <full-40-hex-sha>           # build a named commit, not a branch tip
npm ci                                   # .npmrc sets legacy-peer-deps and save-exact
node scripts/sync-poses.mjs              # pose catalogue and art from /opt/commons/cast-art/poses
NODE_OPTIONS=--max_old_space_size=6144 npm run build    # writes dist/
```

`sync-poses` is needed because the pose art is not committed; skip it and the build ships with no
poses. Do not use `npm run build:preview` for production: it rewrites `dist/config.json` for
preview (hash router, chosen tier and style).

The handoff build for the host is scripted outside the repo:
`/opt/commons/handoff/ratatoskr-main-build/build-prod-dist.sh <full-sha>` (see its `README.md`).
It writes `/opt/commons/handoff/ratatoskr-main-<full-sha>/{dist,SHA256SUMS,BUILD-INFO,build.log}`,
locks the files read-only, and refuses to overwrite. The folder, with the three pins
(`SHA256SUMS` sha256, `BUILD-INFO` sha256, lockfile sha256) and the node and npm versions, is what
the install request names.

Before handing off:

```sh
cd <folder>/dist && sha256sum -c ../SHA256SUMS                 # 0 failures
grep -rl 'demo.invalid\|demo-preview-token' <folder>/dist       # must print nothing
diff <(curl -s https://chat.gamecult.org/config.json) <folder>/dist/config.json   # report any difference
```

A config difference is a finding to report, not something to paper over: either live drifted or
the repo is wrong, and a ruling (Meta, for `backgroundScene.style`) says which ships.

## 2. Install (host owner, root, by hand)

Unpack beside the live release; do not touch the live directory.

```sh
R=ratatoskr-<8hex>
H=/opt/commons/handoff/ratatoskr-main-<full-sha>
cp -r $H/dist /srv/cinny/releases/$R
cmp /srv/cinny/current/config.json /srv/cinny/releases/$R/config.json    # expect no output
(cd /srv/cinny/releases/$R && sha256sum -c $H/SHA256SUMS)
```

If `cmp` reports a difference, stop and settle which config ships. If the decision is to keep
the host's config byte-for-byte, `cp /srv/cinny/current/config.json /srv/cinny/releases/$R/config.json`
and expect `sha256sum -c` to flag `config.json` only (use `--ignore-missing` and read the one line).

Note the current target first, for the rollback: `readlink /srv/cinny/current`.

Switch (atomic):

```sh
ln -sfn releases/$R /srv/cinny/current
```

## 3. Verify

- `readlink /srv/cinny/current` names `releases/$R`.
- `curl -s https://chat.gamecult.org/config.json | sha256sum` equals the release's `config.json`.
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
  `terrain` where the repo says `ridge` (#106, Meta 2026-11-11), and lacks the repo's `dings`,
  `fileZoneShare` and `registration` blocks (all off in the repo). The new keys default off or
  inert when absent, so only the style is a decision. The `cmp` in step 2 shows the drift at
  install time; Meta says which style ships.
