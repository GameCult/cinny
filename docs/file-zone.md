# File zone: design sketch

Status: design only. No code exists. Everything below is a proposal; items marked **UNKNOWN** are not yet verified against the Body.

Source: Meta ruling 2026-10-31, eureka mind `ratatoskr:ruling:file-zone-looks-like-file-sharing`.

## What it is

A file-sharing space beside the room timeline, not a view of it. The zone is **one ordinary Matrix room with threaded discussions, one thread per Mind**. The UI presents each thread as an **album** (title, item count, date) and each post in it as a **file** with an inline player or preview. Matrix is the storage and the fallback: another client sees a normal room with threads and never needs the zone. No homeserver change.

First use (Aqua): listen to audio in place, mark each clip keep / fix / drop with a one-line reason, export the marks as a file. See `/opt/commons/handoff/aqua-listen-kits-20261108/` (static `listen.html` kits that emit `verdict.json` + `verdict.md`); the zone replaces sending that page around.

## Matrix event shapes (stock events only)

- **Zone** = one room, chosen by the client (**UNKNOWN:** how the client knows which room is the zone: a room-account-data flag, a `m.room.create` type, or a configured room id in `config.json`; config is simplest).
- **Album** = a thread root: a text `m.room.message` posted by a Mind, `body` = the album title (the Mind's name, e.g. `void`). One thread per Mind, owned by authorship (the root's sender). **UNKNOWN:** whether a Mind may open more than one (e.g. per kit); the shape allows it with no change, the zone would then list several albums per author. Count and last-activity come from the SDK's thread summary (`unsigned.m.relations.m.thread`); album date = root `origin_server_ts`. Rename = `m.replace` on the root.
- **File** = a post in the thread: an `m.room.message` with `msgtype` `m.audio` / `m.image` / `m.video` / `m.file` and `m.relates_to: { rel_type: "m.thread", event_id: <root>, is_falling_back: true, "m.in_reply_to": { event_id: <last thread event> } }`. The builders in `src/app/features/room/msgContent.ts` already make the content. Delete = redact.
- **Album vs chat thread**: with a single-purpose room, every thread is an album. No marker key is needed. A non-media reply in a thread (chat, a mark) is not a file and is not listed as one.
- **Cover** = first image file in the thread, if any. Loose room messages outside any thread are not shown in the zone; they remain in the timeline.

## Marks (reactions, plus an optional reply)

A mark is stock Matrix, so every client shows it. Two reaction sets on the **file post**, and one optional reply:

- **Verdict** = an `m.annotation` reaction (`m.reaction` event, `m.relates_to: { rel_type: "m.annotation", event_id: <file post>, key }`) with key **👍 keep**, **🔧 fix**, **🗑 drop**. One per person per file: choosing another replaces the old one (the client redacts the sender's previous verdict reaction, then sends the new one); tapping the active one clears it.
- **Landed** = a second reaction set, keys **1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣** (keycap digits, 1-5). Also one per person per file, same replace rule. The two sets are independent: a file can have a verdict, a landed score, both or neither.
- **Reason** = an ordinary thread reply under the file: `m.room.message` `m.text`, `m.relates_to: { rel_type: "m.thread", event_id: <album root>, "m.in_reply_to": { event_id: <file post> } }`. Optional. **Keep needs none**; the UI prompts for one mainly after fix or drop. The latest such reply by the sender under that file is the reason (edits via `m.replace` count). No special key: the reply text is the reason, so nothing is lost if another client wrote it.
- **No private mode.** Marks are room events the moment they are tapped; there is no local-only draft and no "Share" step. Offline taps queue in the SDK's normal send queue.
- Who marked what is read from the reactions' senders, so each listener is distinguishable and the album can show tallies per file.
- Why reactions: one tap, readable in any client, no custom event type, and they can be changed with no history growth beyond a redaction. Reaction keys carry no text, hence the separate reply for the reason.
- **UNKNOWN:** emoji variation selectors. 🗑 and 🔧 and the keycaps may arrive with or without U+FE0F from different clients; match by normalizing (strip U+FE0F) before comparing keys. Also **UNKNOWN:** servers' per-event limits on distinct reaction keys; a handful per file is far below any default.

## Export

Client-side only. "Export" builds Aqua's verdict file from the verdict and landed reactions and the reply under each file in one album (one listener's marks per export; that sender is the `listener`) and either downloads it or uploads it into the album. Two files, as the kits write them: `verdict.json` and `verdict.md`.

`verdict.json` is schema **`aqua.listen.verdict.v1`**, field for field what `buildVerdict` in the kit (`dings/listen.html`, section `buildVerdict`) emits, so Aqua's tooling reads it unchanged:

```
{ schema: "aqua.listen.verdict.v1",
  kit: { id, title },            // album root: id = root event id (or the kit id if the upload carried one), title = root body
  exportedAt,                    // ISO time of export
  seed, consent,                 // kit-only: zone writes seed: 0 (or omits), consent: true for the sender's own export (see UNKNOWN)
  listener,                      // sender display name
  device,                        // headphones|speakers|null, the sender's most-used mark device, or null
  notes,                         // free text; zone leaves "" in v1
  summary: { total, keep, fix, drop, unanswered },
  clips: [{ position, id, title, group, feel, file, pair, slot, verdict, reason, landed, device }],
  pairs: [{ a, b, preferred }] } // empty array when the album has no pairs
```

- `clips` has one row per file post in the album, in thread order (`position` = 1-based). The join per file, for the exporting listener: `verdict` = their 👍/🔧/🗑 reaction (keep/fix/drop) or null; `landed` = their keycap reaction (1-5) or null; `reason` = text of their latest reply under the file, or "". A file with no verdict reaction counts as `unanswered` even if it has a reply. `device` per clip is null (reactions cannot carry it); the top-level `device` (headphones|speakers|null) is asked once in the export dialog.
- `pairs`, `seed`, `consent` are optional for the zone: `pairs: []`, no `slot`/`pair` (null) unless the clip metadata supplies them.
- **Where clip metadata comes from.** `id` is the clip id from `org.gamecult.clip`, else the filename stem. `title` = file post `body`; `file` = the post's `filename`/`body`. `group`, `feel`, `pair`, `slot` are kit data that Matrix has no slot for: carry them on the file post as one extra key `org.gamecult.clip: { id, group, feel, pair, slot }` written by whoever uploads the kit (a small uploader script, **UNKNOWN**, not in the first slice; without it those columns export as ""/null and the id falls back to the filename stem).
- `verdict.md` follows `verdictMarkdown` from the same file: header line, count line, the clip table (`# | clip | group | intended feel | verdict | landed (1-5) | device | reason`), pairs table when `pairs` is nonempty, notes.
- To avoid drift, the exporter should be a port of `buildVerdict`/`verdictMarkdown` with the schema string and field order pinned by a test that compares against a fixture produced by the kit. **UNKNOWN:** whether to share code (the kit's `logic.cjs`) rather than port; recommend port, ~80 lines, because the kit is a standalone page.
- **UNKNOWN:** `consent` is a kit-side checkbox before listening. The zone has no such step; recommend writing `true` only if the sender ticks a one-time "include my name in exports" toggle, else `false` and `listener: ""`.
- JSON here is a xenos-boundary export, not state; the room events are the state.

## Mobile-first layout

- Phone width is the design width; desktop adds columns.
- Level 1, album list: one column, each row = cover/icon, title, "N files", date. Tap opens.
- Level 2, album: list by default (title, duration/size), grid toggle for images. Audio rows play in place, one at a time (starting a clip stops the last), a persistent mini-player at the bottom with seek.
- Mark controls on each audio row: three large tap targets (👍 keep / 🔧 fix / 🗑 drop) with tallies, a row of five "landed" chips (1-5), and after fix or drop an inline one-line reason field (skippable). Thumb-reachable, no modal.
- Back is one level up; the room timeline stays one tap away (the zone is a sibling view, not a replacement). **UNKNOWN:** where the entry lives in the room header; check `RoomViewHeader.tsx`, `Room.tsx` for how the member drawer and pin menu attach.

## Upload

Reuse the composer's pipeline, pointed at an album instead of the main timeline:

- `createUploadAtom` / `useBindUploadAtom` (`src/app/state/upload.ts`), `UploadCard`, `upload-board` for progress.
- On success, the msgContent builder produces the event; the zone adds the thread relation to the album root before sending (the composer already does this for thread replies, `RoomInput.tsx`).
- "New album" = send the root text event, then upload into its thread. Multi-file drop = N events, sent in order.
- Size limit from `MediaConfigLoader` (server `m.upload.size`). **UNKNOWN:** whether the 32 MB `shelf` kit's clips (42 x ~0.75 MB) should be uploaded individually or batched; individually is the only option without a server change.

## Existing code to reuse (verified present in the repo)

| need                                                | where                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| audio player (play/seek/volume, encrypted download) | `src/app/components/message/content/AudioContent.tsx` (210 lines)                                  |
| video, image, generic file                          | `.../content/VideoContent.tsx`, `ImageContent.tsx`, `FileContent.tsx`                              |
| full-screen image viewer                            | `src/app/components/image-viewer/ImageViewer.tsx`                                                  |
| media dispatch by msgtype                           | `src/app/components/RenderMessageContent.tsx`, `message/MsgTypeRenderers.tsx`                      |
| upload + progress                                   | `state/upload.ts`, `components/upload-card`, `upload-board`                                        |
| event content builders                              | `features/room/msgContent.ts`                                                                      |
| thread plumbing                                     | `features/room/message/Message.tsx`, `RoomTimeline.tsx`, `RoomInput.tsx` (thread relation on send) |
| room-scoped file/pin precedent                      | `features/room/room-pin-menu/RoomPinMenu.tsx`                                                      |

Nothing named "gallery" exists as a feature; `AudioContent` takes its controls as render props (`renderMediaControl`), so it can be rehosted in a row without a fork. **UNKNOWN:** whether `AudioContent` can be rendered outside a timeline event context (it needs only `url`, `info`, `mimeType`, `encInfo`, from the event content, so probably yes).

## First slice (what to build first)

Rough lines of TypeScript, tests excluded.

1. **Read-only albums + album view** (~250 lines): list the room's thread roots as albums (grouped or filterable by author = Mind), open one to list its file posts, rehost `AudioContent` and `ImageContent`. One route/panel plus a header entry. Depends on the thread list the SDK already keeps.
2. **Marks + export** (~240 lines, with the schema port): verdict and landed reaction sets with the replace-one rule, optional reason reply, per-file tallies, the join into `aqua.listen.verdict.v1` and `verdict.json`/`verdict.md` download. This is Aqua's workflow end to end.
3. **Upload into an album** (~150 lines): thread-related send through the existing upload atoms, "new album".

Slices 1+2 serve the first use case. Each is its own PR. Because marks are ordinary thread replies, there is no separate "publish" slice.

## Open questions for the Meta

- How the client identifies the zone room (config id recommended).
- Whether exports are per listener (proposed) or a merged all-listeners file.
- Where `device` comes from, now that reactions cannot carry it (export dialog, proposed).

## Share a set (built, behind `fileZoneShare.enabled`)

The ruling `ratatoskr:ruling:persona-file-sharing-zone` asks that a set of files arrive together, not one attachment at a time. The zone already holds one thread per album, so a set is an album: **one root text message plus one `m.thread` reply per file**, the exact shape `buildAlbums` reads. Nothing new on the wire and no homeserver change; a Mind's mouth that posts into the zone room and a person using the client produce the same events.

Matrix options checked: (a) a thread, chosen: stock, rendered by every client, already the zone's album; (b) `m.gallery` (MSC4274) puts several items in one event, but it is unstable, most clients and this one do not render it, and each item still needs its own upload; (c) a shared custom relation: no client groups by it. A thread costs one extra event per set (the root) and nothing else.

Client, `src/app/features/albums`:

- `shareSet.ts`: `sendShareSet(port, title, files)`. Sends the root, then each file in pick order, each reply falling back to the previous event (`threadRelation`). A file whose upload fails is named in the result and the rest still go; a root that fails to send throws before any upload. The root alone is not an album in the list (`/threads` returns only roots that have a reply), so a share where every upload failed leaves a lone text message in the timeline. After a send the panel keeps only the failed files picked; a retry makes a second album. Ports are injected, so the order and failure rules are tested without a homeserver (`shareSet.test.ts` reads the sent events back through `buildAlbums`).
- `ShareSet.tsx`: phone layout. Idle, it is one text row, "Share files". Picking files (any number from the native picker; a second pick replaces the first) mounts a title field, the picked names on one dim line, and Send / Cancel as full-width rows; progress is "Sending 2 of 5". It is shown only on the album list (kept mounted but hidden while an album is open, so a running send keeps its state), one send at a time, and never in an encrypted zone (re-checked when Send is tapped) (the plaintext `info.sha256` the Mind verifies against is written in unencrypted rooms only).
- Content per file comes from `getMsgContent` in `features/room/msgContent.ts`, now also used by the composer, so a shared file and an attached file carry the same `info` including `sha256`.

Flag: `fileZoneShare.enabled` in `config.json`, default `false`. With it off nothing mounts.

Not built: a Mind's own path into the zone (outbox, Persona decision, mouth post) belongs to gamecult-ops / Huginn / the mouth, not this client; sharing into an existing album ("add files"); upload cancel; pagination beyond 100 albums/files.
