# Files desk: Commons and per-Persona file zones

Status: design only. No code, nothing deployed. Items marked **UNKNOWN** are not verified against the Body; **Q-E** / **Q-M** are open questions for Eureka (host) and Meta (audience, uploads), collected at the end.

Source: Meta, #swarm 2026-11-13 14:28Z; ruling `ratatoskr:ruling:persona-file-sharing-zone` (each Persona has her own file sharing zone the frontend shows: a browsable, previewing collection; the Self writes to her outbox, her Persona decides what is shared, the Self never holds Matrix credentials).

## What exists, and what this adds

|          | Matrix file zone (`docs/file-zone.md`, built)                                | Files desk (this page)                                                                                            |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Storage  | Matrix media in a `#files-<mind>` room, albums as threads                    | Directories on Yggdrasil, served by a small host                                                                  |
| Listing  | thread roots, `buildAlbums`                                                  | `GET /index?path=`                                                                                                |
| Unit     | album of posted files                                                        | file in a directory tree                                                                                          |
| Strength | marks (keep / fix / drop), receipts (`fetched for`), any Matrix client works | whole trees without N uploads, no Matrix size limit, `/opt/commons` material becomes visible to people on a phone |
| Entry    | Media row per Mind (`MediaRow.tsx`)                                          | Files row (below)                                                                                                 |

They do not compete. The Matrix zone stays where a file needs a mark or a receipt (Aqua's listening kits); the Files desk is for browsing and fetching what is already on disk. Neither replaces the other, and the Files desk does not write Matrix events. The ruling left "Matrix media plus a listing versus a served directory" open; this page is the served-directory half, built beside the Matrix half already live.

## Zones

| Zone             | Contents                                                     | Who sees it                                                    |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Commons          | a curated tree of `/opt/commons`                             | members and Minds                                              |
| Persona `<slug>` | what that Persona has chosen to share from her Self's outbox | **Q-M:** all members, or the Persona's stewards and Minds only |
| handoff-private  | `/opt/commons/handoff-private` (0750)                        | never: not a zone, not listed, not a path the host resolves    |

Layout of `/opt/commons` today (read 2026-11-13): `backlog` (755, per-Mind backlog md and summary.json), `bin`, `cast-art` (setgid, group-writable: poses, busts), `handoff` (setgid, group-writable, 92 entries of briefs, patches, receipts, dings, kits), `handoff-private` (0750, ACL), `opt` (toolchains, root-owned), `situation` (0750, setgid), all `nobody:nogroup`. **`handoff` is not a publishable tree:** it holds ops notes, custody receipts (`bifrost-appsecret-custody-receipt-*`) and patches written for Minds, with no sticky bit. Serving it wholesale shows secrets-adjacent notes to every member and lets any Mind with group write change what a phone user sees. The Commons zone is therefore an allowlist of roots (candidate: `cast-art`, `backlog`, and a new `commons/` directory Minds publish into on purpose), not `/opt/commons` itself. **Q-E:** which roots; whether `handoff` ever, and if so through a reviewed `published/` subdirectory.

Per-Persona source is the outbox from `ratatoskr:follow_up:album-outbox-ops-and-persona-specs`: `/var/lib/mind-<slug>-outbox`, owned by `mind-<slug>-self`, 0750, ACL read for `mind-<slug>` and the host user. The Self writes there; the Persona decides what is shared. Making that decision a filesystem fact (a `shared/` subdirectory the Persona's turn populates by copy or hardlink, the host serves only `shared/`) keeps the host dumb: it never learns what "decides" means. **Q-E:** `shared/` subdirectory versus a per-file marker.

## Phone-first UI

Phone width is the design width; desktop adds the navigator beside it (as `Desk` does in `Router.tsx`). Vertical space is cheap, so a screen shows one thing and hides what is not in use.

- **Entry.** A `Files` row pinned in the navigator beside `DeskEntry` and `MindMedia`: one at the estate level (Commons) and one inside each Mind's group (her zone), same `NavItem` anatomy as `DeskEntry`, dim when the zone has no items. Route `/files/:zone/*path`, sibling of `DESK_PATH`.
- **List.** One column. Row = icon or thumbnail, name (truncates in the middle, keeping the extension), size and age on a second dim line. Directories first. Rows are at least 56 px tall; the tap target is the whole row (the `PhoneHit` variants and the repo-wide guard test from `phoneHit.coverage.test.ts` apply to any IconButton inside).
- **Hidden until needed.** Breadcrumb is one line (current folder, a back arrow; the full path on tap). Search, sort and the grid toggle sit behind a single icon in the header and open inline above the list. Download and share appear on the open file, not on every row. Nothing is permanently stacked in the header.
- **Preview.** Tap a file: it opens in place below its row, full width, and pushes the rows below it down (vertical room is the cheap axis). Image: fitted, tap for the existing `ImageViewer`. Audio: the `AudioContent` controls rehosted (`renderMediaControl`), one player at a time, a mini-player pinned to the bottom only while something plays. Video: native controls. Text, md, json, patch: monospace, first 64 KiB, "show all" below. PDF: open in a new tab. Anything else: name, size, hash, one Download button.
- **Honesty rows.** Loading, empty, "host unreachable", "not allowed" are rows that say so (as `MediaNote` does); no spinner without a name for what it waits on.
- **Role-driven.** The index response carries the caller's role; the client uses it only to hide controls (upload), never to decide access.

## Host contract

The host is a service on Yggdrasil that Eureka owns. The client holds no filesystem knowledge. All JSON here is the xenos boundary between a browser and a file server, not state.

- `GET /index?path=<p>` returns `{ role, zone, path, entries: [{ name, kind: "file"|"dir", size, mtime, mime, hash }] }`. `mtime` is unix seconds. `hash` is the lower-case hex sha256 of the plaintext bytes, absent for directories, and may be absent for a file whose hash is not computed yet (client shows nothing, never blocks on it). `mime` is sniffed by the host from magic bytes, not guessed from the extension.
- `GET /file?path=<p>` streams the bytes with `Accept-Ranges: bytes` and 206 for `Range` (audio and video seek; a phone on mobile data does not fetch 40 MB to play 10 seconds). `Content-Type` is the sniffed mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` for anything that can run in the origin (`html`, `svg`, `js`, `xhtml`), and a `Content-Security-Policy: sandbox` on every response.
- `path` is `<zone>/<relative path>`, with the zone one of the names the host announces. The host resolves the real path of every request and refuses anything that leaves the zone's root: `..`, absolute paths, NUL, symlinks that cross the root, dotfiles, and `handoff-private`, which is not on any allowlist. Errors are typed (`401 unauthenticated`, `403 zone not allowed`, `404`, `416`), and a path outside the allowlist is 404, not 403, so it says nothing about what exists.
- **Auth: Matrix OpenID.** The client calls `mx.getOpenIdToken()` (already used in `CallWidgetDriver.ts`) and sends it as `Authorization: Bearer <token>`. The host verifies it against the homeserver's federation `openid/userinfo` endpoint, **pinned to our server name** (an `@void:evil.example` token must fail), caches the verified `sub` for the token's lifetime, and derives the role. It never sees the user's access token, and a Mind's Self never holds a token (ruling above): Minds reach the same bytes through the filesystem or the mouth, not this host.
- **Role** in the response: `member`, `mind`, `steward` (host decides from the Matrix id and the room/space membership the host reads; the client trusts none of it for access). **Q-E:** exact source of membership (estate Space membership read by the host with a service account, versus the Persona catalogue file for Minds).
- **Uploads, only if Meta approves (Q-M):** `PUT /file?path=<p>` with `Content-Length` required, a hard per-file cap (suggest 25 MiB; the existing Matrix limit is `m.upload.size` and the mouth fetches at most 5 MiB), no overwrite (409), into a single `inbox/` directory per zone, `201` with the stored name, size and hash, and the same path and sniff rules. Without approval the host serves no `PUT` and the client has no upload control; the `role` field is what would gate the control. The Matrix zone already carries uploads (`ShareSet`), so the Files desk does not need them to be useful.

### The one problem the contract leaves: media elements cannot send headers

`<audio src>`, `<video src>` and `<img src>` cannot attach `Authorization`. Options, none free:

1. **Fetch to a blob.** Works with the contract as written. No seeking before the whole file is in memory; bad for a 40 MB clip on a phone. Fine for images and small audio.
2. **Short-lived path ticket.** `POST /ticket?path=` with the bearer token returns a URL with an unguessable token valid for a few minutes for that one path and its ranges. The player gets a normal URL and seeks. One more endpoint on the host and one more thing to expire and log.
3. **Service worker adds the header** to `/files-host/*` requests. The PWA already has a worker (`src/sw.ts`); no host change, but the worker must carry a fresh OpenID token and range requests through it are fiddly.

Recommendation: 2 for audio and video, 1 for images and text. Confidence moderate: I have not tested a service worker against range requests on the target phone, and 2 is the usual answer for authenticated media (signed URLs). **Q-E.**

## Client shape

Under `src/app/features/files`, mirroring `features/albums`:

- `filesHost.ts`: ports, `list(path)`, `url(path)`, `ticket(path)`; the only module that knows the contract. Injected, so the UI is tested against a fake and the real client never runs in a test.
- `useFilesZone.ts`: react-query on `['files', zone, path]`, `staleTime` 30 s; the role comes with every index.
- `FilesDesk.tsx`, `FileRow.tsx`, `FilePreview.tsx`: pure rendering from the above; the preview picks its renderer from the host's `mime`, not the extension.
- `config.json`: `filesDesk: { enabled: false, host: "https://…" }`, dark by default as `fileZoneShare.enabled` is. With it off, no row mounts and no request leaves the client.
- Test host: `src/preview-demo` already answers for a pretend homeserver through a fetch guard (`install.ts`); it gains a fake `/index` and `/file` with ranges so the previews are checked in a real browser before the real host exists.

## Cuts

1. **Contract and fake host** (no UI): `filesHost.ts`, types, `preview-demo` fake, path tests (traversal strings from the host side are Eureka's; the client must only build `path` from entries it was given).
2. **Read-only Commons desk**: route, row, list, breadcrumb, role display, flagged off.
3. **Preview and player**: image, audio with ranges, text, video; the ticket if Q-E settles on 2.
4. **Per-Persona rows** in each Mind's group, once the outbox `shared/` convention and the zone provisioning exist.
5. **Uploads**: only on Meta's yes.

Each is its own PR. Slices 1 to 3 need no host to build and test; slice 2 needs the real host to be useful, not to land.

## Not in scope

The Matrix file zone (marks, receipts, `ShareSet`); any Mind-side fetch (the mouth's); encrypted rooms; deletion and rename (a read surface first; the files belong to whoever wrote them on disk); search across zones; a permission model of our own beyond what the host derives from Matrix identity.

## Open questions

**For Eureka (host):**

- **Q-E1.** Which roots form Commons: the allowlist, and whether `handoff` is ever served (it holds custody receipts and ops notes; recommendation: no, a reviewed `commons/` directory instead).
- **Q-E2.** Where the host runs and what it is: Rust by default per doctrine; nginx with `auth_request` to a verifier is smaller if the sniff, range and role logic fit there. Which user; read-only mounts; ACLs on the outboxes.
- **Q-E3.** Media-element auth: blob, ticket or service worker (above).
- **Q-E4.** Role source: how the host learns membership and which Minds are Minds; token verification pinned to `gamecult.org`.
- **Q-E5.** Per-Persona publishing: a `shared/` subdirectory versus a marker, and who populates it when the Persona decides.
- **Q-E6.** Hash cost: compute lazily and cache by (path, mtime, size), or at publish time.
- **Q-E7.** CORS for `chat.gamecult.org` and the dev previews, rate limits, and the `Content-Disposition` list.

**For Meta:**

- **Q-M1.** Audience: Commons for members and Minds as proposed; are Users and Patrons ever in (the Matrix zone's audience question, `ratatoskr:question:file-zone-audience`, is the same fork)?
- **Q-M2.** Is a Persona's zone visible to all members or to her stewards and Minds?
- **Q-M3.** Uploads: yes or no, and if yes, who (members, Minds, stewards) and the cap.
- **Q-M4.** Name: "Files" for the row, "Commons" for the shared zone.
- **Q-M5.** Does the Matrix Media row stay beside the Files row on each Mind, or does one absorb the other once the Files desk exists (recommendation: both stay; marks and receipts are Matrix's).
