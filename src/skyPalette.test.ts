import { describe, expect, it } from 'vitest';
import { SKY_VARIANTS, foldsTheme, hex, type Rgb, type SkyVariant } from './skyPalette';

const AA = 4.5;

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// "rgb(r g b / a)" or "#rrggbb" to [r, g, b, a]
const parse = (s: string): [number, number, number, number] => {
  if (s.startsWith('#')) return [...hex(s), 1];
  const m = s.match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/);
  if (!m) throw new Error(`unparsed colour ${s}`);
  return [+m[1], +m[2], +m[3], +m[4]];
};
const over = (top: [number, number, number, number], under: Rgb): Rgb => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
];

// every percent of the gradient, interpolated between stops
const sky = (v: SkyVariant): Rgb[] =>
  Array.from({ length: 101 }, (_, p) => {
    const i = Math.max(
      1,
      v.gradient.findIndex(([q]) => q >= p)
    );
    const [p1, c1] = v.gradient[i === 0 ? 0 : i];
    const [p0, c0] = v.gradient[i - 1];
    const t = Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
    const a = hex(c0);
    const b = hex(c1);
    return a.map((x, k) => x + (b[k] - x) * t) as unknown as Rgb;
  });

describe.each(SKY_VARIANTS)('$id contrast', (v) => {
  const t = foldsTheme(v);
  const report: string[] = [];

  // Text on a panel is judged where the panel sits on the sky alone, and where Surface or
  // SurfaceVariant sits on the Background panel on the sky; the lowest ratio over the
  // gradient is the one that counts.
  const panels = ['Background', 'Surface', 'SurfaceVariant'] as const;
  const states = ['Container', 'ContainerHover', 'ContainerActive'] as const;

  it.each(panels.flatMap((p) => states.map((s) => [p, s] as const)))(
    'OnContainer on %s %s holds AA at every gradient point',
    (p, s) => {
      const fg = hex(t[p].OnContainer);
      const ratios = sky(v).flatMap((g) => {
        const bg = over(parse(t.Background.Container), g);
        const direct = ratio(fg, over(parse(t[p][s]), g));
        return p === 'Background' ? [direct] : [direct, ratio(fg, over(parse(t[p][s]), bg))];
      });
      const worst = Math.min(...ratios);
      report.push(`${p}.${s} ${worst.toFixed(2)}`);
      expect(worst).toBeGreaterThanOrEqual(AA);
    }
  );

  it('link and user colours hold AA on Surface at every gradient point', () => {
    const colors = [v.link, ...v.userColors];
    colors.forEach((c) => {
      const ratios = sky(v).flatMap((g) => {
        const bg = over(parse(t.Surface.Container), over(parse(t.Background.Container), g));
        return [ratio(hex(c), bg), ratio(hex(c), over(parse(t.Surface.Container), g))];
      });
      const worst = Math.min(...ratios);
      report.push(`${c} ${worst.toFixed(2)}`);
      expect(worst).toBeGreaterThanOrEqual(AA);
    });
  });

  it.each(['Primary', 'Secondary', 'Success', 'Warning', 'Critical'] as const)(
    '%s: OnMain on Main/Hover/Active and OnContainer on Container states hold AA',
    (k) => {
      const f = t[k];
      (['Main', 'MainHover', 'MainActive'] as const).forEach((s) =>
        expect(ratio(hex(f.OnMain), hex(f[s]))).toBeGreaterThanOrEqual(AA)
      );
      (['Container', 'ContainerHover', 'ContainerActive'] as const).forEach((s) =>
        expect(ratio(hex(f.OnContainer), hex(f[s]))).toBeGreaterThanOrEqual(AA)
      );
    }
  );

  it('prints the ratios when SKY_REPORT is set', () => {
    if (process.env.SKY_REPORT) console.log(`${v.id}\n${report.join('\n')}`); // eslint-disable-line no-console
  });
});
