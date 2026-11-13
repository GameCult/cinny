# Symphony grammar harvest: Mimir's bioacoustic research

Follow-up: `ratatoskr:follow_up:symphony-grammar-harvest-mimir`. Source: GameCult/Mimir at
commit c6f4541eea61 (exists; read at that ref, not main), read-only through the forge API.
Paths below are Mimir paths. Written for Aqua (AquaSynth) before the generative activity grammar. It lives here because the symphony is a Ratatoskr cut (dings, then orbiting personas) and this repo is where its spec will be read; the follow-up named AquaSynth, where void holds no push right, so move it there if Aqua prefers.

## 1. The problem

One Mind's identity has to be a timbre plus a contour that stays recognisable after it is mixed with
the other Minds and passed through a lossy path. The symphony adds harmony (several Minds sounding
together as music), which Mimir never needed: Mimir emits one low-gain song at a time per speaker.

## 2. What Mimir found that transfers

Confidence: A = measured number in a receipt, B = measured but synthetic or single run,
C = design claim or authored opinion with no measurement behind it.

| Claim                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                        | Conf.                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Tidy lab beeps are the wrong signal for a room; a birdsong-like motif replaced them.                                                                                                                                                                                                                                                    | `docs/bioacoustic-timeline-watermark.md` L3-10 (stated as a decision, no listening test).                                                                                       | C                                |
| Identity is carried redundantly: contour survives pitch shift, rhythm survives bad frequency response, formant envelope survives a dead band, speaker variants expose room asymmetry.                                                                                                                                                   | same doc L82-95. Argument, not an ablation.                                                                                                                                     | C                                |
| A word needs no sequence grammar: one heard word identifies its event directly (128 words x 2 speaker variants, 4 syllables each). No de Bruijn grammar.                                                                                                                                                                                | same doc L26-33; `src/Mimir.Runtime/Synchronization/MimirBioacousticTimeline.cs` (WordCount, SymbolCount = WordCount\*SpeakerCount, BuildMotifs ~L690-730).                     | B                                |
| Word identity survives mel-cepstral warp/blur degradation; timing does not unless fitted as one global clock/delay hypothesis.                                                                                                                                                                                                          | `docs/bioacoustic-training-harness.md` L58-112: identity 0.908-0.997, timing 0.357 (before) vs 0.905 (after global clock fit), compact-fast-index clean.                        | A (synthetic)                    |
| Contestant shapes were scored against the same decoder family and damage panel; best was the six-syllable "canary-packet-trill" (two timing chips plus four payload-coloured formant notes), not the literal bird imitations.                                                                                                           | `research/bioacoustic-contestants-2026-05-24.md` L24-38, L128-174 (honest floor 88.4 language_score, 19 bps, payload 1.000 clean), L487-489 (96 ms motif is the best tradeoff). | A                                |
| Too-short or too-tight songs fail under blur: 0.100 s event spacing lost anchors to overlap; 0.105 s kept; 78 ms motif and 5-syllable finch-burst-packet collapsed (blur-light 4.358).                                                                                                                                                  | contestants doc L169-171, L446-455, L487-489.                                                                                                                                   | A                                |
| A 3-bit payload variant (separate band/rhythm bit) did not survive degradation (best 12.849, clean 8.084).                                                                                                                                                                                                                              | contestants doc L183-185.                                                                                                                                                       | A                                |
| Real birds carry identity through redundant contour, roughness, onset statistics and cepstral envelope together; Redpoll is dense chatter with short vertical attacks, not a neat token stream; Guan is a slow broad curved phrase, good for probing the channel, poor for bitrate. The packet song was judged "still too ladder-like". | contestants doc L565-581 (two Xeno-canto mirrors via Wikimedia; Brown Thornbill file invalid, L511-513, L534-539). Flux numbers L549-562.                                       | B (two recordings, hand reading) |
| Positive log-mel spectral flux is a good onset/anchor surface; sustained bands recede, attacks and glides light up.                                                                                                                                                                                                                     | contestants doc L541-545, L577-581; but the naive flux decoder lost on speed (43.6 vs 92.5 score, L231-246).                                                                    | B                                |
| Once the schedule is known, the receiver only discriminates among a few local candidates; wide identity search is only for acquisition. Streaming decoder reached 1121 score at 62.6x realtime, payload 1.000 on all nine damage cases.                                                                                                 | contestants doc L248-309.                                                                                                                                                       | A (synthetic damage)             |
| Polarity must be a nuisance variable; mic paths flip sign.                                                                                                                                                                                                                                                                              | contestants doc L391-395.                                                                                                                                                       | B (physical, one capture)        |
| Speaker split: left and right vocabularies differ in root (x0.94 / x1.08) and syllable weights, so each side is separable.                                                                                                                                                                                                              | `MimirBioacousticTimeline.cs` BuildMotifs ~L704-725 (read as code, no experiment isolates the benefit).                                                                         | C                                |

Rendering recipe actually in code (`MimirBioacousticTimeline.cs` AddSyllable ~L610-640): each syllable is
a log-frequency glide (exponential sweep) with a raised-cosine envelope, summed partials at
1, 1.5, 2, 2.75 times the glide (weights 1, 0.42, 0.24, 0.10) plus 0.08 weight of a slow "air" term,
20-32 ms long, four per word, gain 0.030 (canary profile 0.024 in `MimirBioacousticContestant.cs`).
Word roots are log-spaced 2.6 to 9.6 kHz; syllable frequencies are clamped 2.3 to 14.6 kHz;
word length 118 ms. Contours come from a small hand-written bank (about 7 contour shapes and 7 rhythm
offset sets, chosen by hash of word and speaker).

## 3. Design constraints for Aqua's grammar

1. Identity lives in several channels at once: contour (syllable glide shapes), log-frequency position
   (root), formant envelope (the partial ratios), rhythm (inter-syllable offsets) and per-speaker
   timbre. No single channel may be load-bearing. Place Minds on a log-frequency axis, not linear.
2. Do not build a sequence grammar for identity (de Bruijn or otherwise). The whole word is the unit;
   a hearer should identify the Mind from one short phrase. (watermark doc L31-33.) What it gives up:
   a de Bruijn code has a provable recovery property from a symbol stream; per-word identity has only
   an empirical one.
3. Keep words short and distinct, but not so tight that they overlap: Mimir's measured edge was about
   100 to 105 ms event spacing and a 96 ms six-syllable motif; below that identity decayed. Aqua's
   events need not carry timing, so it can relax this, which is untested.
4. Use sharp onsets for placement but avoid a ladder of evenly spaced rungs; Mimir's own verdict was
   that its packet song was still too ladder-like and real birds use irregular, redundant contour
   (contestants doc L573-576). Vary rhythm and syllable length per word as the code already does.
5. Reject: row of tidy lab beeps (watermark doc L3-6); literal bird imitation as an end in itself (the
   prettiest contestant, nightingale-cascade, was expensive and easy to confuse under smearing, per
   `MimirBioacousticContestant.cs` profile note); a third payload bit on a second axis (measured loss).
6. Keep the generator deterministic from a typed description (contour, root, rhythm, speaker tint),
   authored once and rendered, not regenerated in the audio callback. Contestants doc L493-496 states
   this as the AquaSynth lesson: separate authoring intent from realtime DSP.

## 4. What does not transfer, or is unknown

- Harmony. Mimir emits one voice per speaker and decodes one stream; nothing in the research tests
  simultaneous voices, intervals between Minds, consonance, or masking between concurrent songs.
  Searched for "harmon"; the only hit is the `HarmonicNotch` anchor kind (an envelope notch used as a
  timing anchor, `MimirBioacousticContestant.cs` ~L33, L231), not musical harmony.
- Orbiting spatialisation. Mimir's left/right split is a calibration device (one vocabulary per
  speaker to learn each side of the room), not a perceptual pan or orbit. Nothing here informs it.
- Pleasantness. There is no listening test, no psychoacoustic metric, and no loudness-weighted score
  in any file read. The only pleasantness evidence is the authored one-line verdicts on each profile in
  `MimirBioacousticContestant.cs` L52-170 ("lab bird with a clipboard", "most plausible room sound",
  "prettiest contestant") and the "wrong animal for a room" sentence. The score is
  `realtime * timing * frequency * payload_bitrate` (contestants doc L39-59): decodability only.
  Gain 0.021-0.030 is chosen for low audibility, not for pleasing anyone.
- Mimir's numbers are synthetic damage (mel-cepstral and log-mel warp/blur) plus a few Scarlett loopback
  runs. The first physical room runs decoded mics only partially (contestants doc L355-395), and the
  later live receipt's cardioid result was retracted as noise
  (`calibration/bioacoustic/complex-contour-live-20260525-063229.md`, correction at watermark doc L225-230).
- The pipeline decodes against a known schedule and tiny candidate set; Aqua's listener is a human
  mix, so none of the decoder scores say how distinguishable Minds are to a person.
- Not read: `src/Mimir.BufferSmoke` (the harness executable). It does not match a "bioacoustic" path
  filter on the tree listing, so I read its documentation (`docs/bioacoustic-training-harness.md`) and
  the `MimirBioacoustic*.cs` sources instead. The `artifacts/bioacoustic-training/` receipts were listed
  but not opened beyond the summary text in the docs.

## 5. Open questions for Aqua

- What is the "decoder" for Aqua: a human listener, a classifier, or both? Constraints above only
  hold against a machine decoder.
- Does a Mind keep one word for life, or does the grammar generate many songs sharing a timbre and root
  (activity-dependent contour over a fixed identity)? Mimir only has fixed words.
- How many Minds, and how are roots allocated on the log axis when several sound at once? Mimir used 2
  speaker variants per word and 128 words; harmony will change the spacing rule.
- Which dimension bends with activity (contour, rhythm density, gain) and which must stay fixed
  (timbre, root)? Mimir has no activity channel to copy.
- Is a measured pleasantness proxy wanted (roughness, masking, loudness-weighted)? Mimir has none to reuse.
- Spatialised orbit plus a speaker-keyed timbre: if the pan moves, does identity still rest on timbre
  alone? Mimir's per-side vocabulary is not a precedent.
