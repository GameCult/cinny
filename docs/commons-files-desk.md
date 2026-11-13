# Files desk: Commons and per-Persona file zones

Status: design only. No code, nothing deployed. Items marked **UNKNOWN** are not verified against the Body; **Q-E** / **Q-M** are open questions for Eureka (host) and Meta (audience, names), collected at the end.

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
- **Uploads** (Meta approved for members and Minds, #swarm 2026-11-13 14:30Z; rules are Eureka's, below). `PUT /file?path=<p>` writes only under an `uploads/` subtree of a zone, with `Content-Length` required; the host enforces a size cap, a type allowlist (sniffed, not the client's claim), no overwrite unless the request carries an explicit flag, and never replaces a file a Mind wrote into the handoff tree; every write is audit-logged with the caller's Matrix id. Reads cover the whole allowlisted tree, so an uploaded file is listed like any other. Success is `201` with the stored name, size and hash. The `role` in the index response gates the upload control; the host gates the write.

### The one problem the contract leaves: media elements cannot send headers

`<audio src>`, `<video src>` and `<img src>` cannot attach `Authorization`. Options, none free:

1. **Fetch to a blob.** Works with the contract as written. No seeking before the whole file is in memory; bad for a 40 MB clip on a phone. Fine for images and small audio.
2. **Short-lived path ticket.** `POST /ticket?path=` with the bearer token returns a URL with an unguessable token valid for a few minutes for that one path and its ranges. The player gets a normal URL and seeks. One more endpoint on the host and one more thing to expire and log.
3. **Service worker adds the header** to `/files-host/*` requests. The PWA already has a worker (`src/sw.ts`); no host change, but the worker must carry a fresh OpenID token and range requests through it are fiddly.

Recommendation: 2 for audio and video, 1 for images and text. Confidence moderate: I have not tested a service worker against range requests on the target phone, and 2 is the usual answer for authenticated media (signed URLs). **Q-E.**

## Upload flow

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

## Client shape

Under `src/app/features/files`, mirroring `features/albums`:

- `filesHost.ts`: ports, `list(path)`, `url(path)`, `ticket(path)`, `put(path, file, onProgress, signal)`; the only module that knows the contract. Injected, so the UI is tested against a fake and the real client never runs in a test.
- `useFilesZone.ts`: react-query on `['files', zone, path]`, `staleTime` 30 s; the role comes with every index.
- `FilesDesk.tsx`, `FileRow.tsx`, `FilePreview.tsx`: pure rendering from the above; the preview picks its renderer from the host's `mime`, not the extension.
- `config.json`: `filesDesk: { enabled: false, host: "https://…" }`, dark by default as `fileZoneShare.enabled` is. With it off, no row mounts and no request leaves the client.
- Test host: `src/preview-demo` already answers for a pretend homeserver through a fetch guard (`install.ts`); it gains a fake `/index` and `/file` with ranges so the previews are checked in a real browser before the real host exists.

## Cuts

1. **Contract and fake host** (no UI): `filesHost.ts`, types, `preview-demo` fake, path tests (traversal strings from the host side are Eureka's; the client must only build `path` from entries it was given).
2. **Read-only Commons desk**: route, row, list, breadcrumb, role display, flagged off.
3. **Preview and player**: image, audio with ranges, text, video; the ticket if Q-E settles on 2.
4. **Per-Persona rows** in each Mind's group, once the outbox `shared/` convention and the zone provisioning exist.
5. **Uploads**: the flow above; needs Eureka's codes and caps and the host's `PUT`.

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
