# File zone: design sketch

Status: design only. No code exists. Everything below is a proposal; items marked **UNKNOWN** are not yet verified against the Body.

Source: Meta ruling 2026-10-31, eureka mind `ratatoskr:ruling:file-zone-looks-like-file-sharing`.

## What it is

A file-sharing space beside the room timeline, not a view of it. A room's files appear as **albums**: a browsable grid or list with title, item count and date, opening into the files, with inline players and previews. The Matrix room (and its threads) is the storage and the fallback: other clients see ordinary messages and threads, and never need to know the zone exists. No homeserver change.

First use (Aqua): listen to audio in place, mark each clip keep / fix / drop with a one-line reason, export the marks as a file. See `/opt/commons/handoff/aqua-listen-kits-20261108/` (static `listen.html` kits that emit `verdict.json` + `verdict.md`); the zone replaces emailing that page around.

## Matrix event shapes (stock events only)

- **File** = an ordinary `m.room.message` with `msgtype` `m.audio` / `m.image` / `m.video` / `m.file`, uploaded to the media repo. The existing builders in `src/app/features/room/msgContent.ts` already produce these (`getAudioMsgContent`, `getImageMsgContent`, `getVideoMsgContent`, `getFileMsgContent`). Unchanged.
- **Album** = a thread. The root is a text `m.room.message` whose `body` is the title (`m.text`), and files are posted with `m.relates_to: { rel_type: "m.thread", event_id: <root> }`. Other clients see a normal thread; its count and last-event time come from the SDK's thread summary (`unsigned.m.relations.m.thread`: `count`, `latest_event`). Album date = root `origin_server_ts`. Cover = first image child, if any.
  - Why a thread and not a custom state event or a space: needs no power-level or server change, degrades to something readable, and the SDK already tracks it. Cost: any member can add to it; an album is only as structured as its root.
- **Loose files** (no thread) fall into an implicit "Unsorted" album, newest first.
- **Custom marker on the root** so the zone can tell albums from chat threads: an extra content key, e.g. `org.gamecult.album: { v: 1 }`. Unknown keys are preserved by servers and ignored by other clients. **UNKNOWN:** whether to show every thread as an album instead and skip the marker; the marker is cleaner but is the one bit of non-stock shape.
- **Edits/redaction**: renaming = `m.replace` on the root; deleting a file = redact the child. Stock.

## Marks (keep / fix / drop + one line)

Two options; recommend a hybrid.

1. **Local only**: marks live in the client (IndexedDB), never sent. Zero room noise, private, lost with the browser. Fine for a lone listener, wrong for "Aqua hears it, others see the verdict".
2. **Room events**: one small event per mark, related to the file event. Recommended shape: `m.room.message` `m.notice` in the same thread is visible to everyone but is chat spam. Better is an event type of our own, `org.gamecult.file_mark`, content `{ "m.relates_to": { "rel_type": "m.reference", "event_id": <file event> }, "verdict": "keep"|"fix"|"drop", "reason": "<one line>" }`. Latest mark per (sender, file) wins; changing one means sending a new event. Other clients ignore unknown event types, so no spam, and the room history stays the store.
   - Alternative: `m.annotation` reactions with a key of `keep`/`fix`/`drop`, which stock clients already render; but a reaction key has no room for the reason line. Rejected for that.
   - **UNKNOWN:** do the room's power levels allow custom event types for ordinary members (default `events_default` covers them); do synapse/tuwunel/conduwuit servers send unknown types through sync to us; encrypted rooms carry them as `m.room.encrypted` like any other (fine, expected).
3. **Hybrid (proposed)**: write marks locally first (instant, offline), publish to the room only on explicit "share marks". Keeps the player responsive and the room quiet.

## Export

Client-side only. "Export marks" builds a file from the marks the viewer can see for one album and either downloads it or uploads it into the album as another file:

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
- On success, the msgContent builder produces the event; the zone adds `m.relates_to` thread to the album root before sending (the composer already does this for thread replies, `RoomInput.tsx`).
- "New album" = send the root text event first (with the marker), then upload into it. Multi-file drop = N events, sent in order.
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

Goal: Aqua can open a room, see an album of clips, play them, mark them, export. Estimates are rough lines of TypeScript, tests excluded.

1. **Read-only album list + album view** (~250 lines): derive albums from threads (marker or all-threads, see UNKNOWN), list/grid, rehost `AudioContent` and `ImageContent`. No upload, no marks. One new route/panel plus entry in the room header. This alone replaces "scroll the timeline".
2. **Local marks + export** (~200 lines): IndexedDB store keyed (room, file event id), three buttons and a reason field, `verdict.json`/`verdict.md` download. This is Aqua's actual workflow and needs no room writes.
3. **Upload into an album** (~150 lines): thread-related send through the existing upload atoms, "new album".
4. **Publish marks as room events** (~120 lines): `org.gamecult.file_mark`, read-back merge of other people's marks.

Each is its own PR. Slices 1+2 serve the first use case; 3 and 4 follow once someone other than the listener needs to see the result.

## Open questions for the Meta

- Album = thread with a marker, or any thread? (above)
- Marks private-by-default with explicit share, or shared by default? (above: private)
- Is one flat album level enough, or do albums nest under a room's space structure? Proposed: flat, one level, per room.
