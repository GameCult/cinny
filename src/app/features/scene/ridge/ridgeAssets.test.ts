// The committed baked set under public/ridge: what the baker wrote is what ships, within the budget the baker itself refuses on
// (export.py PAIR_BYTES_MAX, DECODE_BYTES_MAX). Reads with node fs. The gate reads each plane's own bytes, not the manifest's claims about
// them: the WebP container is walked and its stated dimensions (VP8X canvas, VP8 / VP8L frame header) must equal the manifest's w and h,
// which the decode budget is computed from; and the bake id is re-derived from the plane bytes, as the baker derives it, so any
// corruption of a plane, same length or not, fails. No pixel decoder is in the tree; the baker's own check decodes pixels.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAME_KEYS, PLANE_NAMES, parseIndex, parseManifest } from './manifest';

/** The same two constants as scripts/ridge-bake/export.py: two adjacent frames, fetched and decoded. */
export const PAIR_BYTES_MAX = 800_000;
export const DECODE_BYTES_MAX = 20_000_000;

interface WirePlane {
  file: string;
  bytes: number;
  w: number;
  h: number;
}
interface WireFrame {
  key: string;
  planes: Record<string, WirePlane>;
  luma: { min: number; max: number };
}
export interface WireManifest {
  bake_id: string;
  frames: WireFrame[];
}

const planes = (f: WireFrame): WirePlane[] => PLANE_NAMES.map((n) => f.planes[n]);

/** Why a manifest breaks the size gate, or undefined. Frames are taken in FRAME_KEYS order; the pairs are neighbours, and night meets dawn. */
export function sizeGate(m: WireManifest): string | undefined {
  const byKey = FRAME_KEYS.map((k) => m.frames.find((f) => f.key === k) as WireFrame);
  for (let i = 0; i < byKey.length; i += 1) {
    const pair = [byKey[i], byKey[(i + 1) % byKey.length]];
    const ps = pair.flatMap(planes);
    const fetched = ps.reduce((a, p) => a + p.bytes, 0);
    const decoded = ps.reduce((a, p) => a + p.w * p.h * 4, 0);
    if (fetched > PAIR_BYTES_MAX) return `${pair[0].key}+${pair[1].key} fetches ${fetched}`;
    if (decoded > DECODE_BYTES_MAX) return `${pair[0].key}+${pair[1].key} decodes ${decoded}`;
  }
  return undefined;
}

/**
 * Why a buffer is not a well-formed WebP of `w` x `h`, or undefined. Checks the RIFF envelope (its size is the file's), that the chunks tile
 * the file exactly, and the dimensions the container and the bitstream header each state.
 */
export function webpFault(b: Uint8Array, w: number, h: number): string | undefined {
  const u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return 'not a RIFF WEBP';
  if (u32(4) + 8 !== b.length) return `RIFF size ${u32(4)} does not fit a ${b.length} byte file`;
  const dims: string[] = [];
  let seen = 0;
  let o = 12;
  while (o < b.length) {
    if (o + 8 > b.length) return 'a chunk header runs past the file';
    const id = tag(o);
    const len = u32(o + 4);
    const body = o + 8;
    if (body + len > b.length) return `chunk ${id} runs past the file`;
    if (id === 'VP8X') dims.push(`${u24(body + 4) + 1}x${u24(body + 7) + 1}`);
    if (id === 'VP8 ') {
      if (b[body + 3] !== 0x9d || b[body + 4] !== 0x01 || b[body + 5] !== 0x2a)
        return 'VP8 start code missing';
      dims.push(
        `${(b[body + 6] | (b[body + 7] << 8)) & 0x3fff}x${
          (b[body + 8] | (b[body + 9] << 8)) & 0x3fff
        }`
      );
      seen += 1;
    }
    if (id === 'VP8L') {
      if (b[body] !== 0x2f) return 'VP8L signature missing';
      const bits = u32(body + 1);
      dims.push(`${(bits & 0x3fff) + 1}x${((bits >>> 14) & 0x3fff) + 1}`);
      seen += 1;
    }
    o = body + len + (len & 1);
  }
  if (o !== b.length) return 'the chunks do not tile the file';
  if (seen !== 1) return `${seen} bitstream chunks`;
  const bad = dims.find((d) => d !== `${w}x${h}`);
  return bad ? `states ${bad}, the manifest ${w}x${h}` : undefined;
}

/** The baker's bake id (export.py `bake_id`): first 12 hex of sha256 over the plane bytes, frames in FRAME_KEYS order, planes far, mid, near. */
export function bakeIdOf(planeBytes: (frame: string, plane: string) => Uint8Array): string {
  const h = createHash('sha256');
  FRAME_KEYS.forEach((k) => PLANE_NAMES.forEach((n) => h.update(planeBytes(k, n))));
  return h.digest('hex').slice(0, 12);
}

const ROOT = join(process.cwd(), 'public', 'ridge');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const index = parseIndex(readJson(join(ROOT, 'index.json')));
const dirs = Object.entries(index.places);

describe('the committed ridge assets', () => {
  it('ship at least one place, and the index default is one of them', () => {
    expect(dirs.length).toBeGreaterThan(0);
    expect(index.places[index.default]).toBeDefined();
  });

  dirs.forEach(([id, dir]) => {
    describe(`${id} (${dir})`, () => {
      const raw = readJson(join(ROOT, dir, 'manifest.json')) as WireManifest;

      it('parses, and its directory ends in its bake id', () => {
        expect(() => parseManifest(raw, `${dir}/`)).not.toThrow();
        expect(dir.endsWith(`-${raw.bake_id}`)).toBe(true);
      });

      it('has every plane file, at the length the manifest states', () => {
        raw.frames.flatMap(planes).forEach((p) => {
          expect(statSync(join(ROOT, dir, p.file)).size, p.file).toBe(p.bytes);
        });
      });

      it('decodes every plane as the WebP of the size the manifest states', () => {
        raw.frames.flatMap(planes).forEach((p) => {
          expect(
            webpFault(readFileSync(join(ROOT, dir, p.file)), p.w, p.h),
            p.file
          ).toBeUndefined();
        });
      });

      it('holds the bytes its bake id was made from', () => {
        const bytes = (frame: string, plane: string) =>
          readFileSync(
            join(
              ROOT,
              dir,
              (raw.frames.find((f) => f.key === frame) as WireFrame).planes[plane].file
            )
          );
        expect(bakeIdOf(bytes)).toBe(raw.bake_id);
      });

      it('keeps every adjacent pair of frames inside the fetch and decode budget', () => {
        expect(sizeGate(raw)).toBeUndefined();
      });

      it('records a finite luma for every frame', () => {
        expect(raw.frames).toHaveLength(FRAME_KEYS.length);
        raw.frames.forEach((f) => {
          expect(Number.isFinite(f.luma.min) && Number.isFinite(f.luma.max), f.key).toBe(true);
          expect(f.luma.min, f.key).toBeLessThanOrEqual(f.luma.max);
        });
      });
    });
  });

  it('holds no file a manifest does not name', () => {
    const named = new Set<string>(['index.json']);
    dirs.forEach(([, dir]) => {
      named.add(`${dir}/manifest.json`);
      (readJson(join(ROOT, dir, 'manifest.json')) as WireManifest).frames
        .flatMap(planes)
        .forEach((p) => named.add(`${dir}/${p.file}`));
    });
    const onDisk = readdirSync(ROOT, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(ROOT.length + 1));
    expect(onDisk.filter((f) => !named.has(f))).toEqual([]);
    expect([...named].filter((f) => !existsSync(join(ROOT, f)))).toEqual([]);
  });
});

describe('the plane gates refuse a plane that is not what the manifest says', () => {
  const real = readFileSync(join(ROOT, Object.values(index.places)[0], 'noon-mid.webp'));
  const manifest = readJson(
    join(ROOT, Object.values(index.places)[0], 'manifest.json')
  ) as WireManifest;
  const { w, h } = manifest.frames[2].planes.mid;
  const id = (b: Uint8Array) => bakeIdOf(() => b);

  it('accepts the real plane at its size', () => {
    expect(webpFault(real, w, h)).toBeUndefined();
  });
  it("refuses a manifest that lies about the plane's size, and a file cut short or padded", () => {
    expect(webpFault(real, w, h + 1)).toMatch(/states/);
    expect(webpFault(real.subarray(0, real.length - 1), w, h)).toBeDefined();
    expect(webpFault(Buffer.concat([real, Buffer.from([0])]), w, h)).toBeDefined();
  });
  it('refuses a frame header whose dimensions are changed, and bytes that are not a WebP', () => {
    const vp8 = Buffer.from(real);
    const at = vp8.indexOf('VP8 ') + 8 + 6;
    vp8[at] ^= 0x01;
    expect(webpFault(vp8, w, h)).toMatch(/states/);
    expect(webpFault(Buffer.from('not a webp, but long enough to try'), w, h)).toMatch(/RIFF/);
  });
  it('re-derives a different bake id from a plane with the same length and 8 bytes overwritten', () => {
    const bad = Buffer.from(real);
    bad.fill(0xab, 100, 108);
    expect(bad.length).toBe(real.length);
    expect(id(bad)).not.toBe(id(real));
  });
});

describe('sizeGate', () => {
  const plane = (bytes: number): WirePlane => ({ file: 'x.webp', bytes, w: 1280, h: 600 });
  const frame = (key: string, bytes: number): WireFrame => ({
    key,
    planes: { far: plane(bytes), mid: plane(bytes), near: plane(bytes) },
    luma: { min: 0, max: 1 },
  });
  const set = (bytes: number): WireManifest => ({
    bake_id: 'x',
    frames: FRAME_KEYS.map((k) => frame(k, bytes)),
  });

  it('passes a pair at the budget and fails a 900 KB pair', () => {
    expect(sizeGate(set(133_333))).toBeUndefined();
    expect(sizeGate(set(150_000))).toMatch(/fetches 900000/);
  });

  it('fails a pair that decodes past the budget', () => {
    const m = set(1);
    m.frames[2].planes.far = { file: 'x.webp', bytes: 1, w: 4096, h: 1000 };
    expect(sizeGate(m)).toMatch(/decodes/);
  });
});
