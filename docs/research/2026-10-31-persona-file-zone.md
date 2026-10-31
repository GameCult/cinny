# Eyes facts: ratatoskr:ruling:persona-file-sharing-zone
Date 2026-10-31. Facts only. Clone: Ratatoskr branch ratatoskr/estate-navigator @2c04bbe (package.json v4.12.8, matrix-js-sdk 41.7.0, react/react-dom 18.2.0, folds 2.7.2, @tanstack/react-virtual 3.2.0, jotai 2.6.0, blurhash 2.0.4). No wavesurfer/plyr/gallery/lightbox deps present.

## A. Libraries (npm registry + GitHub API, 2026-10-31)
| pkg | latest (date) | licence | weekly dl | unpacked | React peer | TS types | repo / issues / pushed |
|---|---|---|---|---|---|---|---|
| chonky | 2.3.2 (2022-01-08) | MIT | 13,622 | 1.9 MB | >=16 | yes | TimboKZ/Chonky, 791 stars, 73 open, last push 2024-01-09, not archived |
| @aperturerobotics/chonky (fork) | 0.3.1 (2024-11-10) | MIT | - | 2.0 MB | >=16 | yes | npm says "This fork has been discontinued, check https://chonky.io/"; aperturerobotics/react-chonky ARCHIVED, pushed 2025-12-16 |
| @cubone/react-file-manager | 1.35.0 (2025-12-23) | MIT | 5,276 | 460 KB | >=18 | no types in package metadata | Saifullah-dev/react-file-manager, 158 stars, 20 open, pushed 2026-04-20 |
| @svar-ui/react-filemanager | 2.6.0 (2026-06-03) | MIT | 17,717 | 453 KB | >=18 | yes | svar-widgets/react-filemanager, 85 stars, 14 open, pushed 2026-06-03 |
| react-photo-album | 3.6.2 (2026-10-17) | MIT | 208,682 | 81 KB | 18 or 19 | yes | igordanchenko, 789 stars, 1 open, pushed 2026-10-26 |
| yet-another-react-lightbox | 3.33.0 (2026-10-30) | MIT | 932,033 | 253 KB | 16.8-19 | yes | igordanchenko, 1334 stars, 1 open, pushed 2026-10-30 |
| wavesurfer.js | 8.0.4 (2026-10-30) | BSD-3-Clause | 1,961,649 | 1.66 MB | none (vanilla) | yes | katspaugh, 10,460 stars, 11 open, pushed 2026-10-30 |
| @wavesurfer/react | 1.0.14 (2026-10-30) | BSD-3-Clause | 493,805 | 13.7 KB | 18.2 or 19; wavesurfer >=7.7.14 | yes | katspaugh/wavesurfer-react, 134 stars, 2 open |
| react-h5-audio-player | 3.10.2 (2026-03-07) | MIT | 135,727 | 338 KB | 16.3-19 | yes | lhz516, 695 stars, 28 open, pushed 2026-07-29 |
| plyr | 3.8.5 (2026-10-06) | MIT | 650,059 | 3.5 MB | none | no | sampotts/plyr, 29,995 stars, 1 open; npm deprecation text: "Plyr is deprecated and receives security updates only. Use Video.js 10" |
| plyr-react | 6.0.0 (2025-12-20) | MIT | 92,005 | 60 KB | >=16.8; plyr ^3.7.7 | yes | - |
| react-plyr | 2.2.0 (2019-03-11) | MIT | 1,566 | 66 KB | 16.x only | no | stale |
| @vidstack/react | 1.15.7 (2026-10-06) | MIT | 583,055 | 3.3 MB | 18 or 19 | yes | vidstack/player, 3,707 stars, 1 open; npm deprecation text: "security fixes only until January 2028. Use Video.js 10" |
| @videojs/react (Video.js 10) | 10.2.0 (2026-10-22) | Apache-2.0 | not queried | 7.1 MB (peer list of many provider pkgs) | 18 or 19 | - | videojs/v10 repo reports archived=true, licence NOASSERTION (GitHub API) |
| media-chrome | 4.19.4 (2026-10-23) | MIT | 5,517,836 | 5.1 MB | web components | yes | - |
| react-modern-audio-player | 2.4.4 (2026-09-06) | MIT | 9,077 | 392 KB | >=18 | yes | - |
| react-image-gallery | 2.1.2 (2026-02-26) | MIT | 457,354 | 123 KB | 16-19 | yes | - |
Not verified by Eyes (not read from source/docs): mobile/touch behaviour, accessibility, gzipped bundle size (unpacked size only), whether each takes a caller-supplied list. Registry metadata only. @cubone and chonky are file-manager UIs whose README APIs take a files array (not read here). chonky-v2 npm name: not found.
Cinny already depends on react-range (AudioContent.tsx:5).

## B. Ratatoskr/Cinny media (paths under C:\cl-wt\eyes-files, now removed)
- Dispatch: src/app/components/RenderMessageContent.tsx: Image :186, Video :206, Audio :239 (MAudio + AudioContent), File :255, Location :259.
- src/app/components/message/content/: AudioContent.tsx (210 lines; custom player: react-range sliders :97,:167, hidden <audio controls={false} autoPlay> :205, hooks useMediaPlay/Seek/Volume/Loading :73-77), FileContent.tsx (313; ReadTextFile :84, PDF/text viewers), ImageContent.tsx (261), VideoContent.tsx (241), ThumbnailContent.tsx.
- Viewers: src/app/components/image-viewer/ImageViewer.tsx, Pdf-viewer/PdfViewer.tsx, text-viewer/TextViewer.tsx. No gallery, files-tab or room-files view found (grep gallery/lightbox: only those viewers, UrlPreviewCard, UserHero etc.).
- Auth: src/app/hooks/useMediaAuthentication.ts:3-11 returns true if unstable_features org.matrix.msc3916.stable or versions include v1.11. src/app/utils/matrix.ts:281-300 mxcUrlToHttp passes useAuthentication to mx.mxcUrlToHttp; downloadMedia (matrix.ts ~:305) does fetch(src) with comment "authenticated by service worker". src/sw.ts:107 MEDIA_PATHS = /_matrix/client/v1/media/download and /thumbnail; fetch handler :134-160 adds `Authorization: Bearer <token>` for GET requests from clients with a registered session (SW registered src/index.tsx:31-42). Only those two paths are intercepted.
- Each content component fetches the whole file as a Blob and uses URL.createObjectURL (AudioContent.tsx:57-62, FileContent.tsx:186, ImageContent.tsx:96); not streamed/range. Encrypted-room media decrypted client-side (decryptFile/downloadEncryptedMedia).
- Because the SW rewrites auth on plain GETs, any <img>/<audio>/<video src> pointing at a /v1/media/download URL gets a bearer header (when SW controls the page).
- Ratatoskr addition: src/app/features/estate/ (EstateNavigator, buildEstate, useEstate, joinEstateRoom).

## C. Matrix-native representations
- MSC3089 "File tree structures": matrix-spec-proposals PR #3089, state open, not merged, labels proposal / A-Client Server / needs-implementation, last updated 2021-09-10. matrix-js-sdk contains src/models/MSC3089TreeSpace.ts and MSC3089Branch.ts (+ specs, event type defs in src/@types/event.ts). GitHub code search: 0 hits for msc3089 in cinnyapp/cinny, element-hq/element-web, element-hq/synapse. (Trees are client-side convention on spaces/rooms with room type org.matrix.msc3089.tree; no Synapse server support found.)
- Element/Cinny treat rooms as timelines; Element has a per-room "Files" panel (FilePanel, from training knowledge, not verified here); Ratatoskr has none.
- Plain m.audio/m.file/m.image/m.video events in a dedicated room render natively in Ratatoskr (section B). Custom state (manifest) renders in no client; Ratatoskr src/app/components/AccountDataEditor.tsx and features/common-settings/developer-tools/StateEventEditor.tsx are raw JSON editors only.
- Live server (curl https://matrix.gamecult.org/_matrix/client/versions, 2026-10-31): versions end ...v1.14,v1.15,v1.16,v1.17 (so v1.11 authenticated media present); org.matrix.msc4108=false. Synapse latest release v1.164.1 (2026-10-28). Upload limit nginx client_max_body_size 50m (matrix.gamecult.org.conf).

## D. Serving (gamecult-ops main, nginx/chat.gamecult.org.conf and matrix.gamecult.org.conf)
- chat.gamecult.org: static only. /srv/cinny/current at root, /srv/cinny/preview/ at /preview/, /srv/element-web/current-root at /element/. No proxy, no auth_request, no per-user dirs. CSP header frame-ancestors 'self' only; X-Frame-Options SAMEORIGIN.
- matrix.gamecult.org: /_matrix/ and /_synapse/client/ proxy to 127.0.0.1:8834; /_matrix/(federation|key) and /_synapse/(admin|mas) return 404; everything else 404; proxy_read_timeout 600s.
- No existing location serves a Mind outbox directory. Matrix media is members-only/bearer-authenticated via Synapse; a directly served directory would have no access token check unless nginx auth_request/other gate is added (not present). Yggdrasil filesystem not inspected.
