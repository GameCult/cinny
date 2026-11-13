/* eslint-disable no-param-reassign -- the bake writes into the canvases and layer records it is handed */
import type { Scene, SceneOptions } from '../Scene';
import { overlayRequested } from '../debugOverlays';
import { FrameSampler, FrameStats } from './probe';
import { skyColours, SkyColours, Srgb } from './skyColour';
import { paintSky as paintPhysicalSky } from './physicalSky';
import { activeAt, drawStars, drawTwinkle as paintTwinkle, makeStars, Star } from './stars';
import { bakeSlice, BakeParams, layerPaint } from './ridgeBake';
import {
  LAYERS,
  LayerSpec,
  edgeBlur,
  HORIZON_TRACK_SHIFT,
  layerSize,
  scatterAlpha,
  transmittance,
} from './ridgeWorld';
import { hfovDeg } from './horizon';
import { viewFor, VFOV_DEG } from './skyDome';
import { drawRainTile, RAIN_TILES } from './rain';

/** One chunk's bake: `ms` is the summed task time, `maxTaskMs` the longest single task; `first` marks the bake of the first view. */
export interface BakeRecord {
  layer: number;
  chunk: number;
  ms: number;
  maxTaskMs: number;
  first: boolean;
}

export type RidgeOptions = Pick<SceneOptions, 'canvas' | 'tier'> & {
  /** Show the rAF median/p95 readout. Default: the page URL has `?probe=1`, where `debug` allows it. */
  probe?: boolean;
  /** The diagnostic overlays may be asked for by URL (debugOverlays.ts). Default: no. */
  debug?: boolean;
  /** Each time the readout would update, and once with `still` when the fallback fires. */
  onProbe?: (s: FrameStats & { still: boolean }) => void;
  /** The sky's colours; default `skyColours()`, the one function to replace with Void's sun.js. */
  sky?: SkyColours;
  /** Called after each chunk is baked (a chunk is one layer's stretch of world-x): the cost record. */
  onBake?: (b: BakeRecord) => void;
};

const css = (c: Srgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;
function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return c.getContext('2d');
}

/** The sun: a bright core of its true angular size (at least 2.5 px) and a short soft falloff, in the colour the air leaves it. */
function drawSun(
  ctx: CanvasRenderingContext2D,
  d: NonNullable<ReturnType<typeof paintPhysicalSky>['sunDisc']>,
  w: number,
  h: number
): void {
  const r = Math.max(2.5, d.radius * h);
  const x = d.x * w;
  const y = d.y * h;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
  const [cr, cg, cb] = d.rgb;
  g.addColorStop(0, `rgba(${cr},${cg},${cb},${d.alpha})`);
  g.addColorStop(1 / 3.5, `rgba(${cr},${cg},${cb},${d.alpha})`);
  g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 3.5, y - r * 3.5, r * 7, r * 7);
}

/**
 * The host canvas's sky: the physical sky (`physicalSky.ts`) as a small grid of display pixels, scaled up smoothly (it is a soft
 * field); without one, the three-stop gradient.
 */
function paintSky(
  canvas: HTMLCanvasElement,
  sky: SkyColours,
  cssW: number,
  cssH: number,
  makeCanvas: () => HTMLCanvasElement
): boolean {
  const ctx = context2d(canvas);
  if (!ctx) return false;
  if (sky.physical) {
    const px = paintPhysicalSky(sky.physical, cssW, cssH);
    const small = makeCanvas();
    small.width = px.w;
    small.height = px.h;
    const sctx = context2d(small);
    if (sctx) {
      const img = sctx.createImageData(px.w, px.h);
      img.data.set(px.data);
      sctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
      if (px.sunDisc) drawSun(ctx, px.sunDisc, canvas.width, canvas.height);
      return true;
    }
  }
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, css(sky.top));
  g.addColorStop(0.5, css(sky.mid));
  g.addColorStop(0.78, css(sky.horizon));
  g.addColorStop(1, css(sky.horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return true;
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

type Size = ReturnType<typeof layerSize>;

const SCATTER_STOPS = 16;

/** Warm in-scatter over the silhouette only (source-atop): a horizontal gradient over the chunk's world-x. */
function scatter(
  ctx: CanvasRenderingContext2D,
  spec: LayerSpec,
  sky: SkyColours,
  widthPx: number,
  heightPx: number,
  t0: number,
  tPerPx: number,
  bandX = 0,
  bandW = widthPx
) {
  if (sky.sunAzimuth === undefined || transmittance(spec) >= 1) return; // the nearest layer takes none
  const g = ctx.createLinearGradient(0, 0, widthPx, 0);
  const [r, gr, b] = sky.horizon;
  for (let k = 0; k <= SCATTER_STOPS; k += 1) {
    const a = scatterAlpha(spec, sky, t0 + (tPerPx * widthPx * k) / SCATTER_STOPS);
    g.addColorStop(k / SCATTER_STOPS, `rgba(${r},${gr},${b},${a})`);
  }
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(bandX, 0, bandW, heightPx);
  ctx.globalCompositeOperation = 'source-over';
}

/** A chunk's bake in slices: `step(budgetMs)` returns true once the chunk is on its canvas. */
interface Job {
  step(budgetMs: number): boolean;
}

/**
 * One layer's stretch of world-x `[m * chunk, (m + 1) * chunk)` painted onto `el`, in three phases of
 * column bands, each band sized to the task budget by measuring the last one: bake the pixels
 * (`bakeSlice`), put them on a canvas with the in-scatter, and (where the 2D `filter` exists) blur them
 * into `el`. The blur needs neighbours, so the pixels are baked `pad` columns past both ends and
 * the bottom into a scratch canvas this job owns, and each blurred band reads `pad` columns either side of
 * itself: seams show no fade. The scratch is made when the job first runs and dropped when it ends.
 */
function chunkJob(
  el: HTMLCanvasElement,
  makeCanvas: () => HTMLCanvasElement,
  spec: LayerSpec,
  sky: SkyColours,
  size: Size,
  viewH: number,
  scale: number,
  m: number,
  record: (ms: number, maxTaskMs: number) => void
): Job | null {
  const ctx = context2d(el);
  if (!ctx) return null;
  const blur = edgeBlur(spec) * scale;
  const pad = blur > 0 && 'filter' in ctx ? Math.ceil(3 * blur) : 0;
  const cols = size.chunk + 2 * pad;
  const rows = size.height + pad;
  const params: BakeParams = {
    spec,
    sky,
    horizonView:
      spec.horizon && sky.physical
        ? {
            azimuthDeg: viewFor(sky.physical.sun, size.period / viewH).azimuthDeg,
            hfovDeg: hfovDeg(size.period / viewH, VFOV_DEG),
          }
        : undefined,
    period: size.period,
    scale,
    viewH,
    rows,
    bandH: size.height,
    px0: m * size.chunk - pad,
    cols,
  };
  const paint = layerPaint(spec, sky);
  const t0World = params.px0 / size.period;
  let scratch: HTMLCanvasElement | undefined;
  let sctx: CanvasRenderingContext2D | null = ctx;
  let img: ImageData | undefined;
  /** 0 bake, 1 put and in-scatter, 2 blur into el; a chunk with no blur ends after 1. */
  let phase = 0;
  let pos = 0;
  let sliceCols = 32;
  let total = 0;
  let longest = 0;
  const last = pad > 0 ? 2 : 1;
  const start = (): boolean => {
    if (pad > 0) {
      scratch = makeCanvas();
      scratch.width = cols;
      scratch.height = rows;
      sctx = context2d(scratch);
    } else {
      el.width = size.chunk;
      el.height = size.height;
    }
    if (!sctx) return false;
    img = sctx.createImageData(cols, rows);
    return true;
  };
  const work = (x: number, n: number) => {
    if (!img || !sctx) return;
    if (phase === 0) bakeSlice(img.data, params, paint, x, x + n);
    else if (phase === 1) {
      sctx.putImageData(img, 0, 0, x, 0, n, rows);
      scatter(sctx, spec, sky, cols, rows, t0World, 1 / size.period, x, n);
    } else {
      // One draw: a blurred draw cut into bands costs more in the margins than it saves in task length.
      ctx.drawImage(scratch as HTMLCanvasElement, -pad, 0);
    }
  };
  return {
    step(budgetMs) {
      const t0 = clock();
      // Allocating the canvases and the pixel buffer is a task of its own.
      if (!img) {
        if (!start()) return true;
        if (Number.isFinite(budgetMs)) {
          total += clock() - t0;
          longest = Math.max(longest, clock() - t0);
          return false;
        }
      }
      while (phase <= last && clock() - t0 < budgetMs) {
        const end = phase === 2 ? size.chunk : cols;
        if (pos === 0 && phase === 2) {
          el.width = size.chunk;
          el.height = size.height;
          ctx.filter = `blur(${blur}px)`;
        }
        const n = phase === 2 ? end : Math.min(end - pos, sliceCols);
        const s0 = clock();
        work(pos, n);
        pos += n;
        const dt = Math.max(clock() - s0, 0.02);
        sliceCols = Number.isFinite(budgetMs)
          ? Math.max(8, Math.min(512, Math.round((n * budgetMs * 0.4) / dt)))
          : cols;
        if (pos >= end) {
          if (phase === 2) ctx.filter = 'none';
          phase += 1;
          pos = 0;
          if (phase === 1 || phase === 2) sliceCols = Number.isFinite(budgetMs) ? 64 : cols;
        }
      }
      const dt = clock() - t0;
      total += dt;
      longest = Math.max(longest, dt);
      const done = phase > last;
      if (done) {
        img = undefined;
        if (scratch) {
          scratch.width = 0;
          scratch.height = 0;
        }
        scratch = undefined;
        record(total, longest);
      }
      return done;
    },
  };
}

interface Chunk {
  el: HTMLCanvasElement;
  /** World chunk index it holds or is being baked to hold. */
  id: number;
  job?: Job;
  ready: boolean;
}

/** One layer: a track that drifts by one chunk per animation, holding three chunk canvases. */
interface LayerState {
  spec: LayerSpec;
  track: HTMLElement;
  /** Slot 0 and 1 are what the window can see; slot 2 is the one ahead, baked in the background. */
  slots: Chunk[];
  anim?: Animation;
}

interface Built {
  rig: HTMLElement;
  layers: LayerState[];
  sway?: Animation;
  size: Size;
  /** CSS px to canvas px, and the viewport's height in canvas px, as baked. */
  scale: number;
  viewH: number;
  /** Makes a canvas, bound to the document the scene was built in. */
  makeCanvas: () => HTMLCanvasElement;
  /** The twinkling stars' own canvas, between the sky and the ridges; absent in a day sky and in 'still'. */
  twinkle?: HTMLCanvasElement;
  /** The rain's tiles and their falling, present only when the weather rains (`rain.ts`). */
  rain?: { els: HTMLElement[]; anims: (Animation | undefined)[] };
}

/** Yaw and pitch: the camera's slow sway, a loop of this many seconds over the whole rig. */
const SWAY_SECONDS = 150;
const SLICE_BUDGET_MS = 6;

/** The twinkle overlay redraws at most this often: the swings are 2 to 7 s, no need for 60 fps. */
const TWINKLE_FRAME_MS = 50;

/**
 * The ridge scene: same contract as `createScene` ({ login, dispose }, null for "keep the CSS
 * ground"), no WebGL. The layers are painted once on the CPU; per frame the only work is the
 * browser compositor sliding each layer with a CSS transform (a Web Animation, no script). The host
 * canvas holds the baked sky; it and the layers' parent must be positioned, and the canvas should fill it.
 */
export function createRidgeScene(opts: RidgeOptions): Scene | null {
  const tier = opts.tier ?? 'full';
  if (tier === 'off') return null;
  const canvas = opts.canvas;
  const parent = canvas.parentElement;
  if (!parent) return null;
  const sky = opts.sky ?? skyColours();
  const probe = opts.probe ?? overlayRequested('probe', opts.debug === true);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  let built: Built | undefined;
  let field: Star[] = [];
  let twRaf = 0;
  let twLast = 0;
  let still = tier === 'still';
  let jobTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Chunk[] = [];
  let generation = 0;
  let disposed = false;
  let raf = 0;
  let readout: HTMLElement | undefined;
  let resizeTimer = 0;
  const sampler = new FrameSampler();

  const viewSize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    return { w, h, scale: (window.devicePixelRatio || 1) >= 2 ? 2 : 1 };
  };

  const teardownLayers = () => {
    generation += 1;
    clearTimeout(jobTimer);
    jobTimer = undefined;
    queue = [];
    built?.sway?.cancel();
    built?.layers.forEach((l) => l.anim?.cancel());
    built?.rig.remove();
    built?.twinkle?.remove();
    built?.rain?.anims.forEach((a) => a?.cancel());
    built?.rain?.els.forEach((e) => e.remove());
    cancelAnimationFrame(twRaf);
    twRaf = 0;
    built = undefined;
  };

  /** True while there is nothing to paint on: the canvas has no client size and the window itself is 0 x 0 (`viewSize` falls back to the window). */
  const hasNoArea = () => {
    const { w, h, scale } = viewSize();
    const size = layerSize(w, h, scale);
    return size.period < 1 || size.height < 1 || Math.round(h * scale) < 1;
  };

  /**
   * Start baking chunk `c` of layer `l`. `first` runs it to the end in this task (the first view);
   * otherwise it joins the queue, which `pump` works through in short tasks. False when the canvas has no 2D context.
   */
  const bake = (l: LayerState, c: Chunk, first: boolean): boolean => {
    if (!built) return false;
    const { scale, viewH, makeCanvas } = built;
    const job = chunkJob(
      c.el,
      makeCanvas,
      l.spec,
      sky,
      built.size,
      viewH,
      scale,
      c.id,
      (ms, maxTaskMs) => {
        c.ready = true;
        c.job = undefined;
        opts.onBake?.({ layer: l.spec.index, chunk: c.id, ms, maxTaskMs, first });
      }
    );
    if (!job) return false;
    c.ready = false;
    c.job = job;
    if (first) job.step(Infinity);
    else queue.push(c);
    return true;
  };

  const pump = () => {
    if (jobTimer !== undefined || !queue.length) return;
    const gen = generation;
    jobTimer = setTimeout(() => {
      jobTimer = undefined;
      if (gen !== generation) return;
      const c = queue[0];
      if (!c.job || c.job.step(SLICE_BUDGET_MS)) queue.shift();
      pump();
    }, 0);
  };

  /** Bake a still-queued chunk to the end now: only when the drift has caught up with the background work. */
  const flush = (c: Chunk) => {
    while (c.job && !c.job.step(Infinity));
    queue = queue.filter((q) => q !== c);
  };

  const chunkSeconds = (spec: LayerSpec, size: Size) => (spec.seconds * size.chunk) / size.period;

  /** One chunk of drift as one animation, holding its end until `rotate` hands the track the next chunk. */
  const startDrift = (l: LayerState, onEnd: (l: LayerState) => void) => {
    if (!built || !Number.isFinite(l.spec.seconds)) return; // the horizon layer does not drift
    const { size, scale } = built;
    l.anim = l.track.animate?.(
      [
        { transform: 'translate3d(0,0,0)' },
        { transform: `translate3d(${-size.chunk / scale}px,0,0)` },
      ],
      { duration: chunkSeconds(l.spec, size) * 1000, easing: 'linear', fill: 'forwards' }
    );
    if (l.anim) l.anim.onfinish = () => onEnd(l);
  };

  /**
   * The window has drifted one chunk. Slot 1 is now slot 0 and slot 2 slot 1, at the same screen place
   * (the track restarts at 0 and the chunks move one slot left in the same task, so nothing jumps); the
   * canvas that left becomes slot 2 and is baked with the world one chunk further on, off the critical path.
   */
  const rotate = (l: LayerState) => {
    if (!built || !built.layers.includes(l)) return;
    const [s0, s1, s2] = l.slots;
    flush(s1);
    flush(s2);
    l.slots = [s1, s2, s0];
    s0.id = s2.id + 1;
    const { size, scale } = built;
    l.slots.forEach((c, i) => {
      c.el.style.left = `${(i * size.chunk) / scale}px`;
    });
    l.anim?.cancel();
    startDrift(l, rotate);
    bake(l, s0, false);
    pump();
    syncPlayState();
  };

  /** The camera's slow yaw and pitch: the rig eases sideways (up to 5% of the width) and down (up to 3% of the height) and back, in a loop. */
  const startSway = (rig: HTMLElement, w: number, h: number) => {
    const x = 0.05 * w;
    const y = 0.03 * h;
    const at = (fx: number, fy: number) => `translate3d(${-x * fx}px,${y * fy}px,0)`;
    return rig.animate?.(
      [
        { transform: at(0, 0), offset: 0 },
        { transform: at(0.55, 1), offset: 0.35 },
        { transform: at(1, 0.3), offset: 0.7 },
        { transform: at(0, 0), offset: 1 },
      ],
      { duration: SWAY_SECONDS * 1000, iterations: Infinity, easing: 'ease-in-out' }
    );
  };

  /**
   * The rain over everything: per tile, a div of the tile's texture (drawn once) taller than the viewport by one tile, slid down one
   * tile height per loop on the compositor. 'still' draws none (a settled still has no animation to carry it).
   */
  const startRain = (
    rain: number,
    colour: Srgb,
    w: number,
    h: number,
    scale: number
  ): NonNullable<Built['rain']> => {
    const els: HTMLElement[] = [];
    const anims: (Animation | undefined)[] = [];
    RAIN_TILES.forEach((t, k) => {
      const tile = document.createElement('canvas');
      tile.width = t.size;
      tile.height = t.size;
      const tctx = context2d(tile);
      if (!tctx) return;
      drawRainTile(tctx, t, rain, colour, scale, k * 41);
      const px = t.size / scale;
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        top: `${-px}px`,
        width: '100%',
        height: `${h + px}px`,
        backgroundImage: `url(${tile.toDataURL()})`,
        backgroundSize: `${px}px ${px}px`,
        pointerEvents: 'none',
        willChange: 'transform',
      });
      parent.appendChild(el);
      els.push(el);
      anims.push(
        el.animate?.(
          [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(0,${px}px,0)` }],
          {
            duration: t.seconds * 1000,
            iterations: Infinity,
            easing: 'linear',
          }
        )
      );
    });
    return { els, anims };
  };

  /** Bake the sky, then the layers. Returns false when a 2D context is missing or there is no area yet. */
  const build = (): boolean => {
    teardownLayers();
    // A zero-size canvas throws on drawImage; wait for the first resize that gives the host an area.
    if (hasNoArea()) return false;
    const { w, h, scale } = viewSize();
    const size = layerSize(w, h, scale);
    canvas.width = size.period;
    canvas.height = Math.round(h * scale);
    if (!paintSky(canvas, sky, w, h, () => document.createElement('canvas'))) return false;
    // Every star is baked into the sky; the twinkling ones get their own canvas, which a per-frame
    // pass clears and paints over. 'still' has no overlay.
    const stars = makeStars(sky, w, h);
    const skyCtx = context2d(canvas);
    if (skyCtx) drawStars(skyCtx, stars, canvas.width, canvas.height, scale);
    let twinkle: HTMLCanvasElement | undefined;
    if (stars.length && tier !== 'still') {
      twinkle = document.createElement('canvas');
      twinkle.width = canvas.width;
      twinkle.height = canvas.height;
      twinkle.setAttribute('aria-hidden', 'true');
      Object.assign(twinkle.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      });
      parent.appendChild(twinkle);
    }
    field = stars;
    // The rig carries the camera's sway; each layer's track carries its drift; chunks sit on the track.
    const rig = document.createElement('div');
    rig.setAttribute('aria-hidden', 'true');
    Object.assign(rig.style, {
      position: 'absolute',
      left: '0',
      bottom: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      willChange: 'transform',
    });
    const layers: LayerState[] = LAYERS.map((spec) => {
      const track = document.createElement('div');
      Object.assign(track.style, {
        position: 'absolute',
        left: spec.horizon ? `${(-HORIZON_TRACK_SHIFT * size.period) / scale}px` : '0',
        bottom: '0',
        width: `${size.period / scale}px`,
        height: `${size.height / scale}px`,
        willChange: 'transform',
      });
      const slots: Chunk[] = [0, 1, 2].map((i) => {
        const el = document.createElement('canvas');
        el.width = size.chunk;
        el.height = size.height;
        Object.assign(el.style, {
          position: 'absolute',
          bottom: '0',
          width: `${size.chunk / scale}px`,
          height: `${size.height / scale}px`,
        });
        return { el, id: i, ready: false };
      });
      return { spec, track, slots };
    });
    const doc = document;
    built = {
      rig,
      layers,
      size,
      scale,
      viewH: canvas.height,
      makeCanvas: () => doc.createElement('canvas'),
      twinkle,
    };
    // First view: only slot 0 of each layer, in this task. The window sees nothing else for the first
    // fifth of a chunk's drift; slots 1 and 2 are baked in short tasks behind it.
    if (!layers.every((l) => bake(l, l.slots[0], true))) {
      teardownLayers();
      return false;
    }
    layers.forEach((l) => {
      l.slots.forEach((c, i) => {
        c.el.setAttribute('aria-hidden', 'true');
        c.el.style.left = `${(i * size.chunk) / scale}px`;
        l.track.appendChild(c.el);
      });
      rig.appendChild(l.track);
      bake(l, l.slots[1], false);
      bake(l, l.slots[2], false);
    });
    // DOM order is paint order: farthest first, so the nearest ridge ends up on top.
    parent.appendChild(rig);
    layers.forEach((l) => startDrift(l, rotate));
    built.sway = startSway(rig, w, h);
    if (tier !== 'still' && sky.physical && sky.physical.weather.rain > 0)
      built.rain = startRain(sky.physical.weather.rain, sky.horizon, w, h, scale);
    pump();
    syncPlayState();
    return true;
  };

  const moving = () =>
    !still &&
    !disposed &&
    !(reducedMotion?.matches ?? false) &&
    document.visibilityState === 'visible';

  /** Paint the overlay at t seconds (stars away from base), or just clear it with no t (all at base). */
  const drawTwinkle = (t?: number) => {
    const el = built?.twinkle;
    const ctx = el && context2d(el);
    if (!el || !ctx) return;
    const active = t === undefined ? [] : activeAt(field.length, t);
    paintTwinkle(ctx, field, active, el.width, el.height, viewSize().scale);
  };

  // The same guard as the drift: not still, not disposed, not reduced motion, tab visible. Not moving
  // stops the loop and leaves the stars steady at base brightness.
  const twTick = (now: number) => {
    twRaf = 0;
    if (!moving() || !built?.twinkle) return;
    if (now - twLast >= TWINKLE_FRAME_MS) {
      twLast = now;
      drawTwinkle(now / 1000);
    }
    twRaf = requestAnimationFrame(twTick);
  };

  function syncPlayState() {
    const anims = built
      ? [built.sway, ...built.layers.map((l) => l.anim), ...(built.rain?.anims ?? [])]
      : [];
    anims.forEach((a) => (moving() ? a?.play() : a?.pause()));
    if (!built?.twinkle) return;
    if (moving()) {
      if (!twRaf) twRaf = requestAnimationFrame(twTick);
    } else {
      cancelAnimationFrame(twRaf);
      twRaf = 0;
      drawTwinkle();
    }
  }

  /** Flatten the sky and layers into the host canvas and drop the layers: a still image, no compositor layers left. */
  const settleToStill = () => {
    if (still && !built) return;
    still = true;
    const ctx = context2d(canvas);
    if (ctx && built) {
      const { size } = built;
      built.layers.forEach((l) => {
        // Freeze where the drift is, so the swap to a still does not jump; whatever is baked and in view.
        const dur = chunkSeconds(l.spec, size) * 1000;
        const p = Math.min(1, Math.max(0, Number(l.anim?.currentTime ?? 0) / dur));
        const x = -Math.round(p * size.chunk);
        l.slots.slice(0, 2).forEach((c, i) => {
          if (c.ready) ctx.drawImage(c.el, x + i * size.chunk, canvas.height - size.height);
        });
      });
    }
    teardownLayers();
    cancelAnimationFrame(raf);
    raf = 0;
    report(true);
  };

  const report = (stillNow: boolean) => {
    const s = { ...sampler.stats(), still: stillNow };
    opts.onProbe?.(s);
    if (readout) {
      readout.textContent = `ridge · n ${s.n} · median ${s.medianMs.toFixed(
        1
      )} ms · p95 ${s.p95Ms.toFixed(1)} ms${stillNow ? ' · STILL' : ''}`;
    }
  };

  let sinceReport = 0;
  const tick = (now: number) => {
    raf = 0;
    if (!moving()) return;
    const full = sampler.push(now);
    if (full && sampler.slow() && !still) {
      settleToStill();
      return;
    }
    // After the window the series keeps rolling only for the readout; otherwise the loop ends here.
    if (full && !probe) return;
    if (probe && now - sinceReport > 500) {
      sinceReport = now;
      report(false);
    }
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    syncPlayState();
    if (!moving() || raf) return;
    sampler.reset();
    raf = requestAnimationFrame(tick);
  };

  // No area yet is not a failure: the resize listener below builds once the host has one.
  if (!build() && !hasNoArea()) return null;
  if (probe) {
    readout = document.createElement('div');
    Object.assign(readout.style, {
      position: 'absolute',
      left: '8px',
      top: '8px',
      font: '12px monospace',
      color: '#fff',
      background: 'rgba(0,0,0,.55)',
      padding: '2px 6px',
      borderRadius: '3px',
      pointerEvents: 'none',
    });
    parent.appendChild(readout);
  }
  if (still) settleToStill();
  else wake();

  const onVisibility = () => {
    sampler.reset();
    wake();
  };
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      const wasStill = still;
      if (!build()) return;
      if (wasStill) settleToStill();
      else {
        sampler.reset();
        wake();
      }
    }, 250);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  reducedMotion?.addEventListener?.('change', syncPlayState);

  return {
    login() {
      // No camera to pull back; the ridges are the same before and after.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      reducedMotion?.removeEventListener?.('change', syncPlayState);
      teardownLayers();
      readout?.remove();
    },
  };
}
