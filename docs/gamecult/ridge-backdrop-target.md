# Ridge backdrop target

The scene's bottom silhouette is replaced by baked A+D ridge planes. The baker is Python and offline; the browser composes pre-lit planes over the live physical sky. Typed state for this campaign (ideas, questions, rulings, cuts) lives in the instance mind `nibu`, campaign `ratatoskr-backdrop`; this file keeps only the ends.

## Why
The live noise ridge is nearly invisible on a phone (about 1.35:1 against the darkest sky) because every ridge pixel is lifted to the text-contrast floor, and the star dots show between nav and header glyphs because the shell is transparent. Meta, 2026-11-13: do not polish the old backdrop; ship the A+D ridge pipeline (round 2 mockup: https://minds.gamecult.org/nibu/ridge-mockups-ad/).

## Ends
- One owner per decision: the baker owns ridge geometry and shading; the runtime owns only frame choice, blending, camera drift and compositing. No ridge geometry is computed in the browser.
- Nothing from the scene paints above app content: the scene is one stacking context at the back of the app, and nothing it creates has its own z-index or lives outside it.
- Phone cost is bounded: no per-frame script for the ridge, decoded size and fetched size gated in CI.
- The baker has fixtures with known right answers (the far-plateau spike, chain-end taper, slot union, seam) and a mutation runner that must kill each re-introduced cause.
- A baked asset names its baker version, DEM source and licence in a validated manifest; the credits shown in the Sky menu come from the manifest.

## Not in scope
Button size (Void's). Patching the old noise-ridge path. Cone sampling. Live DEM access from the browser.
