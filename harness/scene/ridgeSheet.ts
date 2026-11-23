// Look sheet for the lit ridge cards: a baked place lit for a grid of sky states (or pinned moments) x looks, each cell a small canvas drawn by the app's own still path
// (`createRidgeScene` at tier 'still', the tiles of the arc round the heading, each card at `cardPose`). Not shipped.
// `?views=214:0:200,0:0:200,100:0:200,214:90:98.2`  one column per view `heading:phi:offset` (degrees, degrees, metres) at one sky (`?sky=2`, an index of SKIES, noon by default); a heading
//               of 360 or 0 is across north. The offset is clamped to the place's range as the app does (phi 0: the bake's forward bound, any other phi: the worst-case bound), and a phi other than 0 is the offset-only rotation mode, the camera circling the centre.
// `?place=vienna`  the baked place (index.json's default if absent)
// `?preset=all|physical|swiss|poster|painterly|painterly-cel-2|painterly-cel-3|painterly-cel-4` (default all: one row each; painterly is DEFAULT_LOOK); `?looks=<JSON array, url-encoded or base64>` replaces the rows with
// the given `{label, ...partial RidgeLook}` entries (inkKeep and reliefLight merge by key). `?w=480` sets the cell width, 16:9 unless `?h=` gives the height (`?w=375&h=812` is a phone).
// The sky behind a cell is the app's own: `makePhysicalSky` + `paintSky` upscaled smoothly, with the real stars and the moon (`nightBodies`),
// without the sun disc or clouds. Columns are the SKIES below (a sun elevation each, the stars and moon of the moment the sheet was opened), or:
//   `?moments=2026-11-24T22:00Z,2026-12-09T20:00Z`  explicit UTC moments: the sun, moon and stars are those of the moment, the state follows the sun's elevation
//   `?night=1`  the night set: the next new moon, first quarter and full moon from today (or from `?from=YYYY-MM-DD`), each at four night hours
//               (`?hours=18,21,0,4` UTC), plus deep dusk (sun at -10 degrees) of the evening of the full moon
//   `?labels=1` DEBUG: label each constellation chain in frame with its d3-celestial abbreviation (fetched from the source repository at run time; not shipped)
//   `?lines=1`  constellation lines over the stars, as the Sky menu's hidden toggle does (night cells only)
import { DEFAULT_LOOK, PHYSICAL_LOOK, createLighter } from '../../src/app/features/scene/ridge/lightCards';
import type { RidgeLook } from '../../src/app/features/scene/ridge/lightCards';
import { parseIndex, parseManifest } from '../../src/app/features/scene/ridge/manifest';
import { makePhysicalSky } from '../../src/app/features/scene/ridge/physicalSky';
import { HFOV_MAX_DEG, windowFor } from '../../src/app/features/scene/ridge/view';
import { onScreen } from '../../src/app/features/scene/ridge/nightBodies';
import { createBackdrop } from '../../src/app/features/scene/ridge/Backdrop';
import { createRidgeScene } from '../../src/app/features/scene/ridge/Ridge';
import { anchor, hold } from '../../src/app/features/scene/ridge/heading';
import { setCamera } from '../../src/app/features/scene/cameraState';
import { sunAt } from '../../src/app/features/scene/ridge/sunAt';
import { linesAt } from '../../src/app/features/scene/ridge/starCatalogue';
import { moonPhase } from '../../src/sky/moon.js';
import { MOMENT_IDS, momentFor } from '../../src/app/features/scene/ridge/skyMoment';


type Override = Partial<Omit<RidgeLook, 'inkKeep' | 'reliefLight'>> & {
  label: string;
  /** The look the unnamed keys come from (DEFAULT_LOOK, the painterly cel look, if absent). */
  base?: 'physical';
  inkKeep?: Partial<RidgeLook['inkKeep']>;
  reliefLight?: Partial<RidgeLook['reliefLight']>;
};

interface Column {
  label: string;
  elevation?: number;
  azimuth?: number;
  /** A moment: the sun is the real one of it. */
  time?: Date;
  /** Where the view faces and the camera stands: heading and phi in degrees, offset in metres. Absent: the rest azimuth, phi 0, the app's default offset. */
  view?: { h: number; phi: number; r: number };
}

/** Sun elevation and compass azimuth of each column; the cards look at 214 +- 36. The band of the elevation (`skyBand`) picks the display budget. */
const SKIES: Column[] = [
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

const HOUR = 3_600_000;
/** The first moment at or after `from` the moon's elongation passes `target` degrees (new 0, first quarter 90, full 180). */
function nextPhase(from: Date, target: number): Date {
  const err = (t: number) => ((moonPhase(t).elongationDeg - target + 540) % 360) - 180;
  let t = from.getTime();
  while (!(err(t) < 0 && err(t + HOUR) >= 0)) t += HOUR;
  let a = t;
  let b = t + HOUR;
  for (let i = 0; i < 20; i += 1) {
    const m = (a + b) / 2;
    if (err(m) < 0) a = m;
    else b = m;
  }
  return new Date(b);
}

/** The first evening moment (UTC hour steps of 10 minutes from `day`) the sun is at `deg` below the horizon, going down. */
function sunDownTo(place: Parameters<typeof sunAt>[0], day: Date, deg: number): Date {
  let t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12);
  while (sunAt(place, new Date(t)).elevation > -deg) t += 10 * 60_000;
  return new Date(t);
}

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';

function momentsFrom(params: URLSearchParams, place: Parameters<typeof sunAt>[0]): Column[] | undefined {
  const list = params.get('moments');
  if (list)
    return list.split(',').map((iso) => {
      const time = new Date(iso.trim());
      if (Number.isNaN(time.getTime())) throw new Error(`moments=: ${iso} is not a date`);
      return { label: fmt(time), time };
    });
  // `named=1`: the six named moments of the sky menu (`momentFor`, as the app draws them) on both solstices at the place: the look sheet the elevation table is tuned from.
  if (params.get('named'))
    return ['2026-12-21', '2026-06-21'].flatMap((day) =>
      MOMENT_IDS.map((id) => {
        const time = momentFor({ kind: 'named', id }, place, new Date(`${day}T12:00:00Z`));
        return { label: `${id} ${day.slice(5)} ${fmt(time)}`, time };
      })
    );
  if (!params.get('night')) return undefined;
  const from = params.get('from') ? new Date(`${params.get('from')}T00:00:00Z`) : new Date();
  const hours = (params.get('hours') ?? '18,21,0,4').split(',').map(Number);
  const cols: Column[] = [];
  const phases: [string, number][] = [['new', 0], ['first quarter', 90], ['full', 180]];
  phases.forEach(([name, deg]) => {
    const peak = nextPhase(from, deg);
    const day = Date.UTC(peak.getUTCFullYear(), peak.getUTCMonth(), peak.getUTCDate());
    hours.forEach((h) => {
      // Hours before 12 belong to the night that ends the day of the phase, so the hours run on from the evening.
      const time = new Date(day + (h < 12 ? 24 + h : h) * HOUR);
      cols.push({ label: `${name} ${fmt(time)}`, time });
    });
    if (deg === 180) cols.push({ label: `deep dusk, full moon ${fmt(sunDownTo(place, peak, 10))}`, time: sunDownTo(place, peak, 10) });
  });
  return cols;
}
/** `?views=h:phi:r,...`: one column per view, all at the sky `?sky=` (default noon). */
function viewsFrom(params: URLSearchParams): Column[] | undefined {
  const list = params.get('views');
  if (!list) return undefined;
  const sky = SKIES[Number(params.get('sky') ?? 2)];
  return list.split(',').map((v) => {
    const [h, phi, r] = v.split(':').map(Number);
    return { ...sky, label: `h ${h} phi ${phi} r ${r}`, view: { h, phi, r } };
  });
}
const preset = q.get('preset');
const pinned = q.get('moments') || q.get('night');
const rows = (q.get('looks')
  ? parseLooks(q.get('looks') as string)
  : preset && preset !== 'all'
  ? [PRESETS[preset] ?? PRESETS.physical]
  : pinned
  ? [PRESETS.painterly] // a night set is read in the default look unless a preset or looks say otherwise
  : Object.values(PRESETS)
).map(merge);
const withLines = q.get('lines') === '1';
const LINES_JSON = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json';
/** Debug: the constellation id of each packed chain, in the generator's order (feature by feature, chain by chain). */
async function chainIds(): Promise<string[]> {
  const gj = await (await fetch(LINES_JSON)).json();
  return gj.features.flatMap((f: { id: string; geometry: { coordinates: unknown[] } }) => f.geometry.coordinates.map(() => f.id));
}
const W = Number(q.get('w') ?? 480);
const H = q.get('h') ? Number(q.get('h')) : Math.round((W * 9) / 16);
const root = document.getElementById('sheet') as HTMLElement;

async function main() {
  const index = parseIndex(await (await fetch('/public/ridge/index.json')).json());
  const DIR = `/public/ridge/${index.places[q.get('place') ?? index.default] ?? index.places[index.default]}/`;
  const manifest = parseManifest(await (await fetch(`${DIR}manifest.json`)).json(), DIR);
  const { view } = manifest;
  const win = windowFor(view, W, H);
  const now = new Date();
  const columns = viewsFrom(q) ?? momentsFrom(q, view.place) ?? SKIES;
  const ids = q.get('labels') === '1' ? await chainIds() : undefined;

  const table = document.createElement('table');
  table.style.borderSpacing = '4px';
  root.append(table);
  const head = table.insertRow();
  head.insertCell();
  columns.forEach((c) => (head.insertCell().textContent = c.label));
  const tr = rows.map((r) => {
    const row = table.insertRow();
    row.insertCell().textContent = r.label;
    return row;
  });

  for (const col of columns) {
    const time = col.time ?? now;
    const sun =
      col.time !== undefined
        ? sunAt(view.place, col.time)
        : { elevation: col.elevation as number, azimuth: col.azimuth as number, time };
    const physical = makePhysicalSky(sun, 0, view);
    const sky = { ...physical.stops, physical };
    const v = col.view ?? { h: view.lookAzDeg, phi: 0, r: 200 };

    for (let r = 0; r < rows.length; r += 1) {
      // A host as the page has one: a positioned box of the cell's size holding the canvas the scene paints.
      const host = document.createElement('div');
      Object.assign(host.style, { position: 'relative', width: `${W}px`, height: `${H}px`, overflow: 'hidden' });
      const cell = document.createElement('canvas');
      Object.assign(cell.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
      host.append(cell);
      tr[r].insertCell().append(host);

      // The heading owner as the app leaves it: this view's heading, the camera on its circle at phi (offset-only rotation), the offset the viewer chose.
      const t0 = performance.now() - 3_600_000;
      anchor(`sheet-${manifest.bakeId}-${columns.indexOf(col)}-${r}`, v.h, t0); // a key of its own: every cell starts from phi 0
      setCamera({ mode: 'offset', speedDegPerS: 1, offsetM: v.r }, t0); // the offset-only rotation mode for phi seconds at 1 degree per second ...
      hold(v.h, t0 + v.phi * 1000); // ... then the view is held at h: the mode is still, the camera stays at phi (phi 0 is the camera on its heading)

      const backdrop = createBackdrop(manifest, physical, { lighter: (m, s) => createLighter(m, s, rows[r].look) });
      await backdrop.ensure({ fromDeg: v.h - HFOV_MAX_DEG, toDeg: v.h + HFOV_MAX_DEG });
      const scene = createRidgeScene({ canvas: cell, tier: 'still', sky, backdrop, lines: withLines });
      scene?.dispose();

      if (ids) {
        // Debug labels: each chain's id at the mean of its vertices that lie in the frame.
        const ctx = cell.getContext('2d') as CanvasRenderingContext2D;
        ctx.font = '11px monospace';
        ctx.fillStyle = '#ffd24a';
        linesAt(physical.sun.time, view.place.lat, view.place.lon).forEach((chain, i) => {
          const pts = chain.map((p) => onScreen(win.camera, p.azimuth, p.elevation)).filter((a) => a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1);
          if (!pts.length) return;
          const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
          const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
          ctx.fillText(`${ids[i]} ${pts.length}/${chain.length}`, mx * W, my * H);
        });
      }
    }
  }
  document.title = 'ridge look sheet: done';
}

main().catch((e) => {
  console.error(e);
  root.textContent = `ridge look sheet failed: ${e}`;
});
