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

| field | where | note |
|---|---|---|
| `msgtype` | content | selects the kind from the file's mimetype prefix |
| `body`, `filename` | content | both the file's name (display only; never a path) |
| `url` | content | the `mxc://` of an unencrypted file; the mouth reads it |
| `file` | content | present instead of `url` in an encrypted room: `{url, key, iv, hashes.sha256 (ciphertext), v}`. A Mind has no key; the mouth refuses it |
| `info.mimetype` | content | the browser-reported type, normalised by `safeFile` (e.g. `application/ogg` becomes `audio/ogg`). A claim, not proof: the mouth sniffs magic bytes |
| `info.size` | content | bytes of the file as uploaded |
| `info["org.gamecult.sha256"]` | content | lower-case hex sha256 of the plaintext bytes, computed by the client before send; written in unencrypted rooms only (a plaintext hash in an encrypted room would leak the file's identity) |

The hash is computed over the same bytes that are uploaded. A file sent by something other than this
client may lack `info["org.gamecult.sha256"]`; the mouth then logs the hash it computed and the receipt
below is displayed as unchecked.

Image and video events also carry `info.w`, `info.h`, `info.xyz.amorgan.blurhash` and a thumbnail
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

After a successful fetch the Mind posts one event of type `org.gamecult.file_received` to the room of the
file, as a reply in the album's thread, so it arrives with the album's own listing (no extra request):

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

No paths, no URLs, no filenames. The Mind is the event's `sender`. The receipt carries no `msgtype`, so
older clients and the album's file listing ignore it.

The client draws it on the file row as `read by <Mind>`:

- one receipt per Mind per file, the latest wins, a second Mind adds a name;
- `sha256` equal to `info["org.gamecult.sha256"]`: plain `read by <Mind>`;
- both present and different: `read by <Mind> (hash differs)`;
- either missing: plain `read by <Mind>`, unverified;
- a receipt whose `event_id` is not a file in that album, a malformed one, or a redacted one is ignored.

A receipt is a claim by its sender and is shown to anyone in the room; any member could post one.
It proves nothing about who read the file.

## Not built yet

- Files sent from the composer carry no thread relation, so they reach an album only if written into a
  thread by another tool; the album upload path (docs/file-zone.md, "Upload") is unwritten. Receipts are
  thread replies, so they show only where the file is.
- Encrypted zones are not listed.
