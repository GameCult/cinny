import type { Scene, SceneOptions } from '../Scene';
import { FrameSampler, FrameStats } from './probe';
import { skyColours, SkyColours, Srgb } from './skyColour';
import {
  LAYERS,
  LayerSpec,
  edgeBlur,
  hazeColour,
  layerColour,
  layerColourAtRow,
  layerSize,
  ridgeY,
  scatterAlpha,
} from './ridgeWorld';

export type RidgeOptions = Pick<SceneOptions, 'canvas' | 'tier'> & {
  /** Show the rAF median/p95 readout. Default: the page URL has `?probe=1`. */
  probe?: boolean;
  /** Each time the readout would update, and once with `still` when the fallback fires. */
  onProbe?: (s: FrameStats & { still: boolean }) => void;
  /** The sky's colours; default `skyColours()`, the one function to replace with Void's sun.js. */
  sky?: SkyColours;
  /** Comparison for the mesh tier: haze each layer by screen row (higher = farther) instead of one colour per layer. Default false. */
  rowHaze?: boolean;
};

const css = (c: Srgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const mix = (a: Srgb, b: Srgb, t: number): Srgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return c.getContext('2d');
}

function paintSky(canvas: HTMLCanvasElement, sky: SkyColours): boolean {
  const ctx = context2d(canvas);
  if (!ctx) return false;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, css(sky.top));
  g.addColorStop(0.5, css(sky.mid));
  g.addColorStop(0.78, css(sky.horizon));
  g.addColorStop(1, css(sky.horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return true;
}

const SCATTER_STOPS = 16;

/** Warm in-scatter over the silhouette only (source-atop), as a horizontal gradient that repeats each period. */
function scatter(
  ctx: CanvasRenderingContext2D,
  spec: LayerSpec,
  sky: SkyColours,
  size: { period: number; width: number; height: number }
) {
  if (sky.sunAzimuth === undefined || scatterAlpha(spec, sky, sky.sunAzimuth) <= 0) return;
  const g = ctx.createLinearGradient(0, 0, size.width, 0);
  const [r, gr, b] = sky.horizon;
  for (let k = 0; k <= 2 * SCATTER_STOPS; k += 1) {
    const t = (k % SCATTER_STOPS) / SCATTER_STOPS;
    g.addColorStop(k / (2 * SCATTER_STOPS), `rgba(${r},${gr},${b},${scatterAlpha(spec, sky, t)})`);
  }
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Soften the silhouette's edge by `px` once, where the browser's 2D canvas supports `filter` (not
 * Safari, which keeps the sharp edge). One period is tiled past both ends and the bottom row extended below,
 * then blurred in a single draw, so the blur sees the wrap and the ground instead of fading at borders.
 */
function soften(src: HTMLCanvasElement, px: number, period: number): HTMLCanvasElement {
  const probe = context2d(src);
  if (!probe || px <= 0 || !('filter' in probe)) return src;
  const pad = Math.ceil(3 * px);
  // The unfiltered tiling: blurring tile by tile would fade each tile's own border.
  const tiled = document.createElement('canvas');
  tiled.width = src.width + 2 * period;
  tiled.height = src.height + pad;
  const tctx = context2d(tiled);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = context2d(out);
  if (!tctx || !ctx) return src;
  for (let k = 0; k < 4; k += 1) {
    tctx.drawImage(src, 0, 0, period, src.height, k * period, 0, period, src.height);
    tctx.drawImage(src, 0, src.height - 1, period, 1, k * period, src.height, period, pad);
  }
  ctx.filter = `blur(${px}px)`;
  ctx.drawImage(tiled, -period, 0);
  ctx.filter = 'none';
  return out;
}

/** One ridge layer, painted once: a filled silhouette two periods wide on a plain 2D canvas. */
function paintLayer(
  spec: LayerSpec,
  sky: SkyColours,
  size: { period: number; width: number; height: number },
  viewH: number,
  scale: number,
  rowHaze: boolean
): HTMLCanvasElement | null {
  const el = document.createElement('canvas');
  el.width = size.width;
  el.height = size.height;
  const ctx = context2d(el);
  if (!ctx) return null;
  const top: number[] = [];
  for (let x = 0; x < size.period; x += 1)
    top.push(ridgeY(spec, x, size.period, size.height, viewH));
  const c = layerColour(spec, sky);
  const g = ctx.createLinearGradient(0, 0, 0, size.height);
  if (rowHaze) {
    // The band's top row is the ridge crest at its highest; its foot is the viewport's bottom edge.
    for (let k = 0; k <= 4; k += 1) g.addColorStop(k / 4, css(layerColourAtRow(spec, sky, k / 4)));
  } else {
    g.addColorStop(0, css(c));
    g.addColorStop(1, css(mix(c, hazeColour(sky), 0.5 * (1 - spec.depth))));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, size.height);
  for (let x = 0; x <= size.width; x += 1) ctx.lineTo(x, top[x % size.period]);
  ctx.lineTo(size.width, size.height);
  ctx.closePath();
  ctx.fill();
  scatter(ctx, spec, sky, size);
  return soften(el, edgeBlur(spec) * scale, size.period);
}

interface Built {
  layers: HTMLCanvasElement[];
  anims: Animation[];
}

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
  const probe = opts.probe ?? new URLSearchParams(window.location.search).get('probe') === '1';
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  let built: Built | undefined;
  let still = tier === 'still';
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
    built?.anims.forEach((a) => a.cancel());
    built?.layers.forEach((l) => l.remove());
    built = undefined;
  };

  /** Bake the sky, then the layers. Returns false when a 2D context is missing. */
  const build = (): boolean => {
    teardownLayers();
    const { w, h, scale } = viewSize();
    const size = layerSize(w, h, scale);
    canvas.width = size.period;
    canvas.height = Math.round(h * scale);
    if (!paintSky(canvas, sky)) return false;
    const layers: HTMLCanvasElement[] = [];
    for (const spec of LAYERS) {
      const el = paintLayer(spec, sky, size, canvas.height, scale, opts.rowHaze ?? false);
      if (!el) {
        layers.forEach((l) => l.remove());
        return false;
      }
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        bottom: '0',
        width: `${size.width / scale}px`,
        height: `${size.height / scale}px`,
        pointerEvents: 'none',
        willChange: 'transform',
      });
      layers.push(el);
    }
    // DOM order is paint order: farthest first, so the nearest ridge ends up on top.
    layers.forEach((l) => parent.appendChild(l));
    const anims = layers
      .map((el, i) =>
        el.animate?.(
          [
            { transform: 'translate3d(0,0,0)' },
            { transform: `translate3d(${-size.period / scale}px,0,0)` },
          ],
          { duration: LAYERS[i].seconds * 1000, iterations: Infinity, easing: 'linear' }
        )
      )
      .filter((a): a is Animation => !!a);
    built = { layers, anims };
    syncPlayState();
    return true;
  };

  const moving = () =>
    !still &&
    !disposed &&
    !(reducedMotion?.matches ?? false) &&
    document.visibilityState === 'visible';

  function syncPlayState() {
    built?.anims.forEach((a) => (moving() ? a.play() : a.pause()));
  }

  /** Flatten the sky and layers into the host canvas and drop the layers: a still image, no compositor layers left. */
  const settleToStill = () => {
    if (still && !built) return;
    still = true;
    const ctx = context2d(canvas);
    if (ctx && built) {
      const { anims } = built;
      built.layers.forEach((l, i) => {
        // Freeze where the drift is, so the swap to a still does not jump.
        const a = anims[i];
        const t = Number(a?.currentTime ?? 0);
        const turns = (t % (LAYERS[i].seconds * 1000)) / (LAYERS[i].seconds * 1000);
        ctx.drawImage(l, -Math.round(turns * canvas.width), canvas.height - l.height);
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

  if (!build()) return null;
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
