// The committed baked set under public/ridge: what the baker wrote is what ships, within the budget the baker itself refuses on
// (export.py PAIR_BYTES_MAX, DECODE_BYTES_MAX). Reads with node fs; no decoder: plane sizes come from the manifest.
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
