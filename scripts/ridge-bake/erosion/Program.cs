// MIT. The ridge baker's erosion helper: one call per march.
//   RidgeErosion --version                         prints {"cultmath_commit", "source_sha256"}
//   RidgeErosion --knobs <json> in.f32 out.f32      in: rows of (E, N, h, dh/dE, dh/dN, F) float32 little-endian; out: one float32 height delta (m) per row
// Statistics go to stderr as one JSON line.
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using RidgeErosion;

if (args.Length == 1 && args[0] == "--version")
{
    string Meta(string key) => Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>().First(a => a.Key == key).Value ?? "";
    Console.WriteLine(JsonSerializer.Serialize(new { cultmath_commit = Meta("cultmath_commit"), source_sha256 = Meta("source_sha256") }));
    return 0;
}
if (args.Length != 4 || args[0] != "--knobs") { Console.Error.WriteLine("usage: RidgeErosion --version | --knobs <json> in.f32 out.f32"); return 2; }

var j = JsonDocument.Parse(args[1]).RootElement;
var knobs = new Knobs(j.GetProperty("amplitude_m").GetSingle(), j.GetProperty("cell_m").GetSingle(), j.GetProperty("octaves").GetInt32(),
                      j.GetProperty("gully_weight").GetSingle(), j.GetProperty("detail").GetSingle(), j.GetProperty("fade_low_m").GetSingle(), j.GetProperty("fade_high_m").GetSingle());
var bytes = File.ReadAllBytes(args[2]);
if (bytes.Length % 24 != 0) { Console.Error.WriteLine("in.f32 is not whole rows of 6 float32"); return 2; }
var rows = MemoryMarshal.Cast<byte, float>(bytes).ToArray(); var n = rows.Length / 6; var delta = new float[n];
long calls = 0, active = 0; var sw = Stopwatch.StartNew();
Parallel.For(0, (n + 4095) / 4096, () => (c: 0L, a: 0L), (b, _, acc) =>
{
    for (var i = b * 4096; i < Math.Min(n, (b + 1) * 4096); i++)
    {
        var r = i * 6; delta[i] = ErosionFilter.Delta(knobs, rows[r], rows[r + 1], rows[r + 2], rows[r + 3], rows[r + 4], rows[r + 5], out var c);
        acc.c += c; if (c > 0) acc.a++;
    }
    return acc;
}, acc => { Interlocked.Add(ref calls, acc.c); Interlocked.Add(ref active, acc.a); });
File.WriteAllBytes(args[3], MemoryMarshal.AsBytes(delta.AsSpan()).ToArray());
Console.Error.WriteLine(JsonSerializer.Serialize(new { samples = n, active, phacelle_calls = calls, seconds = sw.Elapsed.TotalSeconds }));
return 0;
