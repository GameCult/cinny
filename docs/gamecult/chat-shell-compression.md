# chat.gamecult.org: shell compression and caching

Follow-up `ratatoskr:follow_up:chat-shell-compression`. Measured 2026-11-12 against the live
host, build `f8115609` (the `index-CAataSJe.js` bundle). The host config is
`nginx/chat.gamecult.org.conf` in `gamecult-ops`, owned by Eureka; nothing here is applied
to the host.

## What the host serves now

The 2026-10-31 probe (no Content-Encoding, no Cache-Control on `/assets/`) is stale: the
site file already carries `gzip on` for js, css, json, svg and wasm and an immutable
`Cache-Control` on `/assets/` and `/preview/assets/`. Probed with `curl -H 'Accept-Encoding: X'`.

| Resource | raw | gzip (served now) | brotli (served now) |
|---|---|---|---|
| `/assets/index-CAataSJe.js` | 3,732,771 | 956,085 | none: `br` is ignored, identity returned |
| `/assets/index-BLdKqKqx.css` | 111,267 | 19,952 | none |
| `/assets/matrix_sdk_crypto_wasm_bg-DwIieW7K.wasm` | 5,573,870 | 1,878,147 | none |
| `/` (index.html, no-cache) | 3,066 | gzip | none |

Headers: hashed `/assets/` answer `Cache-Control: public, max-age=31536000, immutable`;
`/`, `index.html`, `sw.js`, `manifest.json`, `config.json` answer `no-cache`; compressed
responses carry `Vary: Accept-Encoding` and a weak ETag. `config.json` (424 B) is below
`gzip_min_length 1024` and goes uncompressed, which is correct.

So the original ask is done. What is left is brotli, which nginx 1.26.3 here cannot serve:
`/usr/sbin/nginx -V` shows `--with-http_gzip_static_module` and no brotli module.

## What brotli buys

Level-5 gzip is what the host does per request. Offline measurement on the same files
(node `zlib`, 2026-11-12):

| File | raw | gzip 5 (live) | gzip 9 | brotli 11 | brotli vs live |
|---|---|---|---|---|---|
| main chunk `index-D0yL0Dgy.js` | 3,868,313 | 1,015,680 | 1,001,446 | 773,992 | -24% |
| crypto wasm | 5,573,870 | 1,868,282 | 1,851,108 | 1,343,595 | -28% |
| `ReactPrism-Dm2uRF4v.js` | 577,517 | 209,339 | 208,376 | 163,525 | -22% |

A cold load of the two big files falls from about 2.8 MB to about 2.1 MB on the wire; the
saving is ~0.7 MB once per hashed build per device, since assets are immutable. Every
device with the service worker cache never pays it twice. gzip 9 alone buys 1-2%, so
`gzip_static` without brotli is not worth a build step. Brotli is the whole prize, and it
needs one root step.

Cost: brotli q11 takes about 12 s for the wasm and 8 s for the main chunk on one core, so
the whole dist is roughly a minute at build time and zero CPU per request. Do not use q11
on the fly; that is why the plan is precompressed twins.

## Root list for Eureka (host)

1. `apt install libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static`
   (Debian package names; check they match nginx 1.26.3's ABI before reload; if the
   archive has no matching build, stop and tell Void, the fallback is no change).
2. In the `chat.gamecult.org` `server` block, beside the existing gzip lines:

```nginx
    brotli_static on;          # serve <file>.br when the client sends br
    gzip_static on;            # serve <file>.gz; falls back to the on-the-fly gzip above
    brotli on;                 # on-the-fly br for files with no twin (index.html, small files)
    brotli_comp_level 5;
    brotli_types text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml application/wasm;
```

   The `location ^~ /assets/` and `/preview/` blocks inherit these; they only add headers.
   No other change: the `Cache-Control` and `Vary` lines stay as they are, and
   `gzip_vary on` already makes the on-the-fly and static paths vary correctly.
3. `nginx -t && systemctl reload nginx`.
4. Install a build with twins (below) the usual way
   (`docs/gamecult/client-build-install.md`). Twins for files that are not there change
   nothing: nginx falls back to the plain file.

Rollback: remove the five lines and reload. The `.br`/`.gz` files can stay on disk, unused.

## Build side

`build-prod-dist.sh` (Void's, in `/opt/commons/handoff/ratatoskr-main-build/`) gains
`PRECOMPRESS=1`, which runs `precompress.cjs <dist>` before the manifest is written. It
writes `<file>.br` (q11) and `<file>.gz` (level 9, no mtime, deterministic for one node) next
to each js, css, wasm, json, svg, html file over 1 KiB, only when smaller than the original.
Default is off, so builds installed before the host change do not ship ~12 MB of twins that
nothing serves. The twins appear in `SHA256SUMS`; the determinism compare still applies.
Tested on `ReactPrism-Dm2uRF4v.js` (gzip roundtrip identical to the original); a full
`PRECOMPRESS=1` build has not been run because it waits on step 1.

The script is not in this repo; its placement is a standing open item of the build handoff.

## Before/after measurement

Run from any machine; `X` is the asset URL. Before = today's table above.

```sh
for ae in identity gzip br; do
  printf '%s ' "$ae"; curl -s -o /dev/null -H "Accept-Encoding: $ae" -w '%{size_download} %header{content-encoding}\n' "$X"
done
curl -sI -H 'Accept-Encoding: br' "$X" | grep -iE 'content-encoding|vary|etag|cache-control'
```

Pass: with `br` the main chunk is about 774 KB and the wasm about 1.34 MB with
`Content-Encoding: br`; with `gzip` the bytes are no larger than today; with `identity`
the file is the raw size; `Vary: Accept-Encoding` and the immutable `Cache-Control` are
still present on all three; `index.html`, `sw.js` and `config.json` still `no-cache`.
The service worker's registration and an existing session must still work (open chat on
the operator's phone, hard reload once, check the network panel's "transferred" column).
Check `/preview/assets/` the same way.
