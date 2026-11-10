/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function -- DOM stubs, as the other scene tests */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerrainSkyScene, SKY_WIDTH } from './TerrainSky2D';
import { startBackgroundScene } from '../index';
import { terrainSkyFor } from '../skyForState';

let search: string;
let arcs: number;
let overlay: { remove: ReturnType<typeof vi.fn> };
let windowListeners: Record<string, () => void>;
beforeEach(() => {
  search = '';
  arcs = 0;
  windowListeners = {};
  vi.stubGlobal('document', {
    createElement: () => {
      overlay = {
        remove: vi.fn(),
        style: {},
        setAttribute() {},
        getContext: () => ({
          clearRect() {},
          beginPath() {},
          fill() {},
          arc: () => {
            arcs += 1;
          },
        }),
      } as any;
      return overlay;
    },
  });
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: 400,
    innerHeight: 800,
    addEventListener: (n: string, f: () => void) => {
      windowListeners[n] = f;
    },
    removeEventListener: (n: string) => {
      delete windowListeners[n];
    },
    get location() {
      return { search };
    },
    setTimeout,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A canvas with a recording 2D context; `gl` is what 'webgl2' answers. */
function canvasWith(opts: { twoD?: boolean; gl?: unknown } = {}) {
  const painted: { data: Uint8ClampedArray; width: number; height: number }[] = [];
  const ctx = {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (image: any) => painted.push(image),
  };
  const parentAppend = vi.fn();
  const canvas: any = {
    width: 0,
    height: 0,
    clientWidth: 400,
    clientHeight: 800,
    parentElement: { appendChild: parentAppend },
    getContext: vi.fn((kind: string) => {
      if (kind !== '2d') return opts.gl ?? null;
      return opts.twoD === false ? null : ctx;
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return { canvas, painted, parentAppend };
}

const pixel = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
const mean = (img: { data: Uint8ClampedArray }) => {
  let s = 0;
  for (let i = 0; i < img.data.length; i += 4) s += img.data[i] + img.data[i + 1] + img.data[i + 2];
  return s / (img.data.length / 4) / 3;
};

describe('createTerrainSkyScene', () => {
  it("returns null at tier 'off' and touches nothing", () => {
    const { canvas } = canvasWith();
    expect(createTerrainSkyScene({ canvas, tier: 'off' })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('returns null when the canvas gives no 2D context (the CSS ground stays)', () => {
    const { canvas } = canvasWith({ twoD: false });
    expect(createTerrainSkyScene({ canvas, tier: 'low' })).toBeNull();
  });

  it('paints one opaque, graded sky: the horizon end of the image is not the zenith end', () => {
    const { canvas, painted } = canvasWith();
    const s = createTerrainSkyScene({ canvas, tier: 'low', sky: 'noonday' })!;
    expect(painted).toHaveLength(1);
    const img = painted[0];
    expect(img.width).toBe(SKY_WIDTH);
    expect(canvas.width).toBe(SKY_WIDTH);
    expect(canvas.height).toBe(img.height);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255);
    const x = Math.floor(SKY_WIDTH / 2);
    expect(pixel(img, x, 0)).not.toEqual(pixel(img, x, img.height - 1));
    expect(mean(img)).toBeGreaterThan(20);
    s.dispose();
  });

  it('follows the baked sky: noon is brighter than midnight, and ?sun= / ?az= move it', () => {
    const noon = canvasWith();
    createTerrainSkyScene({ canvas: noon.canvas, tier: 'low', sky: 'noonday' })!.dispose();
    const night = canvasWith();
    createTerrainSkyScene({ canvas: night.canvas, tier: 'low', sky: 'midnight' })!.dispose();
    expect(mean(noon.painted[0])).toBeGreaterThan(mean(night.painted[0]) * 1.5);

    const low = canvasWith();
    createTerrainSkyScene({ canvas: low.canvas, tier: 'low', sun: { elevation: 30 } })!.dispose();
    const down = canvasWith();
    createTerrainSkyScene({ canvas: down.canvas, tier: 'low', sun: { elevation: -20 } })!.dispose();
    expect(mean(low.painted[0])).toBeGreaterThan(mean(down.painted[0]));

    search = '?sun=30&az=0';
    const q0 = canvasWith();
    createTerrainSkyScene({ canvas: q0.canvas, tier: 'low' })!.dispose();
    search = '?sun=30&az=180';
    const q1 = canvasWith();
    createTerrainSkyScene({ canvas: q1.canvas, tier: 'low' })!.dispose();
    expect(Array.from(q0.painted[0].data)).not.toEqual(Array.from(q1.painted[0].data));
  });

  it('stars only on a dark sky', () => {
    const night = canvasWith();
    const a = createTerrainSkyScene({ canvas: night.canvas, tier: 'low', sky: 'midnight' })!;
    expect(night.parentAppend).toHaveBeenCalledTimes(1);
    expect(arcs).toBeGreaterThan(0);
    a.dispose();
    expect(overlay.remove).toHaveBeenCalled();
    arcs = 0;
    const day = canvasWith();
    createTerrainSkyScene({ canvas: day.canvas, tier: 'low', sky: 'noonday' })!.dispose();
    expect(day.parentAppend).not.toHaveBeenCalled();
    expect(arcs).toBe(0);
  });

  it('repaints on resize, and dispose stops listening', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      ...(window as any),
      setTimeout,
      addEventListener: (window as any).addEventListener,
    });
    const { canvas, painted } = canvasWith();
    const s = createTerrainSkyScene({ canvas, tier: 'low', sky: 'noonday' })!;
    expect(windowListeners.resize).toBeDefined();
    windowListeners.resize();
    vi.advanceTimersByTime(300);
    expect(painted).toHaveLength(2);
    s.dispose();
    expect(windowListeners.resize).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('the sky-only tier label', () => {
  const labels = (parentAppend: ReturnType<typeof vi.fn>) =>
    parentAppend.mock.calls.filter(([e]) => e?.textContent === 'terrain · sky-only');

  it('shows for ?tierlabel=1 only where the overlays are allowed', () => {
    search = '?tierlabel=1';
    const off = canvasWith();
    createTerrainSkyScene({ canvas: off.canvas, tier: 'low' })!.dispose();
    expect(labels(off.parentAppend)).toHaveLength(0);
    const on = canvasWith();
    createTerrainSkyScene({ canvas: on.canvas, tier: 'low', debug: true })!.dispose();
    expect(labels(on.parentAppend)).toHaveLength(1);
  });

  it('the door allows it from the config flag, and not from a plain production config', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PREVIEW_DEMO', '');
    search = '?tierlabel=1';
    const plain = canvasWith();
    (
      await startBackgroundScene({ tier: 'low', style: 'terrain' }, {}, { canvas: plain.canvas })
    )?.dispose();
    expect(labels(plain.parentAppend)).toHaveLength(0);
    const flagged = canvasWith();
    (
      await startBackgroundScene(
        { tier: 'low', style: 'terrain', debugOverlays: true },
        {},
        { canvas: flagged.canvas }
      )
    )?.dispose();
    expect(labels(flagged.parentAppend)).toHaveLength(1);
    vi.unstubAllEnvs();
  });
});

describe('startBackgroundScene, terrain style', () => {
  it('without WebGL2 mounts the sky on the same canvas instead of returning null', async () => {
    const { canvas, painted } = canvasWith({ gl: null });
    const scene = await startBackgroundScene({ tier: 'low', style: 'terrain' }, {}, { canvas });
    expect(scene).not.toBeNull();
    expect(canvas.getContext.mock.calls.map((c: unknown[]) => c[0])).toEqual(['webgl2', '2d']);
    expect(painted).toHaveLength(1);
    scene!.dispose();
  });

  it('with WebGL2 the terrain runs and the 2D sky is never requested', async () => {
    const gl: any = new Proxy(
      {},
      {
        get(_t, name: string) {
          if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
          if (name === 'checkFramebufferStatus') return () => 1;
          if (name === 'getParameter') return () => 16;
          if (/^[A-Z_0-9]+$/.test(name)) return 1;
          return () => ({});
        },
      }
    );
    Object.assign(document, {
      addEventListener() {},
      removeEventListener() {},
      visibilityState: 'visible',
    });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 0 });
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
    const { canvas, painted } = canvasWith({ gl });
    const scene = await startBackgroundScene({ tier: 'low', style: 'terrain' }, {}, { canvas });
    expect(scene).not.toBeNull();
    expect(canvas.getContext.mock.calls.map((c: unknown[]) => c[0])).toEqual(['webgl2']);
    expect(painted).toHaveLength(0);
    scene!.dispose();
  });

  it('a canvas that took a GL context but gives no scene still ends as null: no 2D context to paint on', async () => {
    const { canvas } = canvasWith({ gl: null, twoD: false });
    expect(
      await startBackgroundScene({ tier: 'low', style: 'terrain' }, {}, { canvas })
    ).toBeNull();
  });
});

describe('the 2D sky lies in the band of its state', () => {
  // The painted pixels, read back through the sRGB curve as a screen shows them.
  const lumOf = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const e = v / 255;
      return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const painted = (state: 'day' | 'dusk' | 'night') => {
    const c = canvasWith();
    createTerrainSkyScene({ canvas: c.canvas, tier: 'low', ...terrainSkyFor(state) })!.dispose();
    const img = c.painted[0];
    const out: number[] = [];
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) out.push(lumOf(pixel(img, x, y)));
    }
    return out;
  };

  it.each([['day'], ['dusk']] as const)('%s: no pixel below the text bound 0.2983', (state) => {
    expect(Math.min(...painted(state))).toBeGreaterThanOrEqual(0.2983);
  });

  it('night: no pixel above the text bound 0.0931', () => {
    expect(Math.max(...painted('night'))).toBeLessThanOrEqual(0.0931);
  });
});
