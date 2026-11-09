# Demo pose thumbnails

These 24 PNGs (about 200 KB, 160 px wide, palette-quantised) are downscaled copies of GameCult's own
Persona art from `/opt/commons/cast-art/poses`. That directory carries no provenance or licence note:
the image model that made the art and the terms it was made under are not recorded.

They exist only so the dev preview's pretend homeserver (`src/preview-demo/`) can show pose portraits.
The dev workflow copies them into `dist/public/poses`; real builds sync the full art with
`npm run sync:poses` and do not use this folder.

Strip them if their terms turn out not to allow this: delete this folder and the `Add the demo pose
art` step in `.github/workflows/rat-dev-preview.yml`. Pose portraits in the demo then show broken
images; nothing else depends on them.
