# Dings

Pre-rendered earcons, served at `public/dings/` and read at runtime by `src/app/features/dings`.
Aqua renders the clips; nothing here is synthesised in the browser.

    dings/manifest.json
    dings/senders/<mxid-localpart>/<motif>.ogg
    dings/neutral/<motif>.ogg

`manifest.json` is `{ "neutral": { <motif>: "<path>" }, "senders": { <localpart>: { <motif>: "<path>" } } }`
with motif one of `mention`, `dm`, `message`, `invite`; paths are relative to this folder, `.ogg` or `.mp3`.
A sender's own clip wins, else the neutral clip, else silence. Without a `manifest.json` the client keeps
its stock notification sounds; once one exists, a motif with no clip is silent.

The set here is Aqua's v3 (AquaSynth PR #22, staged at minds.gamecult.org/aqua/dings-voices-70a9795),
Nibu on proposal 1 (static-filter square). Nobody has heard it. The client plays none of it unless the
client config sets `"dings": { "enabled": true }` (default off, as in `config.json`).
