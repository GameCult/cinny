import type { Scene, SceneOptions } from '../Scene';
import { litScaleRequested, overlayRequested } from '../debugOverlays';
import { FrameSampler, frameStats, FrameStats } from './probe';
import { skyColours, SkyColours, Srgb } from './skyColour';
import { paintSky as paintPhysicalSky } from './physicalSky';
import { cardArc, cardPose, deviceScale, HFOV_MAX_DEG, litScale, litScaleCap, offsetRange, SEGMENT_S, sweepArc, windowFor } from './view';
import type { Camera, CardPose, View } from './view';
import type { TileCard } from './manifest';
import { residentTiles } from './ring';
import { freeze, normalize, poseAt as headingPose, setRange, settledAt, subscribe as onHeading, turnRate } from './heading';
import type { Pose } from './heading';
import { activeAt, drawTwinkle as paintTwinkle, slotsFor, Star } from './stars';
import { STAR_COUNT } from './nightSkyData';
import { alignTurns, panPx, plateCamera, plateSize, recentre, slackFor } from './skyTurn';
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
 * A canvas's sky: the physical sky (`physicalSky.ts`) seen through `camera` as a small grid of display pixels, scaled up smoothly (it is a soft
 * field); without one, the three-stop gradient. `cssW` and `cssH` are the canvas's size in CSS px, which `camera`'s field of view spans.
 */
function paintSky(
  canvas: HTMLCanvasElement,
  sky: SkyColours,
  camera: Camera | undefined,
  cssW: number,
  cssH: number,
  makeCanvas: () => HTMLCanvasElement
): { ok: boolean; px?: ReturnType<typeof paintPhysicalSky> } {
  const ctx = context2d(canvas);
  if (!ctx) return { ok: false };
  if (sky.physical && camera) {
    const px = paintPhysicalSky(sky.physical, cssW, cssH, camera);
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

/**
 * The sky of a live scene: one element, wider than the viewport, holding the painted sky (every real body baked into it) and, with stars, the twinkling
 * stars' canvas over it. One animation slides it with the heading (`skyTurn.ts`). Replaced, element and all, when the heading nears its edge.
 */
interface Plate {
  el: HTMLElement;
  /** The twinkle canvas of this plate, over its sky; absent in a day sky. */
  twinkle?: HTMLCanvasElement;
  /** The stars this plate was painted with, by catalogue index: the identity the twinkle schedule is keyed by. */
  stars: ReadonlyMap<number, Star>;
  /** Device pixels per CSS px of the plate's canvases (capped by `PLATE_MAX_PX`). */
  ratio: number;
  /** Degrees of sky it holds beyond the viewport each side (`skyTurn.ts` `slackFor`, at the speed it was painted for). */
  slack: number;
  /** The compass azimuth the plate is centred on, unwrapped to the heading owner's turn. */
  centre: number;
  /** The one animation that slides it. */
  anim?: Animation;
  /**
   * Paint a new plate about the heading in this one's place when the heading is near its edge, or the speed in force needs more slack than it has; `periodMs`:
   * the real period of the residency tick. True when it did, and then the slide is not keyed yet: `key` it, from a clock read after this.
   */
  refit: (periodMs: number) => boolean;
  /** Key the slide from `t0` (ms), the heading owner's clock read after the plate was last painted; `play`: the motion runs. */
  key: (t0: number, frozen: boolean, play: boolean) => void;
  /** The residency tick: refit, and key from the clock after the paint if it painted. */
  tend: (periodMs: number) => void;
  stop: () => void;
}

interface Built {
  /** The sky and its twinkling stars, under the rig; absent in 'still' (the sky is painted into the host canvas) and in a sky with no physical model (a gradient in the host canvas). */
  plate?: Plate;
  /** The ridge cards' rig, over the plate and under the rain; absent in 'still' (the cards are drawn into the host canvas). */
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
export const RESIDENCY_MS = 500;

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
 * The keyframes of a stretch of motion from `t0` (ms), the transform at each instant from `transformAt`: a keyframe a second for SEGMENT_S seconds, finely
 * keyed while an ease of the heading owner runs, constant under reduced motion. The cards and the sky are keyed by it alike, so they turn together.
 */
const stretch = (t0: number, frozen: boolean, transformAt: (t: number) => string): Keyframe[] => {
  if (frozen) {
    const at = transformAt(t0);
    return [{ transform: at }, { transform: at }];
  }
  const easeMs = Math.min(SEGMENT_S * 1000, Math.max(0, settledAt() - t0));
  if (easeMs > 0) return easeTimes(easeMs).map((ms) => ({ transform: transformAt(t0 + ms), offset: ms / (SEGMENT_S * 1000) }));
  return Array.from({ length: SEGMENT_S + 1 }, (_, n) => ({ transform: transformAt(t0 + n * 1000) }));
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
  let twRaf = 0;
  let twLast = 0;
  /** Paint a plate's twinkle canvas at t seconds, or clear it (set by the plate the scene is up with). */
  let paintTwinkleOf: (of: Pick<Plate, 'twinkle' | 'stars' | 'ratio'>, t?: number) => void = () => undefined;
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
    return { w, h, scale: deviceScale() };
  };

  const makeCanvas = () => document.createElement('canvas');

  /** The lit scale for the viewport as it is now (`view.ts` `litScale`, the one owner; a probe's `?litScale` replaces it for measurement). */
  const litScaleNow = (bd: Backdrop): number => {
    const { w, h, scale } = viewSize();
    return litScale(bd.manifest, windowFor(bd.manifest.view, w, h), scale, litScaleRequested(opts.debug === true));
  };

  const teardown = () => {
    built?.plate?.stop();
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
  const startRig = (bd: Backdrop, w: number, h: number, plate?: Plate): Rig => {
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
      normalize(clock()); // the angles of this stretch start within a turn of zero, so the transforms stay small however long the page has been open
      plate?.refit(tickMs); // a new plate costs a paint: whatever it costs, the cards and the sky are keyed from the clock after it, so none of it is lag
      const t0 = clock();
      issuedAt = t0;
      const frozen = reducedMotion?.matches === true;
      const play = moving();
      for (let i = 0; i < k; i += 1) {
        const frames = stretch(t0, frozen, (t) => transform(poseAt(i, t)));
        boxes[i].style.transform = frames[0].transform as string;
        anims[i]?.cancel();
        anims[i] = boxes[i].animate?.(frames, {
          duration: SEGMENT_S * 1000,
          easing: 'linear',
          fill: 'forwards',
        });
        if (!play) anims[i]?.pause();
      }
      plate?.key(t0, frozen, play); // the sky turns on the same keyframes, from the same poses
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
    let lastTick: number | undefined;
    /** The real period of the tick, ms: what the last two began apart (a tick is a timeout chain, so its work and its lateness are in it), never less than RESIDENCY_MS. */
    let tickMs = RESIDENCY_MS;
    const residency = () => {
      timer = 0;
      if (!live) return;
      const t = clock();
      if (lastTick !== undefined) tickMs = Math.max(RESIDENCY_MS, t - lastTick);
      lastTick = t;
      const play = moving();
      if (play && t - issuedAt >= SEGMENT_S * 1000 * REISSUE_FRAC) issue();
      else if (play) plate?.tend(tickMs);
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
    stillPose ??= headingPose(clock());
    const at = stillPose;
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

  /** A still's one image in the host canvas: the sky facing the pose it froze at, its bodies, and the cards of that pose over them. */
  const paintStill = () => {
    const { w, h, scale } = viewSize();
    const physical = sky.physical;
    if (opts.backdrop) stillPose ??= headingPose(clock());
    const facing = stillPose?.h ?? physical?.view.lookAzDeg ?? 0; // with no ridge there is no heading: the place's rest azimuth
    const camera = physical && plateCamera(windowFor(physical.view, w, h), facing, 0);
    const painted = paintSky(canvas, sky, camera, w, h, makeCanvas);
    const ctx = context2d(canvas);
    if (ctx && physical && painted.px)
      paintNightBodies(ctx, nightBodies(physical, painted.px, opts.lines === true), canvas.width, canvas.height, scale);
    if (opts.backdrop) paintCards(opts.backdrop);
  };

  /**
   * The sky of a live scene (`skyTurn.ts`): a plate painted about the heading the view has, under a stretch of the heading owner's keyframes. The real stars,
   * the moon and (when asked) the constellation lines are baked into the plate's sky; the twinkling stars get their own canvas on it, which a per-frame pass
   * clears and paints over. A sky-only scene has no rig to issue it: its plate faces the place's rest azimuth and stays.
   */
  const startPlate = (physical: NonNullable<SkyColours['physical']>, w: number, h: number, dpr: number): Plate | undefined => {
    const win = windowFor(physical.view, w, h);
    const pxPerDeg = w / win.camera.hfovDeg;
    /** Slots of the twinkle schedule, fixed by the first plate: the schedule runs over the catalogue, so every plate of this sky twinkles the same stars in the same phase. */
    let slots = 0;
    const paint = (centre: number, slack: number) => {
      const { cssW, ratio } = plateSize(win, w, h, dpr, slack);
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, {
        position: 'absolute',
        left: `${(w - cssW) / 2}px`,
        top: '0',
        width: `${cssW}px`,
        height: `${h}px`,
        willChange: 'transform',
        pointerEvents: 'none',
      });
      const layer = (): HTMLCanvasElement => {
        const c = document.createElement('canvas');
        c.width = Math.floor(cssW * ratio);
        c.height = Math.floor(h * ratio);
        c.setAttribute('aria-hidden', 'true');
        Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' });
        el.appendChild(c);
        return c;
      };
      const skyEl = layer();
      const painted = paintSky(skyEl, sky, plateCamera(win, centre, slack), cssW, h, makeCanvas);
      const skyCtx = context2d(skyEl);
      if (!painted.ok || !painted.px || !skyCtx) return undefined;
      const bodies: NightBodies = nightBodies(physical, painted.px, opts.lines === true);
      paintNightBodies(skyCtx, bodies, skyEl.width, skyEl.height, ratio);
      slots ||= slotsFor(STAR_COUNT, bodies.stars.length);
      return {
        el,
        twinkle: bodies.stars.length ? layer() : undefined,
        stars: new Map(bodies.stars.map((star) => [star.id, star])),
        ratio,
        slack,
      };
    };
    /** The overlay of `of` at `t` seconds: the stars of the catalogue that twinkle then, those of them this plate has. */
    paintTwinkleOf = (of, t) => {
      const el = of.twinkle;
      const ctx = el && context2d(el);
      if (!el || !ctx) return;
      const active = t === undefined ? [] : activeAt(STAR_COUNT, t, slots);
      paintTwinkle(ctx, of.stars, active, el.width, el.height, of.ratio);
    };
    const facing = opts.backdrop ? headingPose(clock()).h : physical.view.lookAzDeg; // with no ridge there is no heading: the place's rest azimuth
    const first = paint(facing, slackFor(turnRate(), RESIDENCY_MS));
    if (!first) return undefined;
    parent.appendChild(first.el);
    /** The slide from `t0` of a plate centred on `centre`: its pan at every instant of the stretch is the heading owner's `h` there against that centre. */
    const key = (el: HTMLElement, centre: number, t0: number, frozen: boolean, play: boolean): Animation | undefined => {
      const frames = stretch(t0, frozen, (t) => `translate3d(${panPx(headingPose(t).h, centre, pxPerDeg)}px,0,0)`);
      el.style.transform = frames[0].transform as string;
      const anim = el.animate?.(frames, { duration: SEGMENT_S * 1000, easing: 'linear', fill: 'forwards' });
      if (!play) anim?.pause();
      return anim;
    };
    const plate: Plate = {
      ...first,
      centre: facing,
      refit: (periodMs) => {
        const at = headingPose(clock()).h;
        plate.centre = alignTurns(plate.centre, at);
        const rate = turnRate();
        const slack = slackFor(rate, RESIDENCY_MS);
        if (slack <= plate.slack && !recentre(at, plate.centre, plate.slack, rate, periodMs)) return false;
        // A plate about the heading, in the place of this one: the same sky at the same place on the screen, so nothing moves. Undefined (this one stays) if it cannot be painted.
        const next = paint(at, slack);
        if (!next) return false;
        if (moving()) paintTwinkleOf(next, clock() / 1000); // its twinkles as the old one's are now: shown with the stars already swinging
        parent.insertBefore(next.el, plate.el);
        plate.anim?.cancel();
        plate.el.remove();
        Object.assign(plate, next, { centre: at, anim: undefined });
        return true;
      },
      key: (t0, frozen, play) => {
        plate.anim?.cancel();
        plate.anim = key(plate.el, plate.centre, t0, frozen, play);
      },
      tend: (periodMs) => {
        if (plate.refit(periodMs)) plate.key(clock(), false, true); // ticks run only while moving
      },
      stop: () => {
        plate.anim?.cancel();
        plate.el.remove();
      },
    };
    return plate;
  };

  /** Paint the cards' rig, the sky and the rain. Returns false when a 2D context is missing or there is no area yet. */
  const build = (): boolean => {
    teardown();
    // A zero-size canvas throws on drawImage; wait for the first resize that gives the host an area.
    if (hasNoArea()) return false;
    const { w, h, scale } = viewSize();
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    if (!context2d(canvas)) return false;
    built = {};
    if (!still) {
      // The host canvas keeps a still's sky (`paintStill`); a live scene's physical sky is a plate over it, and one with none is a gradient in the host canvas.
      if (sky.physical) {
        built.plate = startPlate(sky.physical, w, h, scale);
        if (!built.plate) return false;
      } else if (!paintSky(canvas, sky, undefined, w, h, makeCanvas).ok) return false;
    }
    if (opts.backdrop) {
      // The offsets this place and viewport allow, to the one owner of the pose: a rebuild at another size is a new bound, and the view eases from the pose it has.
      const { manifest } = opts.backdrop;
      const win = windowFor(manifest.view, w, h);
      setRange((mode, phi) => offsetRange(manifest, win, mode, phi), clock());
      if (!still) built.rig = startRig(opts.backdrop, w, h, built.plate);
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

  /** Paint the overlay of the plate that is up at t seconds (stars away from base), or just clear it with no t (all at base). */
  const drawTwinkle = (t?: number) => {
    if (built?.plate) paintTwinkleOf(built.plate, t);
  };

  // The same guard as the drift: not still, not disposed, not reduced motion, tab visible. Not moving
  // stops the loop and leaves the stars steady at base brightness.
  const twTick = (now: number) => {
    twRaf = 0;
    if (!moving() || !built?.plate?.twinkle) return;
    if (now - twLast >= TWINKLE_FRAME_MS) {
      twLast = now;
      drawTwinkle(now / 1000);
    }
    twRaf = requestAnimationFrame(twTick);
  };

  function syncPlayState() {
    if (moving()) built?.rig?.reissue();
    const anims = [...(built?.rig?.anims ?? []), ...(built?.rain?.anims ?? []), built?.plate?.anim];
    anims.forEach((a) => (moving() ? a?.play() : a?.pause()));
    if (!built?.plate?.twinkle) return;
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
    paintStill();
    report(true);
  };

  /** What the lighting costs, measured on this device: the scale and what bounds it, the light times of the cards, the lit canvases held, the GPU. The same numbers go to console.table. */
  let sinceTable = -Infinity;
  const lightingLines = (frames: FrameStats): string => {
    const bd = opts.backdrop as Backdrop;
    const st = bd.stats();
    const light = frameStats(st.lightMs);
    const cap = litScaleCap(bd.manifest);
    const mb = st.litBytes / 1e6;
    const now = performance.now();
    if (now - sinceTable > 5000 && typeof console.table === 'function') {
      sinceTable = now;
      // eslint-disable-next-line no-console
      console.table({
        ridge: {
          litScale: st.scale,
          deviceScale: deviceScale(),
          cap: Number(cap.toFixed(3)),
          litMpx: Number((st.litPx / 1e6).toFixed(3)),
          cards: light.n,
          lightMedianMs: Number(light.medianMs.toFixed(2)),
          lightP95Ms: Number(light.p95Ms.toFixed(2)),
          residentLitMB: Number(mb.toFixed(2)),
          frameMedianMs: Number(frames.medianMs.toFixed(2)),
          frameP95Ms: Number(frames.p95Ms.toFixed(2)),
          renderer: st.renderer,
        },
      });
    }
    return [
      `lit S ${st.scale} · device ${deviceScale()} · cap ${cap.toFixed(2)} · ${(st.litPx / 1e6).toFixed(2)} Mpx`,
      `light ${light.n} cards · median ${light.medianMs.toFixed(1)} ms · p95 ${light.p95Ms.toFixed(1)} ms`,
      `resident lit ${mb.toFixed(1)} MB`,
      st.renderer,
    ].join('\n');
  };

  const report = (stillNow: boolean) => {
    const s = { ...sampler.stats(), still: stillNow };
    opts.onProbe?.(s);
    if (readout) {
      const frameLine = `ridge · n ${s.n} · median ${s.medianMs.toFixed(1)} ms · p95 ${s.p95Ms.toFixed(1)} ms${stillNow ? ' · STILL' : ''}`;
      readout.textContent = opts.backdrop ? `${frameLine}\n${lightingLines(s)}` : frameLine;
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
      whiteSpace: 'pre',
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
        // A resize is a new view: the cards are lit at the scale this size takes, first; a still takes the pose the heading has now and asks for the tiles of it; the arrivals then repaint that pose.
        if (opts.backdrop) opts.backdrop.setScale(litScaleNow(opts.backdrop));
        stillPose = undefined;
        if (wasStill && opts.backdrop) {
          const { h } = headingPose(clock());
          opts.backdrop.ensure({ fromDeg: h - HFOV_MAX_DEG / 2, toDeg: h + HFOV_MAX_DEG / 2 }).catch(() => undefined);
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
