using CultMath;
using RidgeErosion;
using Xunit;

public class ErosionTests
{
    static readonly Knobs K = new(8f, 240f, 6, 0.5f, 1.5f, 300f, 3200f);

    [Fact]
    public void PhacelleIsCultMaths()
    {
        var rng = new System.Random(7);
        for (var i = 0; i < 1000; i++)
        {
            float px = (float)(rng.NextDouble() * 200 - 100), py = (float)(rng.NextDouble() * 200 - 100), sx = (float)(rng.NextDouble() * 8 - 4), sy = (float)(rng.NextDouble() * 8 - 4);
            var want = math.phacelle(new float3(px, py, 0f), new float3(sx, sy, 0f), 0.25f, ErosionFilter.Normalization);
            var (c, s) = ErosionFilter.Stripe(px, py, sx, sy);
            Assert.Equal(BitConverter.SingleToInt32Bits(want.cosine.w), BitConverter.SingleToInt32Bits(c));
            Assert.Equal(BitConverter.SingleToInt32Bits(want.sine.w), BitConverter.SingleToInt32Bits(s));
        }
        var dir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../"));
        foreach (var f in Directory.GetFiles(dir, "*.cs"))
        {
            var t = File.ReadAllText(f);
            Assert.DoesNotContain("pcg" + "3d", t); Assert.DoesNotContain("0.01" + "111", t); Assert.DoesNotContain("cellular" + "_unit", t);
        }
    }

    [Fact]
    public void OctaveWeightsRespectFootprint()
    {
        for (var f = 1f; f <= 250f; f *= 1.07f)
            for (var o = 0; o < 8; o++)
            {
                var l = ErosionFilter.Wavelength(240f, o); var w = ErosionFilter.Weight(240f, o, f);
                if (l < 4f * f) Assert.Equal(0f, w);
                if (l >= 6f * f) Assert.Equal(1f, w);
                if (w > 0f) Assert.True(l >= 4f * f && l > 2f * f);
                Assert.True(ErosionFilter.Weight(240f, o, f * 1.01f) <= w + 1e-6f);     // monotone in the footprint
            }
    }

    [Fact]
    public void AmplitudeZeroIsZero()
    {
        var k = K with { AmplitudeM = 0f };
        for (var i = 0; i < 200; i++) Assert.Equal(0f, ErosionFilter.Delta(k, i * 13.7f, -i * 5.1f, 1500f + i, 0.3f, -0.2f, 1f, out _));
    }

    [Fact]
    public void FadedOctavesEqualCap()
    {
        // F = 12 m: L_0 = 343 > 72 (w 1), L_1 = 171 > 72 (1), L_2 = 86 > 72 (1), L_3 = 43 < 48 (0): three live octaves
        var capped = K with { Octaves = 3 };
        for (var i = 0; i < 100; i++)
        {
            float e = i * 37.3f, n = i * -11.9f, h = 1800f + i * 3;
            var a = ErosionFilter.Delta(K, e, n, h, 0.4f, 0.1f, 12f, out var ca); var b = ErosionFilter.Delta(capped, e, n, h, 0.4f, 0.1f, 12f, out var cb);
            Assert.Equal(3, ca); Assert.Equal(cb, ca); Assert.Equal(BitConverter.SingleToInt32Bits(b), BitConverter.SingleToInt32Bits(a));
        }
    }

    [Fact]
    public void ContinuousInFootprint()
    {
        // across each fade band (L_o between 4F and 6F) the delta moves by at most 1e-3 amplitude between F and F + 0.01 m
        for (var o = 0; o < 6; o++)
        {
            var l = ErosionFilter.Wavelength(240f, o);
            for (var f = l / 6.2f; f < l / 3.8f; f += 0.01f)
                for (var i = 0; i < 6; i++)
                {
                    float e = 101f + i * 53f, n = 77f - i * 31f;
                    var a = ErosionFilter.Delta(K, e, n, 2000f, 0.5f, 0.2f, f, out _); var b = ErosionFilter.Delta(K, e, n, 2000f, 0.5f, 0.2f, f + 0.01f, out _);
                    Assert.True(MathF.Abs(a - b) <= 1e-3f * K.AmplitudeM, $"octave {o} F {f}: {a} -> {b}");
                }
        }
    }

    [Fact]
    public void ParallelEqualsSerial()
    {
        const int n = 20000; var rng = new System.Random(3); var rows = new float[n * 6];
        for (var i = 0; i < n; i++) { rows[i * 6] = (float)(rng.NextDouble() * 4000 - 2000); rows[i * 6 + 1] = (float)(rng.NextDouble() * 4000 - 2000); rows[i * 6 + 2] = 1500f + (float)rng.NextDouble() * 1000; rows[i * 6 + 3] = (float)(rng.NextDouble() - .5); rows[i * 6 + 4] = (float)(rng.NextDouble() - .5); rows[i * 6 + 5] = 1f + (float)rng.NextDouble() * 60; }
        float[] Run(bool par)
        {
            var o = new float[n];
            void One(int i) { var r = i * 6; o[i] = ErosionFilter.Delta(K, rows[r], rows[r + 1], rows[r + 2], rows[r + 3], rows[r + 4], rows[r + 5], out _); }
            if (par) Parallel.For(0, n, One); else for (var i = 0; i < n; i++) One(i);
            return o;
        }
        Assert.Equal(Run(false), Run(true)); Assert.Equal(Run(true), Run(true));
    }
}
