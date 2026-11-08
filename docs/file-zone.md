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

## Marks (keep / fix / drop + one line)

A mark is a **thread reply to the file it judges**, so it lives in the same thread, is readable in any client, and needs no custom event type:

- `m.room.message`, `msgtype` `m.text`, `body` = `keep: <reason>` (or `fix:` / `drop:`), `m.relates_to` = `{ rel_type: "m.thread", event_id: <album root>, "m.in_reply_to": { event_id: <file event> } }`.
- Plus one structured key for the zone to read without parsing prose: `org.gamecult.mark: { verdict: "keep"|"fix"|"drop", reason: "<one line>", target: <file event id> }`. Unknown keys survive servers and are ignored by other clients; the `body` is the fallback if the key is stripped or absent. **UNKNOWN:** whether to also parse a bare `keep: ...` reply from a client that cannot send the key; recommend yes, as a tolerant reader of `body`.
- Latest mark by a given sender on a given file wins; changing a mark is a new reply (or an `m.replace` of the old one; prefer replace so the thread does not grow). The zone shows the latest per sender, and everyone's marks are visible on the file.
- **Why replies and not `m.annotation`**: an annotation key is a short string with no room for the reason line, and stock clients show reactions as chips with no text. Annotations stay available for a lightweight unreasoned ack, if wanted (**UNKNOWN**, not recommended in v1).
- **Local marks**: the client keeps an unsent mark draft in IndexedDB so playback and marking stay instant and survive a dropped connection; "send" publishes the reply. Marks are visible to the room once sent (the room is the shared store). **UNKNOWN:** whether Aqua wants a "private until I export" mode; if so it is local-only and the draft never publishes.

## Export

Client-side only. "Export marks" builds a file from the mark replies in one album (the viewer's own, or everyone's) and either downloads it or uploads it into the album as another file:

- `verdict.json`: `{ album, exported_at, marks: [{ file, sha256?, name, verdict, reason, by }] }`
- `verdict.md`: human table of the same.

Matches the shape the `aqua-listen` kits already emit (`verdict.json` + `verdict.md`), so downstream tooling does not change. **UNKNOWN:** exact field names of the kits' `verdict.json`; read `tools/aqua-listen` in GameCult/AquaSynth (PR #16) before fixing the schema. Per ruling hygiene, JSON here is a xenos-boundary export, not state.

## Mobile-first layout

- Phone width is the design width; desktop adds columns.
- Level 1, album list: one column, each row = cover/icon, title, "N files", date. Tap opens.
- Level 2, album: list by default (title, duration/size), grid toggle for images. Audio rows play in place, one at a time (starting a clip stops the last), a persistent mini-player at the bottom with seek.
- Mark controls on each audio row: three large tap targets (keep / fix / drop) and a one-line text field that appears after a choice. Thumb-reachable, no modal.
- Back is one level up; the room timeline stays one tap away (the zone is a sibling view, not a replacement). **UNKNOWN:** where the entry lives in the room header; check `RoomViewHeader.tsx`, `Room.tsx` for how the member drawer and pin menu attach.

## Upload

Reuse the composer's pipeline, pointed at an album instead of the main timeline:

- `createUploadAtom` / `useBindUploadAtom` (`src/app/state/upload.ts`), `UploadCard`, `upload-board` for progress.
- On success, the msgContent builder produces the event; the zone adds the thread relation to the album root before sending (the composer already does this for thread replies, `RoomInput.tsx`).
- "New album" = send the root text event, then upload into its thread. Multi-file drop = N events, sent in order. 
- Size limit from `MediaConfigLoader` (server `m.upload.size`). **UNKNOWN:** whether the 32 MB `shelf` kit's clips (42 x ~0.75 MB) should be uploaded individually or batched; individually is the only option without a server change.

## Existing code to reuse (verified present in the repo)

| need | where |
|---|---|
| audio player (play/seek/volume, encrypted download) | `src/app/components/message/content/AudioContent.tsx` (210 lines) |
| video, image, generic file | `.../content/VideoContent.tsx`, `ImageContent.tsx`, `FileContent.tsx` |
| full-screen image viewer | `src/app/components/image-viewer/ImageViewer.tsx` |
| media dispatch by msgtype | `src/app/components/RenderMessageContent.tsx`, `message/MsgTypeRenderers.tsx` |
| upload + progress | `state/upload.ts`, `components/upload-card`, `upload-board` |
| event content builders | `features/room/msgContent.ts` |
| thread plumbing | `features/room/message/Message.tsx`, `RoomTimeline.tsx`, `RoomInput.tsx` (thread relation on send) |
| room-scoped file/pin precedent | `features/room/room-pin-menu/RoomPinMenu.tsx` |

Nothing named "gallery" exists as a feature; `AudioContent` takes its controls as render props (`renderMediaControl`), so it can be rehosted in a row without a fork. **UNKNOWN:** whether `AudioContent` can be rendered outside a timeline event context (it needs only `url`, `info`, `mimeType`, `encInfo`, from the event content, so probably yes).

## First slice (what to build first)

Rough lines of TypeScript, tests excluded.

1. **Read-only albums + album view** (~250 lines): list the room's thread roots as albums (grouped or filterable by author = Mind), open one to list its file posts, rehost `AudioContent` and `ImageContent`. One route/panel plus a header entry. Depends on the thread list the SDK already keeps.
2. **Marks + export** (~220 lines): three buttons and a reason field per audio row, sent as the thread reply above (with an IndexedDB draft), latest-per-sender merge on read, `verdict.json`/`verdict.md` download. This is Aqua's workflow end to end.
3. **Upload into an album** (~150 lines): thread-related send through the existing upload atoms, "new album".

Slices 1+2 serve the first use case. Each is its own PR. Because marks are ordinary thread replies, there is no separate "publish" slice.

## Open questions for the Meta

- How the client identifies the zone room (config id recommended).
- Edit-in-place (`m.replace`) versus new reply for changing a mark (replace recommended).
- Whether a private, never-published marking mode is wanted.
