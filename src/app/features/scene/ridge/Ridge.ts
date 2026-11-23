import type { Scene, SceneOptions } from '../Scene';
import { overlayRequested } from '../debugOverlays';
import { FrameSampler, FrameStats } from './probe';
import { skyColours, SkyColours, Srgb } from './skyColour';
import { paintSky as paintPhysicalSky } from './physicalSky';
import { cardArc, cardPose, HFOV_MAX_DEG, offsetRange, SEGMENT_S, sweepArc, windowFor } from './view';
import type { CardPose, View } from './view';
import type { TileCard } from './manifest';
import { residentTiles } from './ring';
import { freeze, normalize, poseAt as headingPose, setRange, settledAt, subscribe as onHeading } from './heading';
import type { Pose } from './heading';
import { activeAt, drawTwinkle as paintTwinkle, Star } from './stars';
import { nightBodies, paintNightBodies } from './nightBodies';
import type { NightBodies } from './nightBodies';
import { drawRainTile, RAIN_TILES } from './rain';
import type { Arc, Backdrop, LitTile } from './Backdrop';

export type RidgeOptions = Pick<SceneOptions, 'canvas' | 'tier'> & {
  /** Show the rAF median/p95 readout. Default: the page URL has `?probe=1`, where `debug` allows it. */
  probe?: boolean;
  /** The diagnostic overlays may be asked for by URL (debugOverlays.ts). Default: no. */
  debug?: boolean;
  /** Each time the readout would update, and once with `still` when the fallback fires. */
  onProbe?: (s: FrameStats & { still: boolean }) => void;
  /** The sky's colours; default `skyColours()`, the one function to replace with Void's sun.js. */
  sky?: SkyColours;
  /** The baked ridge cards by tile, lit for `sky` (`Backdrop.ts`), the arc around the heading already made; none is the sky-only scene (`view.ts` FALLBACK_VIEW). The scene owns it from here and disposes it with itself. */
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

/** The rig: one box per card, each holding that card's resident tiles and carried by one animation of its pose. */
interface Rig {
  el: HTMLElement;
  anims: (Animation | undefined)[];
  /** Issue the next stretch of every card's motion from the heading owner's clock now (a tab shown again). */
  reissue: () => void;
  /** Take the viewer's mode and speed to the heading owner again, then reissue (reduced motion switched). */
  sync: () => void;
  /** Stop the residency timer and the subscriptions. */
  stop: () => void;
}

interface Built {
  /** The twinkling stars' own canvas, over the sky; absent in a day sky and in 'still'. */
  twinkle?: HTMLCanvasElement;
  /** The ridge cards' rig, over the twinkle canvas and under the rain; absent in 'still' (the cards are drawn into the host canvas). */
  rig?: Rig;
  /** The rain's tiles and their falling, present only when the weather rains (`rain.ts`). */
  rain?: { els: HTMLElement[]; anims: (Animation | undefined)[] };
}

/** The twinkle overlay redraws at most this often: the swings are 2 to 7 s, no need for 60 fps. */
const TWINKLE_FRAME_MS = 50;

/**
 * A card's motion is issued as one animation of SEGMENT_S seconds (`view.ts`), a keyframe each second sampled from the heading owner (`heading.ts`) and the
 * viewer's offset, and issued again once REISSUE_FRAC of it has run, so the compositor always has the next stretch before it needs it. Authored.
 */
const REISSUE_FRAC = 0.8;
/** How often the arc of tiles ahead is asked for and the mounted tiles are brought up to date. */
const RESIDENCY_MS = 500;

/** Keyframe spacing while an ease runs, ms: fine enough that the straight lines between them are the smoothstep to a pixel. */
const EASE_KEY_MS = 50;
/** The instants of a stretch keyed finely up to `easeMs`, then every second to SEGMENT_S: ms from the stretch's start, ascending, ending at the stretch's length. */
const easeTimes = (easeMs: number): number[] => {
  const times: number[] = [];
  for (let ms = 0; ms < easeMs; ms += EASE_KEY_MS) times.push(ms);
  times.push(easeMs);
  for (let ms = (Math.floor(easeMs / 1000) + 1) * 1000; ms <= SEGMENT_S * 1000; ms += 1000) times.push(ms);
  return times;
};

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
  /** The pose a still shows: taken at its first paint and drawn at every repaint after, tile arrivals included; a resize takes a new one. A still has no clock. */
  let stillPose: Pose | undefined;
  const sampler = new FrameSampler();

  const viewSize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    return { w, h, scale: (window.devicePixelRatio || 1) >= 2 ? 2 : 1 };
  };

  const teardown = () => {
    built?.twinkle?.remove();
    built?.rig?.stop();
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

  /** Where a tile sits in a card's box, in viewport px from the centre column and the horizon: its left edge (one overlap column before its interior) and its band. */
  const tileBox = (view: View, scale: number, lt: LitTile, turn: number, entry: TileCard) => {
    const colDeg = 360 / view.ringW;
    const az = turn * 360 + (lt.tile * 360) / view.tiles - colDeg;
    return {
      left: (az - view.lookAzDeg) * view.pxPerDegH * scale,
      top: (entry.top - view.horizonRow) * scale,
      w: (view.tileW + 2) * scale,
      h: entry.h * scale,
    };
  };

  /**
   * The ridge over the sky: one box per card, farthest first (DOM order is paint order, stacking is by order alone). A box spans the viewport with its
   * transform origin on the horizon centre and holds the resident tiles of its card at their azimuth; one animation per box carries its pose
   * (`view.ts` `cardPose`) over SEGMENT_S seconds of the heading owner's clock. A timer asks the backdrop for the arc ahead and mounts what it has made.
   */
  const startRig = (bd: Backdrop, w: number, h: number): Rig => {
    const { view } = bd.manifest;
    const win = windowFor(view, w, h);
    const planeTop = h - win.plane.bottom - win.plane.h;
    const horizonY = planeTop + view.horizonRow * win.plane.scale;
    const k = bd.manifest.cards.length;
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
    const boxes: HTMLElement[] = [];
    for (let i = k - 1; i >= 0; i -= 1) {
      const box = document.createElement('div');
      box.id = `card-${i}`;
      Object.assign(box.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${w}px`,
        height: `${h}px`,
        transformOrigin: `${w / 2}px ${horizonY}px`,
        willChange: 'transform',
        pointerEvents: 'none',
      });
      el.appendChild(box);
      boxes[i] = box;
    }
    const anims: (Animation | undefined)[] = new Array(k).fill(undefined);
    freeze(reducedMotion?.matches === true, clock()); // reduced motion turns nothing, whatever the viewer chose
    /** A card's pose at the clock `t`: the heading owner's pose (view direction, camera angle, offset), the one place any of them is decided. */
    const poseAt = (card: number, t: number): CardPose => {
      const p = headingPose(t);
      return cardPose(bd.manifest, card, p.h, p.phi, p.r, win);
    };
    const transform = (p: CardPose) => `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`;
    let issuedAt = 0;
    let live = true;

    /** The next stretch of every card's motion, from now: it replaces the one running, which agrees with it where they meet. */
    const issue = () => {
      if (!live) return;
      const t0 = clock();
      normalize(t0); // the angles of this stretch start within a turn of zero, so the transforms stay small however long the page has been open
      issuedAt = t0;
      const frozen = reducedMotion?.matches === true;
      // A stretch with an ease in it is keyed finely while the ease runs (its keyframes at explicit offsets of the stretch), a second apart after.
      const easeMs = Math.min(SEGMENT_S * 1000, Math.max(0, settledAt() - t0));
      const times = easeMs > 0 && !frozen ? easeTimes(easeMs) : null;
      for (let i = 0; i < k; i += 1) {
        const frames: Keyframe[] = frozen
          ? [{ transform: transform(poseAt(i, t0)) }, { transform: transform(poseAt(i, t0)) }]
          : times
            ? times.map((ms) => ({ transform: transform(poseAt(i, t0 + ms)), offset: ms / (SEGMENT_S * 1000) }))
            : Array.from({ length: SEGMENT_S + 1 }, (_, n) => ({
                transform: transform(poseAt(i, t0 + n * 1000)),
              }));
        boxes[i].style.transform = frames[0].transform as string;
        anims[i]?.cancel();
        anims[i] = boxes[i].animate?.(frames, {
          duration: SEGMENT_S * 1000,
          easing: 'linear',
          fill: 'forwards',
        });
        if (!moving()) anims[i]?.pause();
      }
      mount(sweep(t0)); // laid out from the same angles as the keyframes, in the same tick
    };

    /** The arc of azimuth any card shows at any instant of the stretch from `t0`: every pose it passes through, not its ends. */
    const sweep = (t0: number): Arc => sweepArc(view, win, w, k, poseAt, t0, SEGMENT_S);

    const mounted = new Map<HTMLCanvasElement, number>();
    /** Put the made tiles the arc shows into their card's box at their azimuth, and take the others out. */
    const mount = (arc: Arc) => {
      const refs = residentTiles(view, (arc.fromDeg + arc.toDeg) / 2, (arc.toDeg - arc.fromDeg) / 2);
      const turnOf = new Map(refs.map((r) => [r.tile, r.turn]));
      const keep = new Set<HTMLCanvasElement>();
      for (const lt of bd.litTiles()) {
        const turn = turnOf.get(lt.tile);
        const entry = bd.manifest.tiles[lt.tile][lt.card];
        if (turn === undefined || !entry) continue;
        keep.add(lt.canvas);
        if (mounted.get(lt.canvas) === turn && lt.canvas.parentElement === boxes[lt.card]) continue;
        const b = tileBox(view, win.plane.scale, lt, turn, entry);
        Object.assign(lt.canvas.style, {
          position: 'absolute',
          left: `${w / 2 + b.left}px`,
          top: `${horizonY + b.top}px`,
          width: `${b.w}px`,
          height: `${b.h}px`,
        });
        mounted.set(lt.canvas, turn);
        boxes[lt.card].appendChild(lt.canvas);
      }
      for (const c of [...mounted.keys()]) {
        if (keep.has(c)) continue;
        c.remove();
        mounted.delete(c);
      }
    };

    // The one timer: ask for the arc ahead, mount what is made, and issue the next stretch once this one is mostly spent.
    const win0 = window;
    let timer = 0;
    const residency = () => {
      timer = 0;
      if (!live) return;
      const t = clock();
      if (t - issuedAt >= SEGMENT_S * 1000 * REISSUE_FRAC && moving()) issue();
      const arc = sweep(t);
      mount(arc);
      void bd.ensure(arc, sweepArc(view, win, w, k, poseAt, t, 0)).then(() => live && mount(arc)); // the view now first, then along the sweep
      timer = win0.setTimeout(residency, RESIDENCY_MS);
    };
    parent.appendChild(el);
    issue();
    const sync = () => {
      freeze(reducedMotion?.matches === true, clock());
      issue();
    };
    const offHeading = onHeading(issue); // every change of the pose's course: the viewer's choice, a hold, a bound, a place
    timer = win0.setTimeout(residency, RESIDENCY_MS);
    return {
      el,
      anims,
      reissue: issue,
      sync,
      stop: () => {
        live = false;
        win0.clearTimeout(timer);
        offHeading();
      },
    };
  };

  /** Paint the lit tiles of every card into the host canvas, farthest first, each card at its pose about the rig's origin, at the pose the still froze at its first paint: the still scene's one image. */
  const paintCards = (bd: Backdrop) => {
    const ctx = context2d(canvas);
    if (!ctx) return;
    const { view } = bd.manifest;
    const { w, h, scale: dpr } = viewSize();
    const win = windowFor(view, w, h);
    const at = (stillPose ??= headingPose(clock()));
    const planeTop = h - win.plane.bottom - win.plane.h;
    const horizonY = planeTop + view.horizonRow * win.plane.scale;
    const poses = bd.manifest.cards.map((_, i) =>
      cardPose(bd.manifest, i, at.h, at.phi, at.r, win)
    );
    const arcs = poses.map((p) => cardArc(view, win, w, p));
    const from = Math.min(...arcs.map((a) => a.fromDeg));
    const to = Math.max(...arcs.map((a) => a.toDeg));
    const turnOf = new Map(residentTiles(view, (from + to) / 2, (to - from) / 2).map((r) => [r.tile, r.turn]));
    const lit = bd.litTiles();
    for (let i = poses.length - 1; i >= 0; i -= 1) {
      ctx.save();
      ctx.translate((w / 2 + poses[i].shiftPx) * dpr, horizonY * dpr);
      ctx.scale(poses[i].scale, poses[i].scale);
      for (const lt of lit.filter((x) => x.card === i)) {
        const turn = turnOf.get(lt.tile);
        const entry = bd.manifest.tiles[lt.tile][i];
        if (turn === undefined || !entry) continue;
        const b = tileBox(view, win.plane.scale, lt, turn, entry);
        ctx.drawImage(lt.canvas, b.left * dpr, b.top * dpr, b.w * dpr, b.h * dpr);
      }
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
    if (opts.backdrop) {
      // The offsets this place and viewport allow, to the one owner of the pose: a rebuild at another size is a new bound, and the view eases from the pose it has.
      const { manifest } = opts.backdrop;
      const win = windowFor(manifest.view, w, h);
      setRange((mode, phi) => offsetRange(manifest, win, mode, phi), clock());
      if (!still) built.rig = startRig(opts.backdrop, w, h);
    }
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
    if (moving()) built?.rig?.reissue();
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
    if (!still) stillPose = undefined; // a live scene that flattens freezes the pose it has now
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
  /** Make the scene again at the size it has now and settle as it was: after a resize, and after tiles arrive into a still. A burst of either is one rebuild, 250 ms after the last. */
  let freshPose = false;
  const rebuild = (fresh: boolean) => {
    freshPose ||= fresh;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      const wasStill = still;
      if (freshPose) {
        // A resize is a new view: a still takes the pose the heading has now and asks for the tiles of it; the arrivals then repaint that pose.
        stillPose = undefined;
        if (wasStill && opts.backdrop) {
          const { h } = headingPose(clock());
          void opts.backdrop.ensure({ fromDeg: h - HFOV_MAX_DEG / 2, toDeg: h + HFOV_MAX_DEG / 2 }).catch(() => undefined);
        }
      }
      freshPose = false;
      if (!build()) return;
      if (wasStill) settleToStill();
      else {
        sampler.reset();
        wake();
      }
    }, 250);
  };
  // A still draws once and has no timer to ask for tiles, so it is told of each one that is made after its paint (the deadline of a scene start leaves the rest of the
  // first arc loading); the live tier mounts them on its own timer. Nothing asks for more: a repaint adds no request, so the fill-in ends with the last tile.
  const offTile = opts.backdrop?.onTile(() => {
    if (still && !disposed) rebuild(false);
  });
  document.addEventListener('visibilitychange', onVisibility);
  const onResize = () => rebuild(true);
  window.addEventListener('resize', onResize);
  const onMotionChange = () => {
    built?.rig?.sync();
    syncPlayState();
  };
  reducedMotion?.addEventListener?.('change', onMotionChange);

  return {
    login() {
      // No camera to pull back; the sky is the same before and after.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      offTile?.();
      opts.backdrop?.dispose();
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      reducedMotion?.removeEventListener?.('change', onMotionChange);
      teardown();
      readout?.remove();
    },
  };
}
