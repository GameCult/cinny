// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Advanced Terrain Erosion Filter, Copyright (c) 2025 Rune Skovbo Johansen (Shadertoy wXcfWn; blog
// "Fast and gorgeous erosion filter", March 2026; MPL-2.0), as transcribed to burstable C# in
// lpmitchell/AdvancedTerrainErosion (MPL-2.0). Modified by GameCult: planar use only, run scale-free
// (positions and heights in units of the cell, slopes dimensionless), only the height delta is output,
// and each octave is weighted by the footprint of the sample (a band limit: no octave at or above
// the Nyquist wavelength of the march step contributes). The stripe primitive is CultMath's
// math.phacelle; it is called here, never ported.

using CultMath;

namespace RidgeErosion;

/// <summary>The look knobs of one place (places.json `erosion`), in metres.</summary>
public readonly record struct Knobs(float AmplitudeM, float CellM, int Octaves, float GullyWeight, float Detail, float FadeLowM, float FadeHighM);

public static class ErosionFilter
{
    // Fixed from lpmitchell's example configuration (the knobs the operator does not tune).
    public const float CellScale = 0.7f, Normalization = 0.5f, Lacunarity = 2f, Gain = 0.5f;
    const float RoundX = 0.1f, RoundY = 0f, RoundZ = 0.1f, RoundW = 2f;                 // rounding
    const float OnsetX = 1.25f, OnsetY = 1.25f;                                         // onset (z, w drive the ridge map, which is not emitted)
    const float AssumedLength = 0.7f, AssumedMix = 1.0f;                                // assumed slope
    const float Tau = 6.2831855f;

    /// <summary>Wavelength in metres of the stripes of octave o: cell c_o = cell_m / 2^o, stripes c_o / CellScale.</summary>
    public static float Wavelength(float cellM, int octave) => cellM / MathF.Pow(Lacunarity, octave) / CellScale;

    /// <summary>1 at six samples per wavelength, 0 at four (so nothing at or above Nyquist, two samples, contributes), smooth between.</summary>
    public static float Weight(float cellM, int octave, float footprintM)
    {
        var t = Math.Clamp((Wavelength(cellM, octave) - 4f * footprintM) / (2f * footprintM), 0f, 1f);
        return t * t * (3f - 2f * t);
    }

    /// <summary>One stripe evaluation: the planar z = 0 slice of CultMath's 3D cells. Returns (cos, sin).</summary>
    public static (float Cos, float Sin) Stripe(float px, float py, float sideX, float sideY)
    {
        var ph = math.phacelle(new float3(px, py, 0f), new float3(sideX, sideY, 0f), 0.25f, Normalization);
        return (ph.cosine.w, ph.sine.w);
    }

    /// <summary>
    /// Height delta in metres at a sample e, n metres east and north of the observer, on ground of height h (m) and slope (gE, gN)
    /// (dimensionless), with footprint footprintM (m). Octaves run while their weight is above 0; the delta is exactly 0 where octave 0 has none.
    /// </summary>
    public static float Delta(in Knobs k, float e, float n, float h, float gE, float gN, float footprintM, out int calls)
    {
        calls = 0;
        if (k.AmplitudeM <= 0f || Weight(k.CellM, 0, footprintM) <= 0f) return 0f;
        float cell = k.CellM, strength = k.AmplitudeM / cell, freq = 1f, px = e / cell, py = n / cell, dh = 0f, roundMult = 1f;
        var fade = Math.Clamp(2f * (h - k.FadeLowM) / (k.FadeHighM - k.FadeLowM) - 1f, -1f, 1f);
        var slopeLen = MathF.Max(MathF.Sqrt(gE * gE + gN * gN), 1e-10f);
        var roundInput = Lerp(RoundY, RoundX, Clamp01(fade + 0.5f)) * RoundZ;
        var combi = EaseOut(SmoothStart(slopeLen * OnsetX, roundInput * OnsetX));
        var gsx = gE + (gE / slopeLen * AssumedLength - gE) * AssumedMix;
        var gsy = gN + (gN / slopeLen * AssumedLength - gN) * AssumedMix;
        for (var o = 0; o < k.Octaves; o++)
        {
            var w = Weight(cell, o, footprintM);
            if (w <= 0f) break;
            var gl = MathF.Sqrt(gsx * gsx + gsy * gsy);
            float dx = gl > 1e-10f ? gsx / gl : 0f, dy = gl > 1e-10f ? gsy / gl : 0f;
            float sx = -dy * CellScale * Tau, sy = dx * CellScale * Tau;
            var (c, s) = Stripe(px * freq, py * freq, sx, sy); calls++;
            float zx = -sx * freq, zy = -sy * freq, sloping = MathF.Abs(s), sgn = MathF.Sign(s);
            gsx += sgn * zx * strength * k.GullyWeight; gsy += sgn * zy * strength * k.GullyWeight;
            var fadedX = Lerp(fade, c * k.GullyWeight, combi);
            dh += w * fadedX * strength;
            fade = fadedX;
            var roundOctave = Lerp(RoundY, RoundX, Clamp01(c + 0.5f)) * roundMult;
            var newMask = EaseOut(SmoothStart(sloping * OnsetY, roundOctave * OnsetY));
            combi = PowInv(combi, k.Detail) * newMask;
            strength *= Gain; freq *= Lacunarity; roundMult *= RoundW;
        }
        return dh * cell;
    }

    static float Lerp(float a, float b, float t) => a + (b - a) * t;
    static float Clamp01(float v) => Math.Clamp(v, 0f, 1f);
    static float PowInv(float t, float power) => 1f - MathF.Pow(1f - Clamp01(t), power);
    static float EaseOut(float t) { var v = 1f - Clamp01(t); return 1f - v * v; }
    static float SmoothStart(float t, float smoothing) => t >= smoothing ? t - 0.5f * smoothing : 0.5f * t * t / smoothing;
}
