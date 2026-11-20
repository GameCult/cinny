// Look sheet for the lit ridge cards: the Vienna bake lit for a grid of sky states x looks, each cell a small canvas at heading 0. Not shipped.
// `?preset=all|physical|swiss|poster|painterly|painterly-cel-2|painterly-cel-3|painterly-cel-4` (default all: one row each; painterly is DEFAULT_LOOK); `?looks=<JSON array, url-encoded or base64>` replaces the rows with
// the given `{label, ...partial RidgeLook}` entries (inkKeep and reliefLight merge by key). `?w=480` sets the cell width (16:9).
// The sky behind a cell is the app's own: `makePhysicalSky` + `paintSky` upscaled smoothly, without the sun disc, stars or clouds.
import { DEFAULT_LOOK, PHYSICAL_LOOK, lightCards } from '../../src/app/features/scene/ridge/lightCards';
import type { RidgeLook } from '../../src/app/features/scene/ridge/lightCards';
import { parseManifest } from '../../src/app/features/scene/ridge/manifest';
import { makePhysicalSky, paintSky } from '../../src/app/features/scene/ridge/physicalSky';
import { windowFor } from '../../src/app/features/scene/ridge/view';
import { DAY_FROM } from '../../src/app/features/scene/skyState';
import type { FixedSkyState } from '../../src/app/features/scene/skyState';

const DIR = '/public/ridge/vienna-6815bb9dca99/';

type Override = Partial<Omit<RidgeLook, 'inkKeep' | 'reliefLight'>> & {
  label: string;
  /** The look the unnamed keys come from (DEFAULT_LOOK, the painterly cel look, if absent). */
  base?: 'physical';
  inkKeep?: Partial<RidgeLook['inkKeep']>;
  reliefLight?: Partial<RidgeLook['reliefLight']>;
};

/** Sun elevation and compass azimuth of each column; the cards look at 214 +- 36. Elevation picks the display budget (day from DAY_FROM, night below its negative). */
const SKIES = [
  { label: 'dawn 2 deg', elevation: 2, azimuth: 100 },
  { label: 'morning 15 deg', elevation: 15, azimuth: 135 },
  { label: 'noon 55 deg', elevation: 55, azimuth: 190 },
  { label: 'golden 6 deg', elevation: 6, azimuth: 244 },
  { label: 'dusk -3 deg', elevation: -3, azimuth: 262 },
  { label: 'night -30 deg', elevation: -30, azimuth: 0 },
];

/** The art directions, chosen by reasoning, not by eye: Self tunes them (values listed in harness/scene/README.md). */
const PRESETS: Record<string, Override> = {
  physical: { label: 'physical', base: 'physical' },
  swiss: {
    label: 'swiss',
    base: 'physical',
    reliefLight: { mix: 0.7, azimuthDeg: -45, elevationDeg: 40 },
    contrastByDistance: 0.9,
    hazeScale: 6,
    hazeTint: [0, 0.05, 0.25],
    nearWarm: 0.5,
    inkScale: 0.6,
  },
  poster: {
    label: 'poster',
    base: 'physical',
    reliefWeight: 0.15,
    cardToneStep: 0.25,
    cardGradient: 0.5,
    inkKeep: { edge: 0.25, occlude: 0.9, crease: 1 },
    hazeScale: 4,
  },
  painterly: { label: 'painterly (default, cel 3)' },
  'painterly-cel-2': { label: 'painterly-cel-2', celBands: 2 },
  'painterly-cel-3': { label: 'painterly-cel-3', celBands: 3 },
  'painterly-cel-4': { label: 'painterly-cel-4', celBands: 4 },
};

const merge = (o: Override): { label: string; look: RidgeLook } => {
  const { label, base: baseName, inkKeep, reliefLight, ...rest } = o;
  const base = baseName === 'physical' ? PHYSICAL_LOOK : DEFAULT_LOOK;
  return {
    label,
    look: {
      ...base,
      ...rest,
      inkKeep: { ...base.inkKeep, ...inkKeep },
      reliefLight: { ...base.reliefLight, ...reliefLight },
    },
  };
};

function parseLooks(raw: string): Override[] {
  const tries = [() => decodeURIComponent(raw), () => atob(raw.replace(/-/g, '+').replace(/_/g, '/'))];
  for (const t of tries) {
    try {
      const v = JSON.parse(t());
      if (Array.isArray(v)) return v.map((e, i) => ({ label: `look ${i + 1}`, ...e }));
    } catch {
      // try the next encoding
    }
  }
  throw new Error('looks= is neither a url-encoded nor a base64 JSON array');
}

const q = new URLSearchParams(location.search);
const preset = q.get('preset');
const rows = (q.get('looks')
  ? parseLooks(q.get('looks') as string)
  : preset && preset !== 'all'
  ? [PRESETS[preset] ?? PRESETS.physical]
  : Object.values(PRESETS)
).map(merge);
const W = Number(q.get('w') ?? 480);
const H = Math.round((W * 9) / 16);
const root = document.getElementById('sheet') as HTMLElement;

const stateOf = (el: number): FixedSkyState =>
  el >= DAY_FROM ? 'day' : el <= -DAY_FROM ? 'night' : 'dusk';

async function main() {
  const manifest = parseManifest(await (await fetch(`${DIR}manifest.json`)).json(), DIR);
  const blobs = await Promise.all(
    manifest.cards.map(async (c) => ({
      colour: await (await fetch(`${DIR}${c.colour}`)).blob(),
      geometry: await (await fetch(`${DIR}${c.geometry}`)).blob(),
    }))
  );
  const decode = (b: Blob) =>
    createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const { view } = manifest;
  const win = windowFor(view, W, H);
  const now = new Date();

  const table = document.createElement('table');
  table.style.borderSpacing = '4px';
  root.append(table);
  const head = table.insertRow();
  head.insertCell();
  SKIES.forEach((s) => (head.insertCell().textContent = s.label));
  const tr = rows.map((r) => {
    const row = table.insertRow();
    row.insertCell().textContent = r.label;
    return row;
  });

  for (const sky of SKIES) {
    const physical = makePhysicalSky(stateOf(sky.elevation), now, 0, view, {
      elevation: sky.elevation,
      azimuth: sky.azimuth,
      time: now,
    });
    const px = paintSky(physical, W, H, win.camera);
    const small = document.createElement('canvas');
    small.width = px.w;
    small.height = px.h;
    const sctx = small.getContext('2d') as CanvasRenderingContext2D;
    const img = sctx.createImageData(px.w, px.h);
    img.data.set(px.data);
    sctx.putImageData(img, 0, 0);

    for (let r = 0; r < rows.length; r += 1) {
      const bitmaps = await Promise.all(
        blobs.map(async (b) => ({
          colour: await decode(b.colour),
          geometry: await decode(b.geometry),
        }))
      );
      const cards = lightCards(manifest, bitmaps, physical, rows[r].look);
      const cell = document.createElement('canvas');
      cell.width = W;
      cell.height = H;
      const ctx = cell.getContext('2d') as CanvasRenderingContext2D;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
      // As Ridge.ts paintCards at heading 0: farthest first, each card at its own scale about the horizon row of the plane.
      const s = win.plane.scale;
      const x0 = (W - win.plane.w) / 2;
      const planeTop = H - win.plane.h;
      const ox = x0 + win.plane.w / 2;
      const oy = planeTop + view.horizonRow * s;
      for (let k = cards.length - 1; k >= 0; k -= 1) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(cards[k].scale, cards[k].scale);
        ctx.drawImage(
          cards[k].canvas,
          x0 - ox,
          planeTop + cards[k].top * s - oy,
          win.plane.w,
          cards[k].h * s
        );
        ctx.restore();
      }
      tr[r].insertCell().append(cell);
    }
  }
  document.title = 'ridge look sheet: done';
}

main().catch((e) => {
  console.error(e);
  root.textContent = `ridge look sheet failed: ${e}`;
});
