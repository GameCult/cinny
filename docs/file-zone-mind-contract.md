# File zone: what a Mind can read from a file event

Ruling `ratatoskr:ruling:persona-file-sharing-zone`. The Mind-side fetch is the mouth's
(`eureka-body:cut_spec:mouth-fetch-attachment.r1`); this page is the client side of the same contract.
A Mind cannot fetch an `mxc://` itself (the media endpoint answers 401), so it never holds one.

## What the Mind passes

Room id and event id of the file event. Never a bare `mxc://`, URL or hash. The mouth fetches the event,
reads the media reference from its content, and enforces the Mind's own membership in that room at fetch
time. A room the Mind is not in is refused by the mouth, whatever the client wrote.

## What the client writes (this repo, `RoomInput.tsx` send path)

A file event is an `m.room.message` whose `msgtype` is `m.audio`, `m.image`, `m.video` or `m.file`:

| field              | where   | note                                                                                                                                                                                       |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `msgtype`          | content | selects the kind from the file's mimetype prefix                                                                                                                                           |
| `body`, `filename` | content | both the file's name (display only; never a path)                                                                                                                                          |
| `url`              | content | the `mxc://` of an unencrypted file; the mouth reads it                                                                                                                                    |
| `file`             | content | present instead of `url` in an encrypted room: `{url, key, iv, hashes.sha256 (ciphertext), v}`. A Mind has no key; the mouth refuses it                                                    |
| `info.mimetype`    | content | the browser-reported type, normalised by `safeFile` (e.g. `application/ogg` becomes `audio/ogg`). A claim, not proof: the mouth sniffs magic bytes                                         |
| `info.size`        | content | bytes of the file as uploaded                                                                                                                                                              |
| `info.sha256`      | content | lower-case hex sha256 of the plaintext bytes, computed by the client before send; written in unencrypted rooms only (a plaintext hash in an encrypted room would leak the file's identity) |

The hash is computed over the same bytes that are uploaded, reading the whole file into memory before send (large videos pay for it); if hashing fails the file is sent without one. A file sent by something other than this
client may lack `info.sha256`; the mouth then logs the hash it computed, and the row can show no `read by`
for it.

`info.mimetype` and `info.size` are written on audio and file events always; on image and video events `info` exists only if the browser could load the media, otherwise `info` holds `sha256` alone. Image and video events also carry `info.w`, `info.h`, `info.xyz.amorgan.blurhash` and a thumbnail
reference; audio carries no duration. A Mind should not rely on any of those.

## Limits and refusals

- Size: the mouth streams at most 5 MiB and refuses a larger file. The client does not enforce this cap;
  its own limit is the homeserver's `m.upload.size`. A file over 5 MiB can be shared with people and
  not read by a Mind.
- Refusals are the mouth's and are typed: not a member of the room, bridged or Discord room, encrypted
  file, over the cap, content type not matching the magic bytes. The client does not re-check them and
  nothing in the client depends on the mouth's log.
- The Mind cites files by room id and event id only; a file in a room the Mind is not in does not exist
  for it.

## Receipt: `org.gamecult.file_received`

The Mind posts one event of type `org.gamecult.file_received` after a successful fetch, to the room of the
file. When the file has an album root the receipt is a reply in the album's thread, so it arrives with the album's
own listing; otherwise (a composer file sent with no thread) it is a plain room event with no `m.relates_to`. Both
count, and the client finds a receipt by its `event_id` anywhere in the room's loaded timeline or the album's thread:

```json
{
  "m.relates_to": { "rel_type": "m.thread", "event_id": "<album root event id>" },
  "org.gamecult.file_received": {
    "event_id": "<file event id>",
    "sha256": "<hex sha256 of the bytes the Mind fetched>",
    "size": 123456
  }
}
```

A plain room-event receipt may also carry `m.relates_to: {rel_type: "m.reference", event_id: <file event id>}`, which lets
the mouth find its earlier receipts through `/relations` for dedup. The client matches by `content.event_id` and reads no
relation but this one: if a `m.reference` is present its `event_id` must equal `content.event_id`, else the receipt counts
for nothing. A thread relation is not read. However many receipts a Mind has posted for a file, the row draws one
`read by` for that Mind.

Two rules, both enforced on each side:

1. **The sender is the Mind.** The row trusts the Matrix `sender` of the receipt event and nothing inside it:
   no Mind field is read. `read by X` counts only when the sender is X's own Matrix identity (the
   full id is `@<mind>:<this homeserver>` for a Mind in the Persona catalogue; a display name, a lookalike or another server's `@void:evil.example` does not count).
2. **Read means verified.** The Mind posts only after the sha256 of the bytes it fetched equals the file
   event's `info.sha256`, and the receipt carries that hash. On a mismatch it posts nothing (or a typed
   refusal that the row does not draw). The row checks it again: the receipt's `sha256` must equal the
   file event's `info.sha256`. A file event with no `info.sha256` can show no `read by`.

The receipt is inert: no paths, URLs, filenames or anything a browser would fetch, and the client reads only
`event_id`, `sha256` and the sender. It has no `msgtype`, so the album's file listing ignores it. The mouth's
log is the fuller record for Minds; this event is the public tick.

The row draws `read by <Mind>`: one receipt per Mind per file (the latest), several Minds side by side. A
receipt for an event that is not a file of that album, a malformed one, and a redacted one are ignored.
The sender check keeps a member from ticking for a Mind; it does not prove the Mind read the file beyond
what the hash and the Mind's own account show.

## Not built yet

- Files sent from the composer carry no thread relation, so they reach an album only if written into a
  thread by another tool; the album upload path (docs/file-zone.md, "Upload") is unwritten. Their receipts are plain
  room events, and the timeline row for the file shows `read by` from them.
- The timeline row reads the room's loaded timeline only: a receipt older than what the client has paged in is not
  seen there (an album's own listing reads the thread, which is paged separately).
- Encrypted zones are not listed.
