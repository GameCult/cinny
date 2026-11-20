import type { Scene, SceneOptions } from '../Scene';
import { overlayRequested } from '../debugOverlays';
import { FrameSampler, FrameStats } from './probe';
import { skyColours, SkyColours, Srgb } from './skyColour';
import { paintSky as paintPhysicalSky } from './physicalSky';
import { cardMotion, windowFor } from './view';
import { activeAt, drawTwinkle as paintTwinkle, Star } from './stars';
import { nightBodies, paintNightBodies } from './nightBodies';
import type { NightBodies } from './nightBodies';
import { drawRainTile, RAIN_TILES } from './rain';
import type { Backdrop } from './Backdrop';

export type RidgeOptions = Pick<SceneOptions, 'canvas' | 'tier'> & {
  /** Show the rAF median/p95 readout. Default: the page URL has `?probe=1`, where `debug` allows it. */
  probe?: boolean;
  /** The diagnostic overlays may be asked for by URL (debugOverlays.ts). Default: no. */
  debug?: boolean;
  /** Each time the readout would update, and once with `still` when the fallback fires. */
  onProbe?: (s: FrameStats & { still: boolean }) => void;
  /** The sky's colours; default `skyColours()`, the one function to replace with Void's sun.js. */
  sky?: SkyColours;
  /** The baked ridge cards, already lit for `sky` (`Backdrop.ts`); none is the sky-only scene (`view.ts` FALLBACK_VIEW). */
  backdrop?: Backdrop;
  /** Draw the constellation lines over the stars (a hidden extra, `skyState.ts`); only a night sky shows them. */
  lines?: boolean;
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
): { ok: boolean; px?: ReturnType<typeof paintPhysicalSky> } {
  const ctx = context2d(canvas);
  if (!ctx) return { ok: false };
  if (sky.physical) {
    const px = paintPhysicalSky(
      sky.physical,
      cssW,
      cssH,
      windowFor(sky.physical.view, cssW, cssH).camera
    );
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
      return { ok: true, px };
    }
  }
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, css(sky.top));
  g.addColorStop(0.5, css(sky.mid));
  g.addColorStop(0.78, css(sky.horizon));
  g.addColorStop(1, css(sky.horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { ok: true };
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Built {
  /** The twinkling stars' own canvas, over the sky; absent in a day sky and in 'still'. */
  twinkle?: HTMLCanvasElement;
  /** The ridge cards' rig, over the twinkle canvas and under the rain; absent in 'still' (the cards are drawn into the host canvas). */
  rig?: { el: HTMLElement; anims: (Animation | undefined)[] };
  /** The rain's tiles and their falling, present only when the weather rains (`rain.ts`). */
  rain?: { els: HTMLElement[]; anims: (Animation | undefined)[] };
}

/** The twinkle overlay redraws at most this often: the swings are 2 to 7 s, no need for 60 fps. */
const TWINKLE_FRAME_MS = 50;

/** One leg of the back-and-forth drift, a turn of the heading from one end of its range to the other, takes DRIFT_LEG_S, so the loop is 150 s. Authored, tunable by eye. */
const DRIFT_LEG_S = 75;

/**
 * The ridge scene: same contract as `createScene` ({ login, dispose }, null for "keep the CSS
 * ground"). It draws the sky, the stars, the lit ridge cards when given a `backdrop` (none: the sky alone) and the rain. The scene itself
 * requests no WebGL: the cards arrive lit (`lightCards.ts`, once per scene build) and only 2D contexts are asked of the host canvas. The host canvas holds the baked sky; it and
 * its parent must be positioned, and the canvas should fill the parent.
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

  const teardown = () => {
    built?.twinkle?.remove();
    built?.rig?.anims.forEach((a) => a?.cancel());
    built?.rig?.el.remove();
    built?.rain?.anims.forEach((a) => a?.cancel());
    built?.rain?.els.forEach((e) => e.remove());
    cancelAnimationFrame(twRaf);
    twRaf = 0;
    built = undefined;
  };

  /** True while there is nothing to paint on: the canvas has no client size and the window itself is 0 x 0 (`viewSize` falls back to the window). */
  const hasNoArea = () => {
    const { w, h, scale } = viewSize();
    return Math.round(w * scale) < 1 || Math.round(h * scale) < 1;
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

  /**
   * The ridge over the sky: one element per lit card, farthest first (DOM order is paint order, stacking is by order alone), placed at the card's rows
   * of the plane and scaled about the horizon's centre by the baker's `scale` (`view.ts` `cardMotion` owns every offset and scale). The camera
   * turns through its heading range and back on the compositor: card i pans `scale` x heading, so a nearer card leads the far range.
   */
  const startRig = (bd: Backdrop, w: number, h: number): NonNullable<Built['rig']> => {
    const { view } = bd.manifest;
    const win = windowFor(view, w, h);
    const motion = cardMotion(bd.manifest, win);
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      pointerEvents: 'none',
    });
    const anims: (Animation | undefined)[] = [];
    const planeTop = h - win.plane.bottom - win.plane.h;
    for (let k = bd.cards.length - 1; k >= 0; k -= 1) {
      const card = bd.cards[k];
      const { scale, reachPx } = motion.cards[k];
      const node = card.canvas;
      Object.assign(node.style, {
        position: 'absolute',
        left: `${(w - win.plane.w) / 2}px`,
        top: `${planeTop + card.top * win.plane.scale}px`,
        width: `${win.plane.w}px`,
        height: `${card.h * win.plane.scale}px`,
        transformOrigin: `${win.plane.w / 2}px ${(view.horizonRow - card.top) * win.plane.scale}px`,
        willChange: 'transform',
      });
      el.appendChild(node);
      anims.push(
        node.animate?.(
          [
            { transform: `translate3d(${-reachPx}px,0,0) scale(${scale})` },
            { transform: `translate3d(${reachPx}px,0,0) scale(${scale})` },
          ],
          {
            duration: DRIFT_LEG_S * 1000,
            iterations: Infinity,
            direction: 'alternate',
            easing: 'ease-in-out',
          }
        )
      );
    }
    parent.appendChild(el);
    return { el, anims };
  };

  /** Paint the lit cards into the host canvas, farthest first, each at its scale about the same origin as the rig, at heading 0: the still scene's one image. */
  const paintCards = (bd: Backdrop) => {
    const ctx = context2d(canvas);
    if (!ctx) return;
    const { view } = bd.manifest;
    const { w, h, scale } = viewSize();
    const win = windowFor(view, w, h);
    const s = win.plane.scale * scale;
    const dw = win.plane.w * scale;
    const x0 = (canvas.width - dw) / 2;
    const planeTop = canvas.height - (win.plane.h + win.plane.bottom) * scale;
    const ox = x0 + dw / 2;
    const oy = planeTop + view.horizonRow * s;
    for (let k = bd.cards.length - 1; k >= 0; k -= 1) {
      const card = bd.cards[k];
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(card.scale, card.scale);
      ctx.drawImage(card.canvas, x0 - ox, planeTop + card.top * s - oy, dw, card.h * s);
      ctx.restore();
    }
  };

  /** Paint the sky, the stars and the rain. Returns false when a 2D context is missing or there is no area yet. */
  const build = (): boolean => {
    teardown();
    // A zero-size canvas throws on drawImage; wait for the first resize that gives the host an area.
    if (hasNoArea()) return false;
    const { w, h, scale } = viewSize();
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const painted = paintSky(canvas, sky, w, h, () => document.createElement('canvas'));
    if (!painted.ok) return false;
    // The real stars, the moon and (when asked) the constellation lines are baked into the sky; the twinkling stars get their own
    // canvas, which a per-frame pass clears and paints over. 'still' has no overlay. A sky with no physical model has no bodies.
    const bodies: NightBodies =
      painted.px && sky.physical
        ? nightBodies(sky.physical, painted.px, opts.lines === true)
        : { stars: [], lines: [] };
    const stars = bodies.stars;
    const skyCtx = context2d(canvas);
    if (skyCtx) paintNightBodies(skyCtx, bodies, canvas.width, canvas.height, scale);
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
    built = { twinkle };
    if (opts.backdrop && !still) built.rig = startRig(opts.backdrop, w, h);
    if (tier !== 'still' && sky.physical && sky.physical.weather.rain > 0)
      built.rain = startRain(sky.physical.weather.rain, sky.horizon, w, h, scale);
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
    const anims = [...(built?.rig?.anims ?? []), ...(built?.rain?.anims ?? [])];
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

  /** Drop the twinkle and the rain, leaving the painted sky as a still image. */
  const settleToStill = () => {
    if (still && !built) return;
    still = true;
    teardown();
    cancelAnimationFrame(raf);
    raf = 0;
    if (opts.backdrop) paintCards(opts.backdrop);
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
      // No camera to pull back; the sky is the same before and after.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      reducedMotion?.removeEventListener?.('change', syncPlayState);
      teardown();
      readout?.remove();
    },
  };
}
