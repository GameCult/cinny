# Third-party notices

## d3-celestial (constellation lines)

The constellation line chains in `src/app/features/scene/ridge/nightSkyData.ts` are derived from
`data/constellations.lines.json` of d3-celestial, https://github.com/ofrohn/d3-celestial,
under the licence below.

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.```

## Erosion filter (ridge baker)

`scripts/ridge-bake/erosion/ErosionFilter.cs`, and that file alone, is the octave loop of Rune Skovbo Johansen's Advanced Terrain Erosion Filter (Shadertoy wXcfWn; blog post "Fast and gorgeous erosion filter", March 2026), ported from the C# transcription in lpmitchell/AdvancedTerrainErosion. Modified: planar use, run scale-free, height delta only, and each octave weighted by the sample's footprint.

- Copyright (c) 2025 Rune Skovbo Johansen; C# conversion by Luke Mitchell (2026).
- Licence: Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The file keeps its MPL-2.0 header; the rest of the helper (Program.cs, the project files, tests) is MIT.
- The stripe primitive it calls, `math.phacelle`, is CultMath's (CultLib, `packages/cultmath`, at the commit in `scripts/ridge-bake/erosion/CULTMATH_PIN`); CultMath's own THIRD-PARTY-NOTICES.md covers it and ships with the helper build.
