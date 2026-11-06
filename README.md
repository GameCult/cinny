# Ratatoskr

> Not the OBS media receiver that Muninn docs also call Ratatoskr (github.com/GameCult/Ratatoskr, Rust): this is the GameCult chat client, a Matrix web client.

GameCult's Matrix chat client, a fork of [Cinny](https://github.com/cinnyapp/cinny).
It opens on GameCult's estate (spaces, project rooms grouped by steward, Minds,
and your own place in it) instead of an invite list. Mobile first.

**Live now:** the Cinny engine (matrix-js-sdk, Rust crypto, sync) under a
Ratatoskr UI: branding, GameCult theme, estate navigation, pose portraits
(opt-in setting), a background scene and soundscape (opt-in, off by default).
**Planned:** see [`docs/gamecult/ratatoskr-target.md`](docs/gamecult/ratatoskr-target.md)
for the target and cut sequence. Internal names that are protocol or stored
state (`cinny_*` localStorage keys, the `in.cinny.room.power_level_tags` event
type, `CINNY_BASE`) are unchanged on purpose.

Entry points: `src/app/` (client UI), `src/app/features/scene/` (background
scene), `src/app/features/soundscape/` (audio socket), `harness/` (estate
drive scripts), `scripts/gen-brand.mjs` (regenerates the logo and icons).

## Upstream
Ratatoskr is based on Cinny by Ajay Bura and contributors, licensed AGPL-3.0.
Cinny's own README, desktop app and releases live at
<https://github.com/cinnyapp/cinny>. We do not ship its releases or images.

## Developing
See [HACKING.md](HACKING.md). Contribution notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Self-hosting
Build with `npm ci && npm run build` and serve `dist/` with your webserver.

* The default homeservers and explore pages are defined in [`config.json`](config.json).
* Serving the assets needs redirects to `index.html`. Examples:
[netlify](netlify.toml), [nginx](contrib/nginx/ratatoskr.domain.tld.conf),
[caddy](contrib/caddy/caddyfile). Without them you can
[enable hash routing](config.json) (`hashRouter`); URLs then carry `/#/`.
* To deploy on a subdirectory, rebuild with the `base` path set, either in
[`build.config.ts`](build.config.ts) or through `CINNY_BASE`
(for example `CINNY_BASE=/app/ npm run build`).

## License
Ratatoskr is a fork of the Cinny project  
Copyright © 2024–present Ajay Bura  
https://cinny.in  

Cinny is licensed under the GNU Affero General Public License, 
Version 3 of the License (AGPL-3.0-only).
You may obtain a copy of the License at https://www.gnu.org/licenses/agpl-3.0.html