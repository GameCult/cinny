# Dings

Pre-rendered earcons, served at `public/dings/` and read at runtime by `src/app/features/dings`.
Aqua renders the clips; nothing here is synthesised in the browser.

    dings/manifest.json
    dings/<mxid-localpart>/<motif>.ogg

`manifest.json` is `{ "neutral": { <motif>: "<path>" }, "senders": { <localpart>: { <motif>: "<path>" } } }`
with motif one of `mention`, `dm`, `message`, `invite`; paths are relative to this folder, `.ogg` or `.mp3`.
A sender's own clip wins, else the neutral clip, else silence. Without a `manifest.json` the client keeps
its stock notification sounds; once one exists, a motif with no clip is silent.
