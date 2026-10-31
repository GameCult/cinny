# Ratatoskr: target and prose map

Ratatoskr is GameCult's Matrix chat client: this fork of Cinny, forge
`GameCult/cinny` (to be renamed `GameCult/Ratatoskr`; see the cut sequence).
Void stewards it. Campaign `ratatoskr` lives in the eureka mind for now, beside
the rulings it rests on. Under `eureka-body:ruling:ruling-home-steward-mind` it
is handed to Void's mind once, by procedure, as soon as that hand-off procedure
exists (`hand_off` is parked); after that every new ruling on it is admitted in
Void's mind. Nothing here is written into Void's mind before then.

The mind holds the questions, rulings, specs, reports and verdicts. This file
holds what no document kind carries: the design truths, body facts, the model
page, rationale, the reconstructed collaboration plan, and the cut sequence.
All times are UTC.

## Why

GameCult is the only server this client talks to. A general Matrix client
treats it as one community among thousands, so the operator meets GameCult's
structure three clicks deep in an invite list of 50+ rooms (operator, `#swarm`
10-31 05:14: "The biggest pain is navigation. GameCult has a structure."). The
client should open on GameCult's estate as data: its spaces, its project rooms
grouped by steward, its Minds, and the person's own place in it. It should
also be a pleasant place to be in its own right: emotes, sound, and weather in
the background.

## Design truths (from rulings in force)

- **We own the interface, not the engine.** The fork keeps Cinny's engine
  (matrix-js-sdk, Rust crypto, sync) and replaces the whole UI; every
  user-facing string and its translation is ours, and upstream locale files
  are not the source (`gamecult-chat:ruling:we-own-the-ui-and-translation`).
- **Mobile first.** On phones, inactive elements hide, vertical space is
  cheaper than horizontal, and text never gets squeezed into narrow columns
  (`eureka-body:ruling:chat-client-base-cinny-mobile-first`).
- **The first spec** (`eureka-body:ruling:chat-client-first-spec`): an emote
  slot on every bubble (a pose id carried on the event); room and participant
  lists tiered (category, then items) and reached from the header menu, not
  side columns; participants grouped by estate (Minds, Members, Users,
  Patrons); rooms grouped by kind (general, estates, projects, work rooms);
  Minds indexed by stewardship, read from Matrix state projected from the
  stewardship records in the Minds' own minds (the minds stay the truth); one
  room per project, a Space child, with the steward joined.
- **Rooms are visible without a join dance.** No invite screen in the way; a
  room the server lets you join shows in the same list as joined ones; opening
  one shows its name and a one-tap Join; joining happens on that tap or a first
  post, never silently; no peeking (operator, `#swarm` 10-31 04:08, 04:12
  "Peeking sounds like YAGNI to me", 04:14 "One tap is a reasonable cost").
  Rooms you may not enter are refused by the server, not hidden by the client
  (Heimdall 04:10, accepted by Void 04:11 and 04:15).
- **Language.** A user's language is the BCP 47 tag in profile field
  `org.gamecult.language`, owned by the user through the client's language
  picker (`gamecult-chat:ruling:user-language-profile-field`). The client ships
  localized; people talk with stewards in their own language; rooms are made
  for a language, with no per-language mirrors
  (`gamecult-chat:ruling:multilingual-client-stewards-language-rooms`). One
  host Mind sits in a language room, Weksa for `#pt-br`
  (`gamecult-chat:ruling:language-room-one-host-weksa`). The first person this
  must work for is a non-English, non-technical patron (placeholder
  `patron-pt1`) whose account we set up and walk through login
  (`gamecult-chat:ruling:patron-in-his-own-language`).
- **Push.** `gamecult-chat:ruling:chat-push` rules out native mobile push for
  now; Web Push to the installed web app is a different thing and is open
  (question `ratatoskr:question:pwa-web-push`).
- **Collaboration is recorded, not chatted.** Work spanning Minds belongs in
  Atlas (`eureka-body:ruling:atlas-records-collaborative-work`). Atlas is not
  deployed, so the plan below is its interim home; Atlas imports it later.

## Body facts

Probes run by Imagination on 2026-10-31, session `self-2026-10-29-eureka`.

1. **Branch.** `void/gamecult-theme-and-project-nav` is `b8e696c8` over main
   `1e6412ed` (v4.12.8), 2 commits, 14 files, +1153/-32 (686 of it lockfile):
   a GameCult theme as default, member drawer hidden by default, bubble
   layout, and steward grouping in `src/app/pages/client/space/Space.tsx`
   (`useStewardGroups` at 429-437, group headers at 505-524) over
   `useSpaceJoinedHierarchy` (409). Read by `git diff`.
2. **Live estate shape** (Synapse on Yggdrasil, read as `admin` over the
   client API, counts only). Root Space `#gamecult:gamecult.org`, room version
   12, has 9 children: 8 rooms and the `Projects` sub-Space. `Projects` has 52
   children; 50 readable rooms, all room version 12. Server `/hierarchy` from
   the root returns 59 rooms, 2 of them spaces. **Every room's join rule is
   `invite`**; none is world-readable. 50 rooms carry `org.gamecult.steward`
   with content `{mind, repo, source, steward: <mxid>}`. The root carries
   `org.gamecult.stewardships`: Mind localpart to list of `Org/Repo`.
3. **Consequence of 1 and 2.** Project rooms are invite-only and Members are
   invited, not joined (gamecult-ops `runbooks/gamecult-chat-host-yggdrasil.md`
   146-158: "Members and every Mind are invited; the steward alone joins").
   So a Member's project rooms are pending invites. Void's grouping reads
   `useSpaceJoinedHierarchy` and a per-room state event that an invitee cannot
   read, so for a typical Member it groups nothing and the rooms stay in the
   invite list. This is the operator's "three clicks deep" complaint, seen from
   the data.
4. **Provisioning contract.** gamecult-ops
   `scripts/synapse-accounts-hand-managed.py` writes the rooms and both state
   events from the Minds' stewardship documents; each project room's alias is
   `#<repo lowercased>` (runbook 146-150). This is the only place the client
   can learn a not-yet-joined room's steward today: hierarchy `canonical_alias`
   joined to the root `org.gamecult.stewardships`. Follow-up
   `ratatoskr:follow_up:stewardships-carry-room-ids` asks the projection to
   name room ids so the client stops leaning on the alias convention.
5. **Sync and storage** (`src/client/initMatrix.ts`). The client uses
   matrix-js-sdk 41.7.0 with `IndexedDBStore` (`web-sync-store`, 15-19) and the
   Rust crypto store, and `startClient({ lazyLoadMembers: true })` (43-47): v2
   `/sync`, no sliding sync, no custom filter or `initialSyncLimit`. A cold
   start is therefore an IndexedDB load plus an incremental sync from the
   stored token, not a full initial sync.
6. **Server sync support.** `/_matrix/client/versions` on Synapse 1.164.1
   (127.0.0.1:8834) advertises `org.matrix.simplified_msc3575: true`:
   simplified sliding sync (MSC4186) is available. Cinny 4.12.8 does not use it.
7. **Shell delivery.** `https://chat.gamecult.org/assets/index-DWIvG3QT.js` is
   served at 3,736,520 bytes with no `Content-Encoding` even when gzip and br
   are offered, and with no `Cache-Control` (only `ETag`/`Last-Modified`). The
   service worker (`src/sw.ts`, 158 lines) handles only `install`, `activate`,
   a session `message`, and authenticated media `fetch` (79-158); the
   `vite-plugin-pwa` config sets `injectionPoint: undefined`
   (`vite.config.ts` 101-113), so nothing is precached.
8. **No push path.** `src/sw.ts` has no `push` or `notificationclick` handler;
   no code subscribes through `PushManager`; the only pusher the client sets is
   the email pusher (`src/app/features/settings/notifications/SystemNotification.tsx`
   22-40). Notifications and sounds fire only from a live page:
   `src/app/pages/client/ClientNonUIFeatures.tsx` 79-129 (invites) and 131-258
   (messages: `RoomEvent.Timeline` at 181-235, `new window.Notification` at
   156, `notification.ogg` played at 175-178). Nothing in `src/` listens for
   `visibilitychange` or calls `retryImmediately`.
9. **Sygnal WebPush** (matrix-org/sygnal `docs/applications.md`, read
   2026-10-31; the page itself is marked partly out of date): a `webpush` app
   takes `vapid_private_key`, `vapid_contact_email`, optional
   `allowed_endpoints` and `ttl`; the client's pusher `data` carries
   `endpoint`, `auth`, `p256dh` and optional `default_payload`; the push
   carries `room_id`, `room_name`, `sender_display_name`, `content`, unread
   counts and so on; browsers need a visible notification for each push
   (`events_only` avoids event-less pushes).

10. **Baseline at `dd88424e`** (Yggdrasil, `ygg-verify.sh`, image
    `node:22-bookworm`, `npm ci --ignore-scripts`): `vitest run` passes (1
    file, 5 tests, Void's steward grouping); `vite build` succeeds, `dist/` 61
    MB with source maps, main chunk 3,739,716 bytes, Rust crypto wasm
    5,573,870 bytes, `dist/sw.mjs` 1.66 kB. `tsc --noEmit` fails at base with
    793 errors in 246 files (455 of them TS2614, named imports from
    `matrix-js-sdk` 41.7.0 not resolved), so typecheck is not a usable gate as
    is; a cut gates on zero errors in the files it adds and no rise in the
    total.

Not probed: phone frame times, the real resume timeline on the operator's
Android Chrome install (needs her device or remote DevTools), the Rust crypto
wasm size, and the router base under `/preview/` (its `config.json` sets
`hashRouter.basename` to `/`).

## Why the PWA resumes slowly (diagnosis, moderate confidence)

Android freezes a backgrounded installed web app and later discards it. On a
**discard**, returning is a full cold boot: 3.7 MB of uncompressed JS over a
phone link with no precache (fact 7), Rust crypto wasm init, the IndexedDB
store load, then a catch-up `/sync` over every room since the stored token
(fact 5). On a **freeze without discard**, the in-flight long-poll is dead, and
the SDK only notices on its own timers because the client never nudges it on
`visibilitychange` (fact 8). The catch-up sync grows with the number of rooms
and the swarm's chat volume, which is exactly where sliding sync helps
(fact 6), but the first two costs are cheaper to remove and should be measured
first. Without Web Push, a frozen page cannot notify at all, which is the
second half of the operator's report.

## Model page: the estate

| Kind | Named by | Over time | Who decides |
|---|---|---|---|
| Stewardship | `<instance>:stewardship:<repo>.n<seq>` in each Mind's mind | sequence advances on hand-over | the operator and the Minds; the minds are the truth |
| Estate projection | `org.gamecult.stewardships` on the root Space; `org.gamecult.steward` per project room | re-PUT on every provisioning run | gamecult-ops provisioning script (Eureka's slice) |
| Estate room list | the server's `/hierarchy` of the root Space for this user | changes with Space children and the user's invites and joins | Synapse (membership and join rules); the client derives |
| Room membership | the user's `m.room.member` | join on tap or first post | the user |
| Navigator view | derived per render | never stored | the client's estate index |

## Authority map for the navigator

- **Owner:** one estate index in the client (`src/app/features/estate/`):
  `buildEstate()` is pure, `useEstate()` feeds it. It decides what rooms the
  person sees, in which tier and group, and with what membership affordance.
- **Inputs:** the paged server `/hierarchy` of the root Space; root Space
  state `org.gamecult.stewardships`; the person's membership per room from the
  client store; unread and selection atoms for emphasis only; the `m.direct`
  list for the direct-messages tier.
- **Outputs:** an ordered list of tiers (one per root room group and per
  sub-Space, plus Direct), each holding steward groups or rooms, each room
  marked joined, invited or joinable.
- **Derived:** steward group labels (Mind display names); counts; collapsed
  state is per-device UI state only.
- **Demoted or dead:** the sidebar rail and its account-data ordering
  (`useSidebarItems`) are dead; `useSpaceJoinedHierarchy` no longer decides
  what is listed; Void's per-room steward reader is deleted, not kept beside
  the index.
- **Shared paths:** every nav slot (home, direct, space routes) renders the
  same navigator; tapping Join and sending a first post both go through
  `mx.joinRoom`; deep links into a room still resolve through the existing
  room routes.

## Reconstructed collaboration plan (Atlas import)

Planned in `#swarm` and `#minds` on 2026-10-31 and then lost to scroll. Status
as of 2026-10-31 ~15:00.

**Who holds which part**

| Part | Holder | Status | Evidence |
|---|---|---|---|
| The client: integration, navigator, emote slot, sound hookup, background canvas | Void (steward) | theme and steward grouping on branch; nothing else built | `void:stewardship:gamecult_-cinny.n1`; `#swarm` 10-31 14:54 Void report |
| Dings earcons: motif per event kind, one stable instrument per Mind | Aqua | not rendered: render env blocked, then .NET SDK installed and Faust scouted; AquaSynth PR #1 (Linux Faust loader, `faust-loader-platform-aware`) merged at 3b43b7bd | `aqua-body:follow_up:chat-s410-416`, `aqua-body:follow_up:chat-s410-416-render-env`, `aqua-body:resolution:follow_up.chat-s430-430.n1`, forge AquaSynth pull 1 |
| Ambient soundscape for the client | Aqua | idea only; no design recorded | operator `#swarm` 10-31 08:32 ("Motifs for everything"), `eureka-body:ruling:atlas-records-collaborative-work` |
| Background math, in CultMath: the public `fbm` gap, Phacelle erosion's Lipschitz bound, any new GLSL mirrors | Libby (steward of CultLib, which owns CultMath; holds `cultmath-tapes`) | sources located; nothing built | `#swarm` 10-31 06:34 and 06:46 Libby; `libby-body:follow_up:cultmath-ts-noise-absent`; `#swarm` 04:22 Libby accepts `cultmath-tapes` |
| Background scene and render: the raymarched terrain, the tree-and-squirrel intro scene, lighting and atmosphere, march and TAA tuning on the site-ground framework | Nibu (steward of Aetheria, whose volumetric nebula and cloud shaders she owns: `Raymarching/CloudShader.shader`, `Volumetric.cginc`) | proposed by the operator; not yet taken up by Nibu | operator to Self, 10-31: "If we want to spread the work around, Nibu owns the nebulae so she has shader expertise." |
| Animated bubbles, flourishes, corner avatar and XP bar | Void, with Kiko's offer on juice | advice only | `#swarm` 10-31 03:59 Kiko and Void, 06:45 Void |
| Attention bubbles | Eureka (Huginn heartbeat publishes), Void (render), Heimdall (scope rules) | advice only | `#swarm` 10-31 04:00 Eureka, 04:02 Heimdall |

**Agreements**

- Dings are pre-rendered clips shipped as static assets, no synth in the
  browser: `dings/<mxid-localpart>/<motif>.ogg` plus a small manifest; an
  unknown sender falls back to a neutral ding; ogg or mp3, not wav (Void
  `#minds` 03:19, Aqua 07:41). The set is motif times instrument, and the
  instrument says who spoke (operator 03:18, Eureka 03:19). Events that sound:
  a mention, a DM, an invite, a message in an unmuted room; mentions and DMs
  loud, ordinary messages quiet; everything else silent (Void `#minds` 03:19).
  The operator wants far more than four motifs (08:32). The instrument per
  Mind belongs in a typed document on the Mind side, not hardcoded (Eureka
  03:19, advice). Aqua's ear check comes before anything is called done, and
  the operator's ear is ground truth (Aqua 07:41). Browsers block audio until
  the first click, so the first ding after a fresh load may be silent.
- The background has its own canvas and budget, separate from the bubble
  flourishes; capped at 30 fps, paused when hidden; under reduced motion one
  static frame; an adaptive step-down (Aqua 04:17, Void 04:18 and 04:22).
- The background is an infinite raymarched terrain: CultMath noise plus the
  Phacelle erosion filter, in the shader (operator 04:18 "painter's algorithm",
  05:24 "all we need is noise", 05:25 erosion, restated by the operator to
  Self on 10-31: "use CultMath noise and erosion filter running in the shader
  to have an infinite terrain. We can just raymarch that instead"). Voronoi
  and Apollonian are dropped (05:24).
- Yggdrasil is the scene's centre (operator to Self, 10-31: "Yggdrasil should
  be the star of the show now, so really the camera should just pull back a
  bit when you login and the personas should be orbiting the tree, dancing
  around each other in accordance with their activity"). On login the camera
  pulls back from the tree; there is no separate intro to cut away from. The
  Personas orbit the tree and move around each other by their live activity.
- One activity vocabulary drives both sound and motion: Aqua's activity-kinds
  grammar (`aqua-body:follow_up:chat-s431-432`, "enumerate the kinds of agent
  activity in typed state") is the shared contract between Aqua's motifs and
  Nibu's orbits, not two vocabularies. The live feed behind it is the same
  typed state the swarm dashboard projects
  (`eureka-body:ruling:swarm-dashboard-first-thing2-surface`, Libby;
  `libby-body:follow_up:chat-s354-359`): Run documents, the heartbeat trace.
  What reaches the client is a member-safe projection: kind, Mind, time and
  intensity, never briefs or mind contents. Matrix presence and typing cover
  humans and are too coarse for Minds. Where the feed comes from is
  `ratatoskr:question:activity-feed-source`.
- The scene renders in two passes, not one loop (operator to Self, 10-31:
  "The tape optimized solid surface march should run really fast, i imagine,
  way faster than the volumetric version, so they should not be one loop").
  Pass 1, the solid-surface march (terrain, tree, squirrel), sphere-traces
  with the field's Lipschitz bound and interval tile culling, at its own
  resolution, and writes depth. Pass 2, the volumetric atmosphere march on
  the site-ground framework (reduced resolution, TAA), is bounded by pass 1's
  depth, so it marches only up to the surface hit. Each pass has its own
  budget and its own measurement. Nibu owns both passes.
- The web math path is CultLib's own: HLSL source lowered by dxc and
  SPIRV-Cross to WebGL2 GLSL ES (`packages/cultmath/shaders/CultMath.glsl`,
  `.Phacelle.glsl`; `tools/glsl/build-glsl.sh`), and C# CPU math through
  .NET wasm, with parity presumed for now (operator 06:23, 06:48; Libby
  06:34). No TS or WGSL port. The gamecult.org site ground already
  concatenates `CultMath.glsl` in `ground.js` and runs an interval-culled,
  TAA-reprojected per-pixel march (CultLib `docs/cultmath-interval-ground-cut.md`,
  spec `cultmath-interval-ground-cut-site-ground.r3`): that framework is the
  base, not new tape work.
- Gaps go to the owner: a plain public `fbm` (only `fbm_grad`, `span_fbm`,
  `af_fbm` exist) is added in CultMath, not in the client
  (`libby-body:follow_up:cultmath-ts-noise-absent`; Libby 07:57 "tell me what
  you need and I'll fill it at the library").
- Mood and flourish ride as metadata on the event, never guessed from text;
  bounded per-frame budget; reduced-motion fallback (Void 03:59, Kiko 03:59).
- XP is two numbers, never one: a cosmetic, labelled game bar fed by things
  worth doing, and contribution credit shown only once a real measure exists
  (Void 06:45, with Nibu and Kiko).

**Open items**

- Libby: the raymarch step bound needs the field's Lipschitz bound. CultMath
  tracks `SNOISE_LIPSCHITZ` for noise; erosion's bound is unknown and must be
  probed before the march is trusted.
- Libby: public `fbm` in CultMath, with its GLSL mirror.
- Nibu (once she takes it): the terrain scene, lighting and atmosphere, and
  march and TAA tuning on the site ground's framework at a phone budget;
  waits on Libby's `fbm` and the erosion bound. Then the intro scene in the
  same world.
- Aqua: render the first earcon set once Faust builds in her sandbox; then the
  instrument-per-Mind list and the manifest; then the soundscape design.
- Aqua and Nibu: agree the activity vocabulary once (Aqua's grammar), so
  motifs and orbits read the same kinds.
- Void: the navigator (next cut); the Dings hook at
  `ClientNonUIFeatures.tsx` 131-258; the background canvas after Libby's shader.
- Eureka: compression and caching for the shell on the chat host
  (`ratatoskr:follow_up:chat-shell-compression`); the stewardship projection's
  room ids; a Web Push gateway if the operator picks it.

## File zone: albums

Rulings: `ratatoskr:ruling:persona-file-sharing-zone`,
`ratatoskr:ruling:file-zone-albums-one-level`,
`ratatoskr:ruling:file-zone-looks-like-file-sharing`; under them
`eureka-body:ruling:mind-notes-via-personas` (a Self speaks only through her
Persona) and `eureka-body:ruling:live-mind-sessions` (the Persona organ will
become a live session; the album document below does not depend on how her
reply is produced). Eyes facts: `docs/research/2026-10-31-persona-file-zone.md`
on `ratatoskr/research-atmosphere`.

A Mind's Self makes files (Aqua: `render-thruster-v1` to `-v5`, each a flat
folder of three WAVs of 0.4 to 0.6 MB beside build junk). She shares them as an
**album**: one level, a name, a short note, a set of files, and optionally the
earlier album it follows. Ratatoskr shows each Persona's albums as a
file-sharing space; Matrix is the storage and the fallback for other clients.

### Shape, and why

- **One room per Persona is her file zone**, created by provisioning with
  room type `org.gamecult.file_zone` (`creation_content.type`, immutable, and
  returned as `room_type` by `/hierarchy`, which `buildEstate` already reads).
  The zone owner is the room's steward, carried in its `m.space.child` entry as
  for project rooms.
- **An album is a thread.** The root is an `m.text` whose body is the
  human-readable fallback (name, counts, note) and whose content carries
  `org.gamecult.album`: `name`, `digest`, `files`, `kinds`, `bytes`, `follows`
  (the root event id of the album it follows, or null) and `request_id`. Each
  file is an `m.audio`/`m.image`/`m.video`/`m.file` event in that thread
  (`m.thread`, `is_falling_back`, `m.in_reply_to` the root), which every
  client already renders through authenticated media.
- **`follows` is a content field, not a relation.** Probe (below): Synapse
  refuses a thread off an event that carries `m.relates_to` ("Cannot start
  threads from an event with a relation"), so a root that `m.reference`d its
  predecessor could not hold its own files.
- **Rejected:** MSC3089 trees (stalled since 2021, no client or server
  support); a directory served by nginx (no access check exists, and it would
  be a second store beside Matrix); posting albums as threads in the
  conversation room (Ratatoskr runs with matrix-js-sdk `threadSupport` off,
  `initMatrix.ts:44`, so thread replies land in the main timeline and one
  album floods the room); turning `threadSupport` on (Ratatoskr has no thread
  panel, so replies would vanish from view).

### Model page: albums

| Kind | Named by | Over time | Who decides |
|---|---|---|---|
| Outbox album | directory `/var/lib/mind-<slug>-outbox/<album>/` | written and replaced by her Self | her Self (only writer) |
| Album choice | an `albums[]` item of her Persona's reply | per turn | her Persona |
| Share request | `gamecult.persona.chat_share_request.v1` | one per album per turn | the Persona organ emits; the mouth acts |
| File zone | room alias `#files-<slug>:gamecult.org`, room type `org.gamecult.file_zone` | created once | provisioning (`synapse-accounts-hand-managed.py`) |
| Album | thread root carrying `org.gamecult.album` in her zone | immutable once posted; a revision is a new album that `follows` it | the mouth posts, as her account |
| Zone view | derived per render from the zone room's threads | never stored | the client |

### Authority map: write path (cuts `album-share-mouth`, `album-share-persona`)

- **Owner:** the mouth (`Bifrost tools/persona-matrix-mouth.mjs`) owns
  turning one share request into one album in her zone. The zone room is the
  record of what has been shared: the mouth keeps no memory of shares.
- **Inputs:** the share request (album name, announce room, note, follows);
  the album directory, read as user `bifrost` through a read ACL; her zone
  room's threads (`GET /_matrix/client/v1/rooms/{id}/threads`) and the
  album's thread (`/relations/{root}/m.thread`); her brake.
- **Outputs:** the root, one event per file, one announce line in the named
  room (her note, the album name and count, a `matrix.to` link to the root),
  and a `chat_send_receipt` (root event id, or a refusal).
- **Idempotency is derived from Matrix:** txn ids are `request_id`,
  `request_id-f<i>`, `request_id-ann` (probe: a repeated txn returns the same
  event); beyond the txn window, a root in her zone with the same `name` and
  `digest` is the album, and its thread's filenames say which files still need
  posting, so a retry resumes rather than duplicates.
- **Forbidden writers:** the Self never touches Matrix and holds no Matrix
  credential; the Persona organ never uploads and never reads file contents;
  nothing but the mouth posts albums; no cache or ledger of "shared" albums
  exists outside the zone room.
- **Demoted:** the Persona's `say` stays text only; a link to a file in her
  sandbox is no longer how a Mind shares.
- **Shared paths:** every album, whatever the Mind or turn, goes through the
  one share handler; a retry and a first attempt run the same code.

### Outbox and limits

- `/var/lib/mind-<slug>-outbox`, owned `mind-<slug>-self`, mode 0750, ACL
  `u:mind-<slug>:r-x` (her Persona lists it) and `u:bifrost:r-x` (the mouth
  reads it), with the same default ACLs. Created by
  `install-mind-units-yggdrasil.sh`; `mind-self@.service` gains
  `ReadWritePaths=/var/lib/mind-%i-outbox` (her state directory is 0700 and
  `ProtectSystem=strict` makes the rest of `/var` read-only).
- An album is one level: regular files only, named by
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; a subdirectory, symlink, dotfile, a file
  not owned by `mind-<slug>-self`, or an unreadable file rejects the album
  with its name (files are opened `O_NOFOLLOW` and checked with `lstat`, so an
  album cannot reach another Mind's outbox or the mouth's own state).
- Per file at most 50 MiB (live Synapse `max_upload_size: 50M`; the mouth
  uploads on loopback `127.0.0.1:8834`, so nginx's `50m` does not apply); per
  album at most 100 files and 500 MiB. Kind by extension: wav, ogg, oga, opus,
  flac, mp3, m4a are `m.audio`; png, jpg, jpeg, webp, gif are `m.image`; mp4,
  webm are `m.video`; anything else is `m.file` (`application/octet-stream`).
- `digest` is SHA-256 over the sorted list of (filename, size, SHA-256 of
  content); files post in bytewise filename order.

### Authority map: zone view (cut `file-zone-view`)

- **Owner:** one zone model in the client, a pure `buildAlbums()` over the
  zone room's thread roots and an album's thread, fed by one hook; it decides
  which albums show, in what order, and which events are an album's files.
- **Inputs:** `/hierarchy` (`room_type` marks zones; the estate index already
  holds it); `GET /v1/rooms/{id}/threads` paged (probe: lists roots with
  their reply counts); `/relations/{root}/m.thread` for one album.
- **Outputs:** albums (title, file count and kinds, date, `follows` chain) and
  one album's files.
- **Derived:** files are the zone owner's media replies only; others' replies
  are comments; the `follows` chain is display-only grouping.
- **Forbidden writers:** the timeline does not decide what an album holds; no
  local store of albums.
- **Mount:** the navigator lists zones as their own branch kind from
  `buildEstate`; opening one shows the zone view, with "Open as room" as the
  fallback to the plain timeline (where the flood is accepted).
- **Media:** every fetch goes through `mxcUrlToHttp` with authentication and
  the service worker's bearer header (`sw.ts:107`); probe: download without a
  token is 401. Synapse answered a `Range` request with the whole body (200),
  so playback fetches whole files, as `AudioContent` already does.
- **Parts:** the album list is our own folds component (no library needed);
  images through `react-photo-album` (81 KB unpacked) and
  `yet-another-react-lightbox` (253 KB unpacked), loaded only by the zone view
  chunk; audio reuses `AudioContent` with one album queue (play all, next,
  previous). The audio preview is the mel surface below
  (`ratatoskr:ruling:audio-preview-mel-surface`), not a waveform, so
  `@wavesurfer/react` is not adopted. No file-manager
  library: chonky is abandoned and its fork archived, and the zone is
  read-only.

### Audio preview: the mel surface

- **The mouth computes the sidecar at upload**, for every Mind, not Aqua's
  tooling on export. One writer serves all eight Minds; AquaSynth's features
  serve one Mind and would make the Self a second writer of a file the mouth
  must pair by name. Album events are immutable, so the sidecar ships in the
  write path (`album-share-mouth`), or albums shared before it never get one.
- **What it is:** a 256 x 64 8-bit grayscale PNG (time across, 64 mel bands
  down, low band at the bottom): a mono mix, Hann window, FFT 2048 at the
  file's rate, 256 frames spread evenly over the whole file, log power from
  -80 dB to the file's peak mapped onto 0..255. A few KB; built with Node's own
  `zlib` and an in-module FFT, no new dependency. A PNG because the browser
  decodes it natively straight into a WebGL texture (`texImage2D` from an
  `ImageBitmap`), with no parser of ours on the phone.
- **Scope:** PCM WAV (16-bit, 24-bit, 32-bit float), which is what Aqua makes.
  Other audio posts with no sidecar and its tile shows a plain placeholder;
  decoding compressed audio in the mouth waits for a Mind that shares it.
- **How it travels:** its own upload, referenced from the audio event's
  content as `org.gamecult.mel: { url, bands: 64, frames: 256, db_floor: -80 }`.
  Not inline data (about 22 KB of base64 on every event every client syncs),
  and not an event of its own (other clients would show it as a stray file,
  and the view would pair it by filename). The digest covers the album's own
  files, not sidecars.
- **The shader:** one WebGL2 component in the zone view chunk: a 256 x 64
  grid (about 16k vertices) displaced in the vertex shader by the texture,
  normals from neighbouring texels, a lit swept ribbon with time along the
  sweep, mel across, energy as height and colour, and the playhead as a
  uniform. Nibu owns the shader (she holds the scene shaders); Void
  integrates; CultMath is not needed. Tiles never get a context each
  (browsers cap live contexts at about 16, and the background already holds
  one): one shared offscreen context renders each tile's still once into an
  `ImageBitmap`, cached per mxc for the session; only the open file animates.
  Gate: the open file's frame time measured on the operator's phone with the
  background running, before the cut is called done.

### Probe (2026-10-31, throwaway Synapse v1.164.1 container on Yggdrasil, removed after)

| Claim | Result |
|---|---|
| Upload path | `POST /_matrix/media/v3/upload` 200 with mxc; `/_matrix/client/v1/media/upload` 404 |
| Same txn id twice | same event id |
| File as thread reply with `is_falling_back` | accepted |
| Root carrying `m.reference`, then a thread off it | refused: "Cannot start threads from an event with a relation" |
| `GET /_matrix/client/v1/media/download` with token / without | 200 / 401 |
| `Range: bytes=0-99` | 200, whole body |
| `GET /_matrix/client/v1/rooms/{id}/threads` | lists the root with count 1 |

## Cut sequence

`estate-navigator` is specced (`ratatoskr:cut_spec:cut-estate-navigator.r1`).
Each later cut is one line, with what it waits on.

- `resume-fast`: precache the app shell in the service worker, nudge sync on
  `visibilitychange`, and measure cold and warm resume on the operator's phone
  before and after; waits on nothing; runs beside `estate-navigator` in its
  own worktree, and pairs with the ops follow-up on compression.
- `pwa-web-push`: service worker `push` and `notificationclick` handlers, a
  `webpush` pusher registered with VAPID keys, and a self-hosted Sygnal on the
  chat host; waits on `ratatoskr:question:pwa-web-push`.
- `sliding-sync`: move the client to simplified sliding sync (MSC4186), which
  the server already offers; waits on `resume-fast`'s measurements showing
  catch-up sync dominates.
- `dings`: per-Mind earcons through the manifest at the existing notification
  hook, and the same motifs in push notifications; waits on Aqua's renders.
- `emote-slot`: the pose-id emote on every bubble and the picker; waits on
  `estate-navigator` (shared header work).
- `participant-tiers`: participants tiered by estate in the header menu, Minds
  indexed by stewardship; waits on `estate-navigator`.
- `language`: our own strings and translations, the `org.gamecult.language`
  picker, and the walk-through login for `patron-pt1`; waits on
  `estate-navigator`.
- `terrain-background`: the raymarched CultMath noise and Phacelle terrain on
  the site ground's march and TAA framework, in its own canvas and budget, as
  two passes (solid-surface sphere trace writing depth, then the volumetric
  atmosphere bounded by it), each measured on a phone; Nibu on the scene and
  both passes, Libby's CultMath underneath, Void
  integrating; waits on Libby's `fbm` and the erosion Lipschitz probe (both in
  CultLib), then a phone measurement.
- `yggdrasil-scene`: the tree and squirrel at the centre of the terrain world;
  on login the camera pulls back from the tree, and it may play during the
  cold start or resume sync but never holds the client up; Nibu on the scene,
  Libby on any CultMath it needs, Void integrating, Aqua's soundscape under
  it; waits on `terrain-background`.
- `orbiting-personas`: Personas orbit the tree and dance around each other by
  live activity, from the shared activity vocabulary; waits on
  `yggdrasil-scene`, Aqua's activity-kinds grammar, and
  `ratatoskr:question:activity-feed-source`.
- `bubbles-and-juice`: animated bubbles and mood flourishes from event
  metadata, the corner avatar and the cosmetic XP bar; waits on `emote-slot`.
- `attention-bubbles`: per-person attention bubbles from Huginn's typed
  attention document, scoped to room members; waits on Huginn publishing it.
- `album-share-mouth` (Bifrost): the mouth turns a `chat_share_request` into
  an album in her zone (upload, mel sidecar for WAV, thread, announce line,
  receipt, resume from Matrix), against a fake homeserver and a temp outbox;
  specced (`ratatoskr:cut_spec:cut-album-share-mouth.r1`); waits on nothing.
- `album-outbox-ops` (gamecult-ops): the outboxes and their ACLs, the Self
  unit's `ReadWritePaths`, a line in the Self seed text saying how to share,
  the zone rooms in `synapse-accounts-hand-managed.py` (room type, steward in
  the space child, one alias file per Mind) and `MATRIX_FILE_ZONE_<SLUG>` in
  `mouth.env`; waits on `album-share-mouth` (its variable names) and on
  `ratatoskr:question:file-zone-audience`.
- `album-share-persona`: Huginn's Persona organ lists her outbox albums in
  her turn, her reply gains `albums[]` (name and follows constrained to the
  listed albums, room to her rooms), and the organ sends each as a
  `chat_share_request`; waits on `album-share-mouth` merging (it owns the
  document) and on `album-outbox-ops` deployed; if the live-session rebuild (`eureka-body:ruling:live-mind-sessions`)
  lands first, the same document is emitted from wherever her reply is decoded.
- `file-zone-view`: zones as their own branch kind in the navigator, the
  album list, an album's files with image grid and lightbox, an album queue
  over `AudioContent`, and the mel surface (Nibu's shader); waits on
  `estate-navigator` and on albums existing; gated by a phone frame-time
  measurement.
- `rename-ratatoskr`: package name, app name and branding, manifest and
  titles, the `/preview/` path and its deploy, and every in-repo `cinny`
  reference that is ours (not upstream engine paths); waits on Void's forge
  rename of `GameCult/cinny` to `GameCult/Ratatoskr`
  (`eureka-body:ruling:chat-client-named-ratatoskr`), and the campaign's repo
  list moves with it.
