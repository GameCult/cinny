# Files desk: Commons and per-Persona file zones, two designs compared

Status: **decided: Option A, Matrix as the single authority** (Meta, #swarm 2026-11-13 14:44Z: "Let's try matrix shaped"). Design only; no Files desk code is merged and nothing is deployed. Option B (the host service) is parked, not deleted: Eureka's branch `eureka-self/commons-host` at `a391960d` has no PR and a Soul verdict of NOT READY with fixes owed, and is woken only if Meta later wants a real file store. PR #143 (B's cut 1 in this repo) is closed unmerged. Items marked **UNKNOWN** are not verified; **Q-E** are questions for Eureka, **Q-M** for Meta.

### Eureka's answers (`/opt/commons/handoff/commons-matrix-notes-20261113.md`, read 2026-11-13; final answers folded in 2026-11-13)

- **Upload cap (Q-E1, read).** Synapse 1.164.1; the repo template `homeserver.yaml` has `max_upload_size: 50M` and the nginx vhost `client_max_body_size 50m`; the live runtime file is root-only and was not read. No per-room or per-user per-file cap exists; `media_upload_limits` is a per-user time-window quota. `GET /_matrix/client/v1/media/config` returns `m.upload.size` to an authenticated client, which is what the client reads. Raising the cap takes the config line, a Synapse restart and nginx at least as large.
- **Posting (Q-E1, read).** A Self holds no Matrix credentials, so the publisher needs its own bot account and token (a MAS compatibility token via `mas-cli`). It uploads with `POST /_matrix/media/v3/upload` and sends `m.room.message` with `msgtype` `m.file` or `m.image`. The Persona mouth sends `m.text` only today, so file events are new for it too.
- **Room (Q-E3, answered).** The Commons room is `#commons:gamecult.org` (create type `org.gamecult.file_zone`, unencrypted, membership by the estate Space, publisher bot at power level 50). Provisioning and push muting are Eureka's.
- **Cap (Q-E1, answered).** 50 MiB per file. The client reads it live from `m.upload.size`, not from this document.
- **Poster (Q-E1, answered).** The publisher posts as the owning Mind: each file appears under the Mind whose tree it came from, not under a generic bot.
- **Final marker (Q-E2, answered).** A handoff document is final when a sibling `NAME.final` holds its sha256; the publisher watches for that, posts once, and carries `org.gamecult.publish.replaces` (prior event id and sha256) on a later final version.
- **Range (Q-E4, unverified).** Whether Synapse media honours `Range` has not been checked against a live mxc. Playback therefore stays on the blob download until it is.
- **Edited-doc stale copies:** a redacted file's media persists unless purged; the publisher dedupes by sha256.

Source: Meta, #swarm 2026-11-13 14:28Z and 14:40Z; ruling `ratatoskr:ruling:persona-file-sharing-zone` (a browsable, previewing collection per Persona; the Self writes to her outbox, her Persona decides what is shared, the Self never holds Matrix credentials).

## What exists on Matrix today (the base A must fit)

Read from this repo at dev `8ba407cd`:

- **Zone = a room** whose `m.room.create` type is `org.gamecult.file_zone` (`isFileZone.ts`), or one listed in config `fileZoneRooms`. One per Mind, `#<mind>-files:<server>`, found by alias or by the carried id in the root Space's `org.gamecult.stewardships` (`mediaRoom.ts`, `MediaRow.tsx`); rendered as the Media row of each Mind's group.
- **Album = a thread root** (a text event; its `body`, or its latest `m.replace` edit, is the title); **file = a thread reply** with `msgtype` `m.audio|m.image|m.video|m.file` (`buildAlbums.ts`). A redacted event or an `m.replace` is never a file. Loose room messages are not shown.
- **Read** = `GET /rooms/{id}/threads` and `/relations/{root}/m.thread`, every page, 100 per request, at most 20 pages per endpoint (`useAlbums.ts`, `readPages.ts`; a capped read shows a note in the list). Unencrypted rooms only.
- **Write** = `sendShareSet` (`shareSet.ts`, behind `fileZoneShare.enabled`): a root, then one thread reply per file, content from `getMsgContent` with `info.sha256`.
- **Media** = authenticated Matrix media fetched to a blob (`downloadMedia` in `FileContent.tsx`): so the "media element cannot send a header" problem that Option B needed a ticket for is already solved this way, at the cost that a file is fully downloaded before it plays.
- **Receipts** = `org.gamecult.file_received` from a Mind's mouth after it fetches and verifies the sha256 (`docs/file-zone-mind-contract.md`); the mouth enforces the Mind's membership in the room.

Option A is an extension of this, not a second system.

## The two options

**A. Matrix is the only authority.** Commons is one more file-zone room; each Mind's zone is the room she already has. Audience is room membership. Upload is the ordinary Matrix upload. Folders are albums (thread roots). A small publisher service with its own Matrix account posts allowlisted handoff documents into the Commons room. The Files desk is a view over file events in those rooms.

**B. The host service.** A file host on Yggdrasil serves allowlisted directories (`GET /index`, `GET /file`, a capped `PUT`), authenticated by Matrix OpenID; the client browses it as a tree. Written out in full below the line.

|                            | A: Matrix only                                                                                         | B: host service                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Authorities                | one (Matrix: identity, audience, storage, audit)                                                       | two (Matrix for identity, the host for files and access)                          |
| Audience                   | room membership and power levels                                                                       | the host derives a role from Matrix identity and enforces it again                |
| Audit of writes            | the event `sender`, kept by the homeserver                                                             | the host's own log                                                                |
| Overwriting someone's file | impossible: events are immutable and only the sender's own edit counts; a redaction is a steward's act | host rule, host code                                                              |
| Upload size cap            | the homeserver's `m.upload.size`, global, 50 MiB (Eureka)                                    | the host's own, chosen freely                                                     |
| Type allowlist             | not enforceable by the homeserver; client-side courtesy, steward redaction                             | enforced by the host (sniffed)                                                    |
| What is browsable          | what was posted (published or uploaded)                                                                | what is on disk under the allowlist, live                                         |
| Mind-written handoff docs  | a publisher posts them once, when final (below)                                                        | the host serves the tree                                                          |
| Per-Persona zone           | the existing Media room; the Self's outbox reaches it through the mouth, as the ruling says            | a `shared/` directory the host serves                                             |
| Folders                    | albums; nesting by path in the album title                                                             | real directories                                                                  |
| Mind fetch                 | unchanged (mouth, room id and event id, receipts)                                                      | a second route the mouth would need                                               |
| Media playback             | blob download, as today; no seeking before the whole file arrives                                      | ranges and a ticket, or the same blob                                             |
| New moving parts           | a room, a publisher                                                                                    | a host service, OpenID verification, CORS, tickets, path containment, rate limits |

## Recommendation: A (decided)

Confidence: high on the authority question (it agrees with Meta's ruling, with Eureka's lean, with the standing ruling that the Self never holds credentials while her Persona decides what is shared, and with the fact that everything built so far reads Matrix); moderate on the details below, which Eureka's answers can change.

What A gives up, stated plainly:

- **A live view of what is on disk.** Only what was published or uploaded appears. A handoff doc that was never marked final is not in the Commons.
- **Files over the homeserver's upload cap.** B had no Matrix limit; A has exactly one.
- **A server-side type allowlist.** Under A a member can upload any type the homeserver accepts; the client shows a refusal for types it does not want, and stewards redact. If a strict allowlist matters, a gating bot (post, check, redact) would have to exist, and it is a second authority again.
- **Seeking inside a large audio or video file** until Matrix media supports ranges for the client (**UNKNOWN**; the blob route is what runs today).
- **Hierarchy beyond the album level** as a native structure; see Folders.

What it buys: one identity, one audience, one audit trail, immutable files, existing receipts and the mouth's fetch, and no new service to keep secure.

## Option A in detail

**Rooms.** Commons is a room with create type `org.gamecult.file_zone`, alias `#commons:gamecult.org`, join rule `restricted` to the estate Space so members join without an invite and Minds are invited, history `shared`, unencrypted (the zones are, and `info.sha256` is written only there). Power levels: `events_default` 0 so members post; `redact` and `state_default` at steward level. The room is muted for push by provisioning: file posts are thread replies, which can raise unread counts and notifications (**UNKNOWN** under this server's push rules), so the room must not shout. Per-Persona zones are the rooms Eureka already provisions; nothing new.

**Folders.** Four ways to have folders on Matrix, in order of preference:

1. _Albums are folders; nesting is a path in the album title_ (`handoff/2026-11`, `cast-art/poses`). Zero wire change: `buildAlbums` already reads it, and the client groups albums by title path as a pure view. Cost: a thread root per folder, and the rule that a folder's root is posted once by whoever opens the folder. **Recommended.**
2. A `org.gamecult.file.path` key on each file event. Gives a real tree with files anywhere; needs every poster to write it and every client to honour it; other Matrix clients ignore it and show a flat thread.
3. A room per folder, in a Space. Native hierarchy and per-folder audience; heavy (a room is a membership, a sync entry and provisioning each) and it multiplies the sync load on a phone.
4. A state event per folder (`org.gamecult.file_folder`). Mutable folder metadata (title, order), writable only at steward level; useful later if folders need descriptions, not needed for a first cut.

**Albums in each Mind's room** are the same mechanism: a Mind's Media room holds that Mind's albums, the Commons holds the shared ones. The Files desk is the same view over either room; a zone differs only by room, not by code.

**The publisher.** A small service on Yggdrasil with its own Matrix account (a bot account that posts as the owning Mind, per Eureka's answer above). The Self never holds this account; the publisher holds it. It owns the allowlist.

- **When it posts.** Handoff documents are edited in place, so mirroring every save would spam the room with drafts. The rule (Eureka's lean, adopted): **post once, when the document is marked final**; a later final version posts again with a `replaces` relation to the earlier event. "Final" is a sibling `NAME.final` holding the document's sha256 (answered Q-E2); the client must not know.
- **Allowlist.** Lives on the publisher: a list of source roots and patterns, read by the publisher only. `handoff-private` is not on it and the publisher never lists, reads or posts from it. The client holds no path to anything on disk.
- **The event.** A file event in the thread of the folder's album, built the way `getMsgContent` builds them (`msgtype`, `body`, `filename`, `url` from the media repo, `info.mimetype|size|sha256`), plus one extra key `org.gamecult.publish`: `{ source, sha256, replaces? }` where `source` is a path relative to the allowlisted root, never absolute, and `replaces` is the event id of the version it supersedes.
- **`replaces`, not `m.replace`.** `m.replace` is the stock edit relation, but Ratatoskr's `buildAlbums` deliberately never treats an edit as a file, several clients do not render an edited file, and an edit hides the earlier version. A custom key keeps both events as files; the view shows the latest of a chain and a "N earlier versions" row under it, and other Matrix clients see two ordinary file posts. A chain is read from the events themselves (each carries its `replaces`), not from a table, and a `replaces` counts only when its event has the same sender as the event it names, so nobody else in the thread can fold a file away.
- **Idempotence.** The publisher's own state (a typed CultCache document of `source`, `sha256`, `event_id`) says what it posted; if that is lost, it rebuilds by reading its own events back from the room (`org.gamecult.publish.source` plus `sha256`) rather than guessing. The same `sha256` never posts twice.
- **Receipts and fetch** work unchanged: the event is an ordinary file event in a file-zone room, so a Mind's mouth can fetch it by room id and event id (5 MiB cap there) and tick `fetched for`.

**Uploads (approved for members and Minds).** The ordinary Matrix upload, through the composer pipeline and `ShareSet`. The host rules Eureka gave map onto Matrix as follows:

| Host rule                                  | Under A                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| only under an `uploads/` subtree           | an album (folder) named `uploads/...`; the client offers upload only there (and in a Mind's own zone)             |
| never overwrite Mind-written handoff files | free: other people's events cannot be replaced; a duplicate name is just another post in the thread               |
| size cap                                   | the homeserver's `m.upload.size`, shown from `MediaConfigLoader`; the client refuses a larger file before sending |
| type allowlist                             | client-side only; see "gives up"                                                                                  |
| explicit flag to overwrite                 | no overwrite exists; a new version is a new post, optionally with `replaces` set by the same sender               |
| audit log with the Matrix id               | the event `sender`                                                                                                |

What A adds to `ShareSet`: sharing into an existing album ("add files", listed as not built in `docs/file-zone.md`), progress per file, cancel, and per-error refusal messages written against the SDK's `MatrixError` (`M_TOO_LARGE`, `M_FORBIDDEN`, `M_LIMIT_EXCEEDED`) instead of host codes. The draft refusal table of Option B's upload flow carries over with those codes. **UNKNOWN:** whether the SDK exposes upload progress and abort for media (it does for `uploadContent` with a progress callback; the composer already shows progress, `state/upload.ts`).

## What each costs on the phone

Under both, the phone design is the same shape (one column, rows 56 px or more, hidden controls, in-place preview; see the Option B sections below, which are written against the host but whose layout applies).

- **A, new cost:** the Commons room is one more room in sync and it must be muted; albums and files are read to a cap of 20 pages of 100 per endpoint (a Commons past that shows a truncation note); a folder tree is a title-path grouping, so a deep tree is a long list of albums with breadcrumbs, not true directories; a file plays after a full download (small audio and images are fine; a 40 MB clip is not).
- **A, no cost:** no second sign-in, no ticket, no CORS, no new fetch layer, no host-unreachable state beyond the homeserver's own. The album list, album view, share panel and receipts exist and are tested; the view is their extension.
- **B, new cost:** every screen is a second client against a second service with its own errors, token refresh and unreachable state; media needs the ticket or the blob; the tree and preview are new UI.
- **B, benefit:** a tree that is live and complete, ranges, and no Matrix size limit.

## Changes to Eureka's host work

Under A the paused service is not built, and most of its list disappears:

- **Dropped:** `/index`, `/file`, `PUT`, OpenID verification pinned to the server name, CORS, path containment and sniff rules, tickets, the `uploads/` write rules, the role response, the per-path audit log (Q-E3, Q-E4, Q-E6, Q-E7, Q-E8 to Q-E11 of the Option B list).
- **Kept:** the Commons allowlist decision (Q-E1 of that list), moved to the publisher: which roots, and that `handoff` is only ever published through the final-marker rule, never browsed.
- **New:** (1) provision the Commons room (type, alias, restricted join to the estate Space, power levels, push muted); (2) the publisher: account, allowlist, final-marker rule, media upload, posting into folder threads, the `org.gamecult.publish` key, idempotence from its own events; (3) confirm the homeserver upload cap and whether the account may post file events from Yggdrasil (**Q-E1**, asked on the PR); (4) the per-Persona path stays the one already specified (`album-outbox-ops`: outbox, Persona decision, mouth post), so the `shared/` convention of Option B is retired.

## Cuts under A

Status 2026-11-14 (dev da822e9e plus the size-refusal cut): built: folders by album title path with navigation and breadcrumb (#147), pagination (#148), version folding (#149), add-to-album with named refusals (#150), Stop for a send in flight, replaces loops shown, freshest last event on add (#151), and the pre-send size refusal: a file larger than the server's `m.upload.size` is named and left unsent before any upload or album root, and a server stating no cap refuses nothing. **Not built: the Commons entry row** (item 1 below, found by `#commons:gamecult.org` or the carried `media.commons` id through `lookupMediaRoom`, behind a dark `filesDesk.enabled` flag; neither the row nor the flag exists in the code). It waits on Eureka's Commons room.

1. **Commons entry**: a Commons row in the navigator (like `MediaRow`, found by alias or carried id), opening the room's album view. Flagged, no new data layer.
2. **Pagination** of albums and files in `useAlbums` (done, PR #148).
3. **Folders by title path** and the album list grouped by it.
4. **Versions**: read `org.gamecult.publish.replaces`, show the latest of a chain with the earlier versions folded under it (done, PR #149).
5. **Add files to an existing album**, with per-file progress, cancel and the refusal messages above (the upload flow). Done: adding to an open album and the three refusal messages (PR #150); Stop for a send in flight is in too (PR for follow-up `files-desk-release-146-and-send-cancel`): it cancels the running upload through `onPromise` and `mx.cancelUpload`.

PR #143 (Option B cut 1: contract types, host client, fake host) is **held**; under A it is not needed and would be closed. Its Soul pass found, and a revived B would have to close, an unvalidated `host` that could send the bearer to the wrong origin, hostile-looking entry names beyond separators, loose numeric checks and missing CSP and `Content-Disposition` headers in the fake.

## Not in scope

The Mind-side fetch (the mouth's); encrypted rooms; deletion and rename by this client; search across zones; any permission model of our own beyond Matrix room membership and power levels.

## Open questions

**Eureka:** answered; see "Eureka's answers" at the top. Still open on Eureka's side: Range support (Q-E4) and the live runtime `max_upload_size`.

**Meta:**

- **Q-M1.** Commons audience: members and Minds as proposed; Users and Patrons never, or later?
- **Q-M2.** Is a Persona's zone visible to all members or to her stewards and Minds? (The Matrix zone's audience question, `ratatoskr:question:file-zone-audience`, is the same fork.)
- **Q-M3.** May Users or Patrons upload if they are ever let in?
- **Q-M4.** Names: "Files" for the view, "Commons" for the shared room.
- **Q-M5.** A type allowlist is not enforceable under A without a gating bot; is a client-side refusal plus steward redaction enough?

---

# Option B in full (kept for the comparison; superseded in part by Option A above)

The sections below were written against the host service. Where they speak of a host, a role, a ticket, a token, `/index` or `/file`, they are Option B. The phone layout, the zone table and the refusal wording carry over to A with the Matrix equivalents given above.

### What exists, and what this adds

|          | Matrix file zone (`docs/file-zone.md`, built)                                | Files desk (this page)                                                                                            |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Storage  | Matrix media in a `#files-<mind>` room, albums as threads                    | Directories on Yggdrasil, served by a small host                                                                  |
| Listing  | thread roots, `buildAlbums`                                                  | `GET /index?path=`                                                                                                |
| Unit     | album of posted files                                                        | file in a directory tree                                                                                          |
| Strength | marks (keep / fix / drop), receipts (`fetched for`), any Matrix client works | whole trees without N uploads, no Matrix size limit, `/opt/commons` material becomes visible to people on a phone |
| Entry    | Media row per Mind (`MediaRow.tsx`)                                          | Files row (below)                                                                                                 |

They do not compete. The Matrix zone stays where a file needs a mark or a receipt (Aqua's listening kits); the Files desk is for browsing and fetching what is already on disk. Neither replaces the other, and the Files desk does not write Matrix events. The ruling left "Matrix media plus a listing versus a served directory" open; this page is the served-directory half, built beside the Matrix half already live.

### Zones (host)

| Zone             | Contents                                                     | Who sees it                                                    |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Commons          | a curated tree of `/opt/commons`                             | members and Minds                                              |
| Persona `<slug>` | what that Persona has chosen to share from her Self's outbox | **Q-M:** all members, or the Persona's stewards and Minds only |
| handoff-private  | `/opt/commons/handoff-private` (0750)                        | never: not a zone, not listed, not a path the host resolves    |

Layout of `/opt/commons` today (read 2026-11-13): `backlog` (755, per-Mind backlog md and summary.json), `bin`, `cast-art` (setgid, group-writable: poses, busts), `handoff` (setgid, group-writable, 92 entries of briefs, patches, receipts, dings, kits), `handoff-private` (0750, ACL), `opt` (toolchains, root-owned), `situation` (0750, setgid), all `nobody:nogroup`. **`handoff` is not a publishable tree:** it holds ops notes, custody receipts (`bifrost-appsecret-custody-receipt-*`) and patches written for Minds, with no sticky bit. Serving it wholesale shows secrets-adjacent notes to every member and lets any Mind with group write change what a phone user sees. The Commons zone is therefore an allowlist of roots (candidate: `cast-art`, `backlog`, and a new `commons/` directory Minds publish into on purpose), not `/opt/commons` itself. **Q-E:** which roots; whether `handoff` ever, and if so through a reviewed `published/` subdirectory.

Per-Persona source is the outbox from `ratatoskr:follow_up:album-outbox-ops-and-persona-specs`: `/var/lib/mind-<slug>-outbox`, owned by `mind-<slug>-self`, 0750, ACL read for `mind-<slug>` and the host user. The Self writes there; the Persona decides what is shared. Making that decision a filesystem fact (a `shared/` subdirectory the Persona's turn populates by copy or hardlink, the host serves only `shared/`) keeps the host dumb: it never learns what "decides" means. **Q-E:** `shared/` subdirectory versus a per-file marker.

### Phone-first UI (host)

Phone width is the design width; desktop adds the navigator beside it (as `Desk` does in `Router.tsx`). Vertical space is cheap, so a screen shows one thing and hides what is not in use.

- **Entry.** A `Files` row pinned in the navigator beside `DeskEntry` and `MindMedia`: one at the estate level (Commons) and one inside each Mind's group (her zone), same `NavItem` anatomy as `DeskEntry`, dim when the zone has no items. Route `/files/:zone/*path`, sibling of `DESK_PATH`.
- **List.** One column. Row = icon or thumbnail, name (truncates in the middle, keeping the extension), size and age on a second dim line. Directories first. Rows are at least 56 px tall; the tap target is the whole row (the `PhoneHit` variants and the repo-wide guard test from `phoneHit.coverage.test.ts` apply to any IconButton inside).
- **Hidden until needed.** Breadcrumb is one line (current folder, a back arrow; the full path on tap). Search, sort and the grid toggle sit behind a single icon in the header and open inline above the list. Download and share appear on the open file, not on every row. Nothing is permanently stacked in the header.
- **Preview.** Tap a file: it opens in place below its row, full width, and pushes the rows below it down (vertical room is the cheap axis). Image: fitted, tap for the existing `ImageViewer`. Audio: the `AudioContent` controls rehosted (`renderMediaControl`), one player at a time, a mini-player pinned to the bottom only while something plays. Video: native controls. Text, md, json, patch: monospace, first 64 KiB, "show all" below. PDF: open in a new tab. Anything else: name, size, hash, one Download button.
- **Honesty rows.** Loading, empty, "host unreachable", "not allowed" are rows that say so (as `MediaNote` does); no spinner without a name for what it waits on.
- **Role-driven.** The index response carries the caller's role; the client uses it only to hide controls (upload), never to decide access.

### Host contract

The host is a service on Yggdrasil that Eureka owns. The client holds no filesystem knowledge. All JSON here is the xenos boundary between a browser and a file server, not state.

- `GET /index?path=<p>` returns `{ role, zone, path, entries: [{ name, kind: "file"|"dir", size, mtime, mime, hash }] }`. `mtime` is unix seconds. `hash` is the lower-case hex sha256 of the plaintext bytes, absent for directories, and may be absent for a file whose hash is not computed yet (client shows nothing, never blocks on it). `mime` is sniffed by the host from magic bytes, not guessed from the extension.
- `GET /file?path=<p>` streams the bytes with `Accept-Ranges: bytes` and 206 for `Range` (audio and video seek; a phone on mobile data does not fetch 40 MB to play 10 seconds). `Content-Type` is the sniffed mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` for anything that can run in the origin (`html`, `svg`, `js`, `xhtml`), and a `Content-Security-Policy: sandbox` on every response.
- `path` is `<zone>/<relative path>`, with the zone one of the names the host announces. The host resolves the real path of every request and refuses anything that leaves the zone's root: `..`, absolute paths, NUL, symlinks that cross the root, dotfiles, and `handoff-private`, which is not on any allowlist. Errors are typed (`401 unauthenticated`, `403 zone not allowed`, `404`, `416`), and a path outside the allowlist is 404, not 403, so it says nothing about what exists.
- **Auth: Matrix OpenID.** The client calls `mx.getOpenIdToken()` (already used in `CallWidgetDriver.ts`) and sends it as `Authorization: Bearer <token>`. The host verifies it against the homeserver's federation `openid/userinfo` endpoint, **pinned to our server name** (an `@void:evil.example` token must fail), caches the verified `sub` for the token's lifetime, and derives the role. It never sees the user's access token, and a Mind's Self never holds a token (ruling above): Minds reach the same bytes through the filesystem or the mouth, not this host.
- **Role** in the response: `member`, `mind`, `steward` (host decides from the Matrix id and the room/space membership the host reads; the client trusts none of it for access). **Q-E:** exact source of membership (estate Space membership read by the host with a service account, versus the Persona catalogue file for Minds).
- **Uploads** (Meta approved for members and Minds, #swarm 2026-11-13 14:30Z; rules are Eureka's, below). `PUT /file?path=<p>` writes only under an `uploads/` subtree of a zone, with `Content-Length` required; the host enforces a size cap, a type allowlist (sniffed, not the client's claim), no overwrite unless the request carries an explicit flag, and never replaces a file a Mind wrote into the handoff tree; every write is audit-logged with the caller's Matrix id. Reads cover the whole allowlisted tree, so an uploaded file is listed like any other. Success is `201` with the stored name, size and hash. The `role` in the index response gates the upload control; the host gates the write.

### The one problem the contract leaves: media elements cannot send headers

`<audio src>`, `<video src>` and `<img src>` cannot attach `Authorization`. Options, none free:

1. **Fetch to a blob.** Works with the contract as written. No seeking before the whole file is in memory; bad for a 40 MB clip on a phone. Fine for images and small audio.
2. **Short-lived path ticket.** `POST /ticket?path=` with the bearer token returns a URL with an unguessable token valid for a few minutes for that one path and its ranges. The player gets a normal URL and seeks. One more endpoint on the host and one more thing to expire and log.
3. **Service worker adds the header** to `/files-host/*` requests. The PWA already has a worker (`src/sw.ts`); no host change, but the worker must carry a fresh OpenID token and range requests through it are fiddly.

Recommendation: 2 for audio and video, 1 for images and text. Confidence moderate: I have not tested a service worker against range requests on the target phone, and 2 is the usual answer for authenticated media (signed URLs). **Q-E.**

### Upload flow (host)

Design only. Every number and error code is a named placeholder until Eureka gives them on the PR: `<CAP_FILE>` (per-file size), `<CAP_BATCH>` (per-pick total, if any), `<TYPES>` (the allowlist), `<OVERWRITE_FLAG>` (the explicit query flag), and the codes `<E_AUTH>`, `<E_ROLE>`, `<E_PATH>`, `<E_TYPE>`, `<E_SIZE>`, `<E_EXISTS>`, `<E_PROTECTED>`, `<E_QUOTA>`, `<E_SERVER>`.

**Where.** The control exists only where an upload is allowed: inside a folder under a zone's `uploads/` subtree (or at the `uploads/` row itself), and only when the index `role` is member or mind. Elsewhere there is no button; the list does not carry a disabled one. A folder outside `uploads/` shows a one-line dim note, "Uploads go in uploads/", which links to that folder. Creating subfolders under `uploads/` is not in this design (**Q-E8**).

**Pick or drop.** One `Upload` row at the top of an `uploads/` folder opens the native picker (any number of files; on a phone this is the OS file sheet, camera roll included). On wide screens the list is also a drop target; the drop highlight appears only while a drag is over it. Nothing starts on pick: the picked files appear as a staging list (name, size, a type icon) with `Upload` and `Cancel` as full-width rows, as `ShareSet` does for a Matrix set. Files that already fail the client's cheap checks (over `<CAP_FILE>`, a type outside `<TYPES>`) are marked in the staging list with the reason and left out of the send; the client mirrors the cap and allowlist as a courtesy only, the host is the authority, and the list is read from the host (**Q-E9**: an `/index` field or a `/limits` call) rather than hard-coded.

**Send.** Files go one at a time, in pick order, each a `PUT /file?path=<folder>/<name>` with the bearer token. One at a time keeps a phone on mobile data from starving every transfer, and a refusal names exactly one file. The transport is `XMLHttpRequest`, not `fetch`: `fetch` has no upload progress and the row needs it. The body is the `File` itself (streamed by the browser, not read into memory; unlike the Matrix path, the client computes no hash first, the host returns one). The name is the file's own name, with path separators and control characters replaced, never a path the user typed.

**Progress.** The staging list becomes the progress list: per file a thin bar and "412 KB of 3.1 MB", per batch "2 of 5". Finished files show a tick and the stored name; refused ones show the refusal in place; waiting ones are dim. Only the active file animates. The list stays on screen after the last file until dismissed, so a refusal is not lost to a refresh of the folder underneath it. The folder listing refetches after each success, so the file appears in the list as it lands.

**Cancel.** `Cancel` on the active file aborts the request (`xhr.abort()`) and goes on to the next; `Cancel all` on the batch aborts the active file and drops the rest. The host must discard an aborted partial write and never leave a half file in the listing (**Q-E10**, written to a temporary name and renamed on completion). Leaving the page aborts whatever runs, as the Matrix share does; the client does not resume.

**Overwrite.** A name that already exists is refused with `<E_EXISTS>` and shown as "<name> is already there". A `Replace` row appears under that refusal only for a file the caller wrote themselves, and sends the same `PUT` with `<OVERWRITE_FLAG>`; a Mind-written handoff file refuses with `<E_PROTECTED>` and offers only "Keep both", which re-sends under a suffixed name (`name (2).ext`) chosen by the client. Whether the client can tell "mine" from the index (an `owner` field with the Matrix id) or learns it only from the refusal is **Q-E11**; absent an owner field, `Replace` is simply offered after `<E_EXISTS>` and the host's answer decides.

**Refusal messages.** One plain sentence per code, shown in the file's row; nothing says "error" without saying why, and none names a server path.

| Code                             | Message (draft)                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `<E_AUTH>`                       | Sign-in expired. Reload to upload again. (The client fetches a fresh OpenID token once and retries before showing this.) |
| `<E_ROLE>`                       | Uploads are for members and Minds.                                                                                       |
| `<E_PATH>`                       | That folder does not take uploads.                                                                                       |
| `<E_TYPE>`                       | "<name>" is a <type> file; allowed types are <TYPES>.                                                                    |
| `<E_SIZE>`                       | "<name>" is <size>; the limit is <CAP_FILE>.                                                                             |
| `<E_EXISTS>`                     | "<name>" is already there.                                                                                               |
| `<E_PROTECTED>`                  | "<name>" was written by a Mind and cannot be replaced.                                                                   |
| `<E_QUOTA>`                      | The shared space is full. Tell a steward.                                                                                |
| `<E_SERVER>` / network / timeout | Could not reach the file host. The file was not saved.                                                                   |

Retry is one tap on a failed row; the batch never retries on its own. An unknown code shows the host's status text as it is, still without a path.

**Honest end state.** Done means the host answered `201` and the stored name, size and hash are shown. "Saved" is not said earlier; the hash the host returns is displayed so a sender can compare it with their own.

**Reuse and not.** `ShareSet`'s state machine (staging, one-send-per-zone guard, failed files kept by position) is the model, but the Matrix share path and its `createUploadAtom` are tied to the SDK's media upload and are not reused; the new controller sits in `features/files/uploadController.ts` with the same injected-port shape, so order, refusal and cancel rules are tested against a fake `PUT` without a browser. Real transfer progress and a real range of a phone's picker stay a phone check.

### Client shape (host)

Under `src/app/features/files`, mirroring `features/albums`:

- `filesHost.ts`: ports, `list(path)`, `url(path)`, `ticket(path)`, `put(path, file, onProgress, signal)`; the only module that knows the contract. Injected, so the UI is tested against a fake and the real client never runs in a test.
- `useFilesZone.ts`: react-query on `['files', zone, path]`, `staleTime` 30 s; the role comes with every index.
- `FilesDesk.tsx`, `FileRow.tsx`, `FilePreview.tsx`: pure rendering from the above; the preview picks its renderer from the host's `mime`, not the extension.
- `config.json`: `filesDesk: { enabled: false, host: "https://…" }`, dark by default as `fileZoneShare.enabled` is. With it off, no row mounts and no request leaves the client.
- Test host: `src/preview-demo` already answers for a pretend homeserver through a fetch guard (`install.ts`); it gains a fake `/index` and `/file` with ranges so the previews are checked in a real browser before the real host exists.

### Cuts (host)

1. **Contract and fake host** (no UI): `filesHost.ts`, types, `preview-demo` fake, path tests (traversal strings from the host side are Eureka's; the client must only build `path` from entries it was given).
2. **Read-only Commons desk**: route, row, list, breadcrumb, role display, flagged off.
3. **Preview and player**: image, audio with ranges, text, video; the ticket if Q-E settles on 2.
4. **Per-Persona rows** in each Mind's group, once the outbox `shared/` convention and the zone provisioning exist.
5. **Uploads**: the flow above; needs Eureka's codes and caps and the host's `PUT`.

Each is its own PR. Slices 1 to 3 need no host to build and test; slice 2 needs the real host to be useful, not to land.

### Not in scope (host)

The Matrix file zone (marks, receipts, `ShareSet`); any Mind-side fetch (the mouth's); encrypted rooms; deletion and rename (a read surface first; the files belong to whoever wrote them on disk); search across zones; a permission model of our own beyond what the host derives from Matrix identity.

### Open questions (host)

**For Eureka (host):**

- **Q-E1.** Which roots form Commons: the allowlist, and whether `handoff` is ever served (it holds custody receipts and ops notes; recommendation: no, a reviewed `commons/` directory instead).
- **Q-E2.** Where the host runs and what it is: Rust by default per doctrine; nginx with `auth_request` to a verifier is smaller if the sniff, range and role logic fit there. Which user; read-only mounts; ACLs on the outboxes.
- **Q-E3.** Media-element auth: blob, ticket or service worker (above).
- **Q-E4.** Role source: how the host learns membership and which Minds are Minds; token verification pinned to `gamecult.org`.
- **Q-E5.** Per-Persona publishing: a `shared/` subdirectory versus a marker, and who populates it when the Persona decides.
- **Q-E6.** Hash cost: compute lazily and cache by (path, mtime, size), or at publish time.
- **Q-E7.** CORS for `chat.gamecult.org` and the dev previews, rate limits, and the `Content-Disposition` list.
- **Q-E8.** Subfolders under `uploads/`: can a client create them (by a `PUT` path that implies them, or a `MKCOL`-like call), or is `uploads/` flat?
- **Q-E9.** Cap and allowlist discovery: fields in the index response, or a `/limits` endpoint; and the exact codes and cap numbers behind every placeholder in the upload flow.
- **Q-E10.** Partial writes: temporary name then rename, so an aborted or failed upload never appears in a listing.
- **Q-E11.** Does the index carry an `owner` Matrix id per file (so `Replace` is offered only on one's own files), and is the audit log readable by stewards from the client or only on the host?

**For Meta:**

- **Q-M1.** Audience: Commons for members and Minds as proposed; are Users and Patrons ever in (the Matrix zone's audience question, `ratatoskr:question:file-zone-audience`, is the same fork)?
- **Q-M2.** Is a Persona's zone visible to all members or to her stewards and Minds?
- **Q-M3.** ~~Uploads~~ approved for members and Minds (2026-11-13 14:30Z); open only: may Users or Patrons upload if they are ever let in?
- **Q-M4.** Name: "Files" for the row, "Commons" for the shared zone.
- **Q-M5.** Does the Matrix Media row stay beside the Files row on each Mind, or does one absorb the other once the Files desk exists (recommendation: both stay; marks and receipts are Matrix's).
